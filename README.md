# Gmail AI Refiner ✦

Gmail AI Refiner is a powerful Chrome extension that integrates state-of-the-art Large Language Models (LLMs) directly into the Gmail compose experience. It helps you refine your email drafts for better grammar, flow, and professional tone with a single click or keystroke.

## Features

- **Inline Suggestions**: Get real-time AI refinements as you type or on demand.
- **Multiple Providers**: Support for Anthropic (Claude 3.7 Sonnet), Google Gemini (3 Flash Preview), and DeepSeek.
- **Flexible Triggering**:
  - **Auto-Refine**: Automatically suggests improvements after a brief pause in typing (1.8 seconds of idle time) once the draft reaches at least 20 characters.
  - **Manual Trigger**: Use `Ctrl + Space` to request a refinement whenever you're ready.
- **Seamless Integration**: Use `Tab` to accept suggestions and `Esc` to dismiss them.
- **Customizable**: Set your own system prompts and preferred AI provider in the extension settings.
- **Privacy First**: Your API keys are stored locally in your browser.

## Installation

1. Clone this repository or download the source code.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the top right corner.
4. Click **Load unpacked** and select the extension directory.

## Configuration

1. Click on the Gmail AI Refiner icon in your extensions toolbar.
2. Select your preferred **AI Provider**.
3. Enter your **API Key** (Anthropic, Gemini, or DeepSeek).
4. (Optional) Customize the **System Prompt** to change the AI's writing style.
5. Choose your **Trigger Mode** (Shortcut or Auto).

## Usage

1. Open Gmail and click **Compose**.
2. Start typing your email draft.
3. If using **Auto Mode**, wait for the "AI Suggestion" panel to appear (requires at least 20 characters and 1.8s of idle typing).
4. If using **Shortcut Mode**, press `Ctrl + Space` to trigger a refinement.
5. Press `Tab` to replace your draft with the AI suggestion, or `Esc` to keep your original text.

## Project Structure

- `manifest.json`: Extension configuration and permissions.
- `content.js`: Main logic for interacting with the Gmail UI.
- `background.js`: Handles communication with LLM APIs.
- `providers.js`: Registry and configurations for different AI providers.
- `settings.html/js`: Extension options page.
- `styles.css`: Styling for the inline suggestion panel.

## License

MIT
