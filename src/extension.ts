import * as vscode from 'vscode';
import fetch from 'node-fetch';

let decorationType: vscode.TextEditorDecorationType;
let debounceTimer: NodeJS.Timeout | undefined;
let complexityCache = new Map<string, string>();

export function activate(context: vscode.ExtensionContext) {
    console.log('ComplexityLens is now active');

    decorationType = vscode.window.createTextEditorDecorationType({
        after: {
            margin: '0 0 0 20px',
            fontWeight: 'bold',
            fontStyle: 'italic'
        }
    });

    let selectionListener = vscode.window.onDidChangeTextEditorSelection(
        async (event) => {
            const editor = event.textEditor;
            if (editor.document.languageId !== 'python') return;
            
            const selection = editor.selection;
            if (selection.isEmpty) {
                editor.setDecorations(decorationType, []);
                return;
            }

            const code = editor.document.getText(selection);
            if (code.trim().length < 15) return;

            if (debounceTimer) {
                clearTimeout(debounceTimer);
            }

            const loadingDecoration = {
                range: selection,
                renderOptions: {
                    after: {
                        contentText: ' ⚡ analyzing...',
                        color: '#888888'
                    }
                }
            };
            editor.setDecorations(decorationType, [loadingDecoration]);

            debounceTimer = setTimeout(async () => {
                const cacheKey = code.trim();
                if (complexityCache.has(cacheKey)) {
                    const cached = complexityCache.get(cacheKey)!;
                    showInlineComplexity(editor, selection, cached);
                    return;
                }

                try {
                    const complexity = await quickComplexityCheck(code);
                    complexityCache.set(cacheKey, complexity);
                    
                    if (complexityCache.size > 50) {
                        const keys = Array.from(complexityCache.keys());
                        complexityCache.delete(keys[0]);
                    }
                    
                    showInlineComplexity(editor, selection, complexity);
                } catch (error) {
                    const fallback = estimateComplexity(code);
                    showInlineComplexity(editor, selection, fallback);
                }
            }, 400);
        }
    );

    let analyzeCommand = vscode.commands.registerCommand(
        'complexity-lens.analyze',
        async () => {
            const editor = vscode.window.activeTextEditor;
            
            if (!editor) {
                vscode.window.showErrorMessage('No active editor');
                return;
            }

            if (editor.document.languageId !== 'python') {
                vscode.window.showErrorMessage('This only works with Python files');
                return;
            }

            const selection = editor.selection;
            const code = editor.document.getText(selection);
            
            if (!code.trim()) {
                vscode.window.showErrorMessage('Please select some Python code first');
                return;
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "🔍 Analyzing complexity...",
                cancellable: false
            }, async (progress) => {
                try {
                    const analysis = await analyzeComplexity(code);
                    showResults(analysis, code);
                } catch (error: any) {
                    vscode.window.showErrorMessage(
                        `Analysis failed: ${error.message}`
                    );
                }
            });
        }
    );

    context.subscriptions.push(analyzeCommand, selectionListener);
}

function showInlineComplexity(editor: vscode.TextEditor, selection: vscode.Selection, complexity: string) {
    const decoration = {
        range: selection,
        renderOptions: {
            after: {
                contentText: ` ⚡ ${complexity}`,
                color: getComplexityColor(complexity)
            }
        }
    };
    editor.setDecorations(decorationType, [decoration]);
}

async function quickComplexityCheck(code: string): Promise<string> {
    const config = vscode.workspace.getConfiguration('complexityLens');
    const apiKey = config.get<string>('apiKey');

    if (!apiKey) {
        return estimateComplexity(code);
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
            model: 'claude-haiku-20250219',
            max_tokens: 100,
            messages: [{
                role: 'user',
                content: `Time complexity of this Python code? Reply with ONLY the Big-O notation (e.g., "O(n)", "O(n²)", "O(n log n)"). No explanation.

\`\`\`python
${code}
\`\`\``
            }]
        })
    });

    if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
    }

    const data: any = await response.json();
    const result = data.content[0].text.trim();
    
    const match = result.match(/O\([^)]+\)/);
    return match ? match[0] : result;
}

function estimateComplexity(code: string): string {
    const lines = code.split('\n');
    
    // Check for iterative binary search pattern
    if (code.includes('while') && 
        (code.includes('left') || code.includes('low')) && 
        (code.includes('right') || code.includes('high')) &&
        code.includes('mid') &&
        (code.includes('// 2') || code.includes('/ 2'))) {
        return 'O(log n)';
    }
    
    // Check for recursive patterns
    const funcMatch = code.match(/def\s+(\w+)\s*\(/);
    if (funcMatch) {
        const funcName = funcMatch[1];
        const recursiveCalls = (code.match(new RegExp(`\\b${funcName}\\s*\\(`, 'g')) || []).length;
        
        // Exponential (fibonacci, etc)
        if (recursiveCalls > 2) {
            if (code.includes('fibonacci') || code.includes('fib')) {
                return 'O(2^n)';
            }
        }
        
        // Divide and conquer (merge sort, quick sort)
        if (recursiveCalls >= 3 && (code.includes('merge') || code.includes('partition'))) {
            return 'O(n log n)';
        }
        
        // Recursive binary search
        if (recursiveCalls === 2 && 
            (code.includes('mid') || code.includes('m')) &&
            (code.includes('// 2') || code.includes('/ 2'))) {
            return 'O(log n)';
        }
    }
    
    // Built-in sorting
    if (code.includes('.sort(') || code.includes('sorted(')) {
        return 'O(n log n)';
    }
    
    // Check for nested loops (actual nesting, not sequential)
    let maxNestingLevel = 0;
    let currentNestingLevel = 0;
    let indentStack: number[] = [];
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        
        const indent = line.search(/\S/);
        
        if (trimmed.startsWith('for ') || trimmed.startsWith('while ')) {
            if (indentStack.length > 0 && indent > indentStack[indentStack.length - 1]) {
                // Actually nested
                currentNestingLevel++;
                maxNestingLevel = Math.max(maxNestingLevel, currentNestingLevel);
            } else {
                // Sequential loop - reset
                while (indentStack.length > 0 && indent <= indentStack[indentStack.length - 1]) {
                    indentStack.pop();
                    currentNestingLevel = Math.max(0, currentNestingLevel - 1);
                }
                currentNestingLevel++;
            }
            indentStack.push(indent);
        } else if (indent < (indentStack[indentStack.length - 1] || 999)) {
            // Dedent - pop from stack
            while (indentStack.length > 0 && indent < indentStack[indentStack.length - 1]) {
                indentStack.pop();
                currentNestingLevel = Math.max(0, currentNestingLevel - 1);
            }
        }
    }
    
    // Check for hidden O(n²) patterns
    // "item in list" inside a loop
    const inOperatorCount = (code.match(/\sin\s+(?!range)/g) || []).length;
    if (inOperatorCount > 0 && maxNestingLevel >= 1) {
        return 'O(n²)';
    }
    
    // Based on nesting level
    if (maxNestingLevel >= 3) return 'O(n³)';
    if (maxNestingLevel === 2) return 'O(n²)';
    if (maxNestingLevel === 1) return 'O(n)';
    
    // No loops - constant time
    if (!code.includes('for ') && !code.includes('while ')) {
        return 'O(1)';
    }
    
    return 'O(n)';
}

function getComplexityColor(complexity: string): string {
    if (complexity.includes('O(1)') || complexity.includes('O(log n)')) {
        return '#4ec9b0';
    }
    if (complexity.includes('O(n)') && !complexity.includes('²')) {
        return '#dcdcaa';
    }
    if (complexity.includes('O(n²)') || complexity.includes('O(n log n)')) {
        return '#ce9178';
    }
    return '#f48771';
}

async function analyzeComplexity(code: string): Promise<string> {
    const config = vscode.workspace.getConfiguration('complexityLens');
    const apiKey = config.get<string>('apiKey');

    if (!apiKey) {
        throw new Error('Please set your Anthropic API key in settings');
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1500,
            messages: [{
                role: 'user',
                content: `You are an expert Python performance analyst. Analyze this code's complexity.

Python Code:
\`\`\`python
${code}
\`\`\`

Provide a CONCISE analysis with:
1. **Time Complexity**: O(?) with brief explanation
2. **Space Complexity**: O(?) with brief explanation  
3. **Bottleneck**: Which exact line(s) and why
4. **Optimization**: ONE concrete suggestion to improve performance
5. **Rating**: 🟢 Excellent / 🟡 Good / 🟠 Needs Work / 🔴 Poor

Be specific about Python operations (list comprehensions, dict lookups, etc).
Keep total response under 200 words.`
            }]
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`API error: ${response.status} - ${error}`);
    }

    const data: any = await response.json();
    return data.content[0].text;
}

function showResults(analysis: string, originalCode: string) {
    const panel = vscode.window.createWebviewPanel(
        'complexityResults',
        '⚡ Complexity Analysis',
        vscode.ViewColumn.Beside,
        {
            enableScripts: true
        }
    );

    panel.webview.html = getWebviewContent(analysis, originalCode);
}

function getWebviewContent(analysis: string, code: string): string {
    const escapedCode = highlightPython(code);
    let formattedAnalysis = parseAnalysis(analysis);

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Complexity Analysis</title>
            <style>
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    padding: 30px;
                    background: #1e1e1e;
                    color: #d4d4d4;
                    line-height: 1.6;
                }
                h1 {
                    color: #4ec9b0;
                    margin-bottom: 30px;
                    font-size: 28px;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    font-weight: 600;
                }
                .section {
                    background: #252526;
                    padding: 24px;
                    border-radius: 8px;
                    margin-bottom: 20px;
                    border-left: 4px solid #007acc;
                }
                .section-header {
                    color: #569cd6;
                    font-size: 14px;
                    margin-bottom: 16px;
                    text-transform: uppercase;
                    letter-spacing: 1.5px;
                    font-weight: 600;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .analysis-content {
                    font-size: 15px;
                    line-height: 1.8;
                }
                .metric {
                    margin: 16px 0;
                    padding: 12px;
                    background: #2d2d2d;
                    border-radius: 6px;
                    border-left: 3px solid #4ec9b0;
                }
                .metric-label {
                    color: #dcdcaa;
                    font-weight: 600;
                    font-size: 14px;
                    margin-bottom: 6px;
                }
                .metric-value {
                    color: #ce9178;
                    font-family: 'Consolas', 'Monaco', monospace;
                    font-size: 16px;
                    font-weight: 600;
                }
                .metric-desc {
                    color: #a0a0a0;
                    font-size: 14px;
                    margin-top: 6px;
                }
                .code-snippet {
                    background: #1e1e1e;
                    padding: 20px;
                    border-radius: 6px;
                    margin: 12px 0;
                    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
                    font-size: 14px;
                    border: 1px solid #3c3c3c;
                    overflow-x: auto;
                    line-height: 1.6;
                    white-space: pre;  /* Preserve whitespace and newlines */
                    tab-size: 4;
                }
                .keyword { color: #569cd6; font-weight: 600; }
                .string { color: #ce9178; }
                .number { color: #b5cea8; }
                .function { color: #dcdcaa; }
                .comment { color: #6a9955; font-style: italic; }
                .operator { color: #d4d4d4; }
                .builtin { color: #4ec9b0; }
                
                .optimization {
                    background: #1a3a1a;
                    border-left-color: #4ec9b0;
                    padding: 12px;
                    border-radius: 6px;
                    margin: 12px 0;
                }
                .bottleneck {
                    background: #3a1a1a;
                    border-left-color: #f48771;
                    padding: 12px;
                    border-radius: 6px;
                    margin: 12px 0;
                }
                .rating {
                    font-size: 24px;
                    margin: 16px 0;
                    text-align: center;
                }
                strong {
                    color: #ffd700;
                    font-weight: 600;
                }
                p {
                    margin: 12px 0;
                }
            </style>
        </head>
        <body>
            <h1><span>⚡</span> Complexity Analysis</h1>
            
            <div class="section">
                <div class="section-header">📊 PERFORMANCE METRICS</div>
                <div class="analysis-content">${formattedAnalysis}</div>
            </div>

            <div class="section">
                <div class="section-header">🐍 ANALYZED CODE</div>
                <div class="code-snippet">${escapedCode}</div>
            </div>
        </body>
        </html>
    `;
}

function parseAnalysis(analysis: string): string {
    const lines = analysis.split('\n');
    let html = '';
    let inCodeBlock = false;
    let codeBlockContent = '';

    for (let line of lines) {
        if (line.trim().startsWith('```')) {
            if (inCodeBlock) {
                html += `<div class="code-snippet">${highlightPython(codeBlockContent)}</div>`;
                codeBlockContent = '';
                inCodeBlock = false;
            } else {
                inCodeBlock = true;
            }
            continue;
        }

        if (inCodeBlock) {
            codeBlockContent += line + '\n';
            continue;
        }

        if (line.includes('Time Complexity:') || line.includes('**Time Complexity**')) {
            const match = line.match(/O\([^)]+\)/);
            const complexity = match ? match[0] : 'O(?)';
            const desc = line.split(':')[1]?.replace(/O\([^)]+\)/, '').replace(/\*\*/g, '').trim() || '';
            html += `
                <div class="metric">
                    <div class="metric-label">⏱️ Time Complexity</div>
                    <div class="metric-value">${complexity}</div>
                    ${desc ? `<div class="metric-desc">${desc}</div>` : ''}
                </div>
            `;
        } else if (line.includes('Space Complexity:') || line.includes('**Space Complexity**')) {
            const match = line.match(/O\([^)]+\)/);
            const complexity = match ? match[0] : 'O(?)';
            const desc = line.split(':')[1]?.replace(/O\([^)]+\)/, '').replace(/\*\*/g, '').trim() || '';
            html += `
                <div class="metric">
                    <div class="metric-label">💾 Space Complexity</div>
                    <div class="metric-value">${complexity}</div>
                    ${desc ? `<div class="metric-desc">${desc}</div>` : ''}
                </div>
            `;
        } else if (line.includes('Bottleneck:') || line.includes('**Bottleneck**')) {
            const desc = line.split(':')[1]?.replace(/\*\*/g, '').trim() || '';
            html += `
                <div class="metric bottleneck">
                    <div class="metric-label">🔥 Bottleneck</div>
                    <div class="metric-desc">${desc}</div>
                </div>
            `;
        } else if (line.includes('Optimization:') || line.includes('**Optimization**')) {
            const desc = line.split(':')[1]?.replace(/\*\*/g, '').trim() || '';
            html += `
                <div class="metric optimization">
                    <div class="metric-label">💡 Optimization</div>
                    <div class="metric-desc">${desc}</div>
                </div>
            `;
        } else if (line.includes('Rating:') || line.includes('**Rating**') || /[🟢🟡🟠🔴]/.test(line)) {
            html += `<div class="rating">${line.replace(/\*\*/g, '').replace('Rating:', '').trim()}</div>`;
        } else if (line.trim() && !line.startsWith('#')) {
            html += `<p>${line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</p>`;
        }
    }

    return html;
}

function highlightPython(code: string): string {
    // Escape HTML
    const escaped = code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    
    const keywords = new Set(['def', 'class', 'if', 'elif', 'else', 'for', 'while', 'return', 'import', 'from', 'as', 'try', 'except', 'finally', 'with', 'in', 'is', 'not', 'and', 'or', 'break', 'continue', 'pass', 'lambda', 'yield']);
    const builtins = new Set(['print', 'len', 'range', 'str', 'int', 'float', 'list', 'dict', 'set', 'tuple', 'enumerate', 'zip', 'map', 'filter', 'sorted', 'sum', 'max', 'min', 'abs', 'open']);
    
    const lines = escaped.split('\n');
    const result: string[] = [];
    
    for (const line of lines) {
        // Preserve empty lines
        if (!line.trim()) {
            result.push('');
            continue;
        }
        
        // Handle full-line comments
        if (line.trim().startsWith('#')) {
            result.push(`<span class="comment">${line}</span>`);
            continue;
        }
        
        // Split on comment
        const commentIndex = line.indexOf('#');
        const codePart = commentIndex >= 0 ? line.substring(0, commentIndex) : line;
        const commentPart = commentIndex >= 0 ? line.substring(commentIndex) : '';
        
        let processedLine = '';
        
        // Simple word-boundary tokenization
        let i = 0;
        while (i < codePart.length) {
            // Skip whitespace (preserve it)
            if (/\s/.test(codePart[i])) {
                processedLine += codePart[i];
                i++;
                continue;
            }
            
            // Check for string literals
            if (codePart[i] === '"' || codePart[i] === "'") {
                const quote = codePart[i];
                let j = i + 1;
                while (j < codePart.length && codePart[j] !== quote) {
                    if (codePart[j] === '\\') j++; // Skip escaped chars
                    j++;
                }
                j++; // Include closing quote
                processedLine += `<span class="string">${codePart.substring(i, j)}</span>`;
                i = j;
                continue;
            }
            
            // Check for numbers
            if (/\d/.test(codePart[i])) {
                let j = i;
                while (j < codePart.length && /[\d.]/.test(codePart[j])) j++;
                processedLine += `<span class="number">${codePart.substring(i, j)}</span>`;
                i = j;
                continue;
            }
            
            // Check for identifiers/keywords
            if (/[a-zA-Z_]/.test(codePart[i])) {
                let j = i;
                while (j < codePart.length && /[a-zA-Z0-9_]/.test(codePart[j])) j++;
                const word = codePart.substring(i, j);
                
                if (keywords.has(word)) {
                    processedLine += `<span class="keyword">${word}</span>`;
                } else if (builtins.has(word)) {
                    processedLine += `<span class="builtin">${word}</span>`;
                } else {
                    processedLine += word;
                }
                i = j;
                continue;
            }
            
            // Everything else (operators, punctuation)
            processedLine += codePart[i];
            i++;
        }
        
        // Add comment if exists
        if (commentPart) {
            processedLine += `<span class="comment">${commentPart}</span>`;
        }
        
        result.push(processedLine);
    }
    
    return result.join('\n');
}

export function deactivate() {
    if (decorationType) {
        decorationType.dispose();
    }
}