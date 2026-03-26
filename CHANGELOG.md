# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-03-26

### Added
- **Global Shortcut**: Press and hold `Cmd + L` (customizable) to record, release to transcribe and auto-type.
- **Auto-Typing**: Automatically types the transcribed text into the currently focused application using macOS Accessibility APIs.
- **Onboarding Flow**: Step-by-step guide on first launch to help users grant Microphone and Accessibility permissions.
- **Background Mode**: Closing the main window now hides the app instead of quitting it, allowing the global shortcut to remain active.
- **LLM Post-Processing**: Integrated local LLMs to correct ASR errors, remove filler words, and format text.
- **Model Manager**: Built-in downloader for ASR and LLM models directly from the Settings UI.
- **Supported ASR Models**:
  - SenseVoice Small (Default, ultra-fast)
  - Paraformer (Fast and accurate)
  - Whisper Tiny (Multi-language)
- **Supported LLM Models**:
  - Qwen3.5 2B (Recommended, best quality)
  - Qwen3.5 0.8B (Lightweight)
  - Qwen3 1.7B / 0.6B
- **Custom Prompts**: Ability to customize the system prompt used by the LLM for text optimization.
- **Console Panel**: Real-time performance metrics showing ASR and LLM latency.

### Changed
- **Hotkey Configuration**: Improved the hotkey settings UI to use a keyboard recorder instead of manual text entry.
- **LLM Engine**: Optimized the LLM engine to use raw prompt mode, completely disabling the "thinking" output for faster and cleaner text generation.
- **App Bundle**: Python sidecar and dependencies are now bundled and automatically set up on the first launch.

### Fixed
- Fixed an issue where the LLM would output `<think>` blocks instead of just the final text.
- Fixed an issue where closing the window would kill the background transcription service.
