# ComplexityLens

AI-powered Python complexity analyzer for VSCode. See Big-O notation instantly as you code.

## Features

- **Instant complexity preview**: Select code → see `⚡ O(n²)` appear inline
- **AI-powered analysis**: Detailed breakdown with bottlenecks and optimization suggestions
- **Smart caching**: Reuses results for identical code
- **Works offline**: Falls back to heuristics when API is unavailable

## Installation

### From .vsix file:
1. Download `complexity-lens-0.0.1.vsix` from [Releases](https://github.com/HarshAkunuri/complexity-lens/releases)
2. Open VSCode
3. Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
4. Type "Extensions: Install from VSIX"
5. Select the downloaded file

### From Marketplace:
Search for "ComplexityLens" in VSCode Extensions

## Setup

1. Get an Anthropic API key from [console.anthropic.com](https://console.anthropic.com)
2. Open VSCode Settings (`Cmd+,` or `Ctrl+,`)
3. Search for "Complexity Lens"
4. Paste your API key in "Complexity Lens: Api Key"

## Usage

1. Open a Python file
2. Select any code snippet
3. See instant `⚡ O(n)` preview appear next to your selection
4. Press `Cmd+Shift+C` (Mac) or `Ctrl+Shift+C` (Windows/Linux) for detailed analysis

## Examples

### Binary Search
```python