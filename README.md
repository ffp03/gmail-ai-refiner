# Gmail AI Refiner ✦

Gmail AI Refiner is a Chrome extension that integrates state-of-the-art LLMs directly into the Gmail compose experience. It helps you refine email drafts for better grammar, flow, and professional tone with a single keystroke.

## Features

- **Three Custom System Prompts** — Trigger different writing styles via `Ctrl+1`, `Ctrl+2`, or `Ctrl+3` (e.g. formal, concise, casual). Each prompt is fully customizable in settings.
- **Smart Context Extraction** — Automatically separates your new draft from the quoted thread context in replies, scoped to the current thread to prevent stale context from previous emails.
- **Folded Email Support** — Accurately retrieves context even when the previous email is folded (hidden behind the "…" expand button) in Gmail.
- **Signature Preservation** — When accepting a suggestion in a new compose window, Gmail's default signature block is preserved in place.
- **Correct Line Break Rendering** — AI-suggested text with paragraph breaks is inserted as proper Gmail-style `<div>` nodes, so newlines display correctly after accepting.
- **Multiple Providers** — Support for Anthropic (Claude), Google (Gemini), and DeepSeek.
- **Flexible Triggering**:
  - **Shortcut Mode** — Press `Ctrl+1`, `Ctrl+2`, or `Ctrl+3` to trigger a refinement with the corresponding system prompt.
  - **Auto Mode** — Automatically suggests improvements after a brief pause in typing (1.8 s idle, min. 20 characters).
- **Seamless Keyboard Flow** — `Tab` to accept a suggestion · `Esc` to dismiss.
- **Suggestion Panel Positioned Above Compose Area** — The AI suggestion box appears between the header fields and the typing area, not below the toolbar.
- **Privacy First** — API keys are stored locally in your browser via `chrome.storage.local`.

## Installation

1. Clone this repository or download the source code.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select the extension directory.

## Configuration

1. Click the Gmail AI Refiner icon in your extensions toolbar.
2. Select your preferred **AI Provider** (Anthropic, Gemini, DeepSeek).
3. Enter your **API Key**.
4. Customize up to **three System Prompts** (e.g. Prompt 1 = formal, Prompt 2 = concise, Prompt 3 = casual).
5. Choose your **Trigger Mode** (Shortcut or Auto).

## Usage

1. Open Gmail and click **Compose** or open a reply.
2. Type your draft.
3. **Shortcut Mode**: Press `Ctrl+1`, `Ctrl+2`, or `Ctrl+3` to refine with the matching prompt.
4. **Auto Mode**: Wait for the AI Suggestion panel to appear above the compose area (≥20 chars, 1.8 s idle).
5. Press `Tab` to replace your draft with the suggestion, or `Esc` to dismiss.

## Project Structure

| File | Purpose |
|---|---|
| `manifest.json` | Extension configuration and permissions |
| `content.js` | Gmail UI interaction, suggestion panel, accept/dismiss logic |
| `background.js` | LLM API communication (Anthropic, Gemini, DeepSeek) |
| `providers.js` | Provider registry and request/response adapters |
| `settings.html/js` | Extension options page |
| `styles.css` | Inline suggestion panel styling |

## License

MIT
