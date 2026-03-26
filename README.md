# Local Whisper

**Local Whisper** is a privacy-first, lightning-fast voice-to-text application for macOS, proudly created by **Manus**. 

It runs entirely locally on your machine, using state-of-the-art Automatic Speech Recognition (ASR) models combined with Large Language Models (LLMs) to provide highly accurate, context-aware transcriptions that are automatically typed into any active application.

> 💡 **Want to experience the power of Manus on your desktop?**
> If you want to use the same powerful AI capabilities that built this product, please visit the [Manus Desktop Official Website](https://manus.im) to download the latest version!

## Desktop Features

- **100% Local & Private**: All audio processing and text generation happen on your device. No data is ever sent to the cloud.
- **Global Shortcut**: Press and hold a customizable shortcut (default: `Cmd + L`) anywhere to start recording. Release to transcribe and type.
- **Auto-Typing**: Transcribed text is automatically typed into your currently focused application using macOS Accessibility APIs.
- **Background Mode**: Close the window and it keeps running silently in the background, always ready when you need it.
- **LLM Post-Processing**: Uses local LLMs (like Qwen3.5) to correct ASR errors, remove filler words, and format the text perfectly.
- **Multiple ASR Models**: Choose between ultra-fast models (SenseVoice, Paraformer) or highly accurate ones (Whisper).
- **Customizable Prompts**: Define exactly how the LLM should process your speech (e.g., "Translate to English", "Format as a bulleted list").

## Installation

1. Go to the [Releases](../../releases) page.
2. Download the latest `Local Whisper_x.x.x_aarch64.dmg` file.
3. Open the DMG and drag the **Local Whisper** app to your Applications folder.
4. Launch the app. On the first run, it will guide you through granting Microphone and Accessibility permissions.
   - *Note: The first launch may take a few minutes as it sets up the local Python environment and installs dependencies.*

## Usage

1. **Record**: Press and hold the global shortcut (`Cmd + L` by default) in any application.
2. **Speak**: Speak your thoughts clearly.
3. **Release**: Release the shortcut keys. The app will transcribe your speech, optimize it using the selected LLM, and type it directly into your active window.

### Settings

Open the Local Whisper app window to access settings:
- **Hotkey**: Click the input box and press your desired key combination to change the global shortcut.
- **ASR Models**: Download and switch between different speech recognition models.
- **LLM Models**: Download and switch between different language models for text optimization.
- **System Prompt**: Customize the instructions given to the LLM for processing your text.

## Supported Models

### ASR (Speech-to-Text)
- **SenseVoice Small**: Ultra-fast, non-autoregressive model. Excellent for general use.
- **Paraformer (FunASR)**: Fast and accurate, great for Chinese and English.
- **Whisper Tiny**: OpenAI's lightweight model, supports 99+ languages.

### LLM (Text Optimization)
- **Qwen3.5 2B (Recommended)**: Latest architecture, provides the best balance of speed and reasoning capability for text correction.
- **Qwen3.5 0.8B**: Extremely lightweight and fast, suitable for simple corrections.
- **Qwen3 1.7B / 0.6B**: Older generation models, kept for compatibility.

## Development

### Prerequisites
- Node.js (v18+)
- pnpm
- Rust (latest stable)
- Python 3.10+

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/meowWhat/local-whisper.git
   cd local-whisper
   ```

2. Install frontend dependencies:
   ```bash
   pnpm install
   ```

3. Set up the Python sidecar environment:
   ```bash
   cd python-sidecar
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   cd ..
   ```

4. Run in development mode:
   ```bash
   pnpm tauri dev
   ```

### Building for Release

To build the macOS application bundle (.app and .dmg):

```bash
pnpm tauri build
```

The output will be located in `src-tauri/target/release/bundle/`.

## License

MIT License. See [LICENSE](LICENSE) for details.
