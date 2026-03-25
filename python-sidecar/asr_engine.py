"""
ASR Engine - Speech-to-text using sherpa-onnx models.
Supports SenseVoice, Paraformer, and Whisper via sherpa-onnx.
"""

import os
import asyncio
import logging
import time
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


class ASREngine:
    def __init__(self, models_dir: Path):
        self.models_dir = models_dir
        self.asr_dir = models_dir / "asr"
        self.current_model_id: Optional[str] = None
        self._recognizer = None

    def is_loaded(self) -> bool:
        return self._recognizer is not None

    async def load_model(self, model_id: str):
        """Load an ASR model by ID."""
        if model_id == self.current_model_id and self._recognizer is not None:
            logger.info(f"ASR model {model_id} already loaded")
            return

        logger.info(f"Loading ASR model: {model_id}")
        self._recognizer = None
        self.current_model_id = None

        try:
            import sherpa_onnx

            if model_id == "sensevoice-small":
                model_dir = self.asr_dir / "sensevoice-small" / "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17"
                self._recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
                    model=str(model_dir / "model.int8.onnx"),
                    tokens=str(model_dir / "tokens.txt"),
                    use_itn=True,
                    num_threads=4,
                    debug=False,
                )
            elif model_id == "paraformer-small":
                model_dir = self.asr_dir / "paraformer-small" / "sherpa-onnx-paraformer-zh-2023-09-14"
                self._recognizer = sherpa_onnx.OfflineRecognizer.from_paraformer(
                    paraformer=str(model_dir / "model.int8.onnx"),
                    tokens=str(model_dir / "tokens.txt"),
                    num_threads=4,
                    debug=False,
                )
            elif model_id == "whisper-tiny":
                model_dir = self.asr_dir / "whisper-tiny" / "sherpa-onnx-whisper-tiny"
                self._recognizer = sherpa_onnx.OfflineRecognizer.from_whisper(
                    encoder=str(model_dir / "tiny-encoder.onnx"),
                    decoder=str(model_dir / "tiny-decoder.onnx"),
                    tokens=str(model_dir / "tiny-tokens.txt"),
                    num_threads=4,
                    debug=False,
                )
            else:
                raise ValueError(f"Unknown ASR model: {model_id}")

            self.current_model_id = model_id
            logger.info(f"ASR model {model_id} loaded successfully")

        except ImportError:
            logger.error("sherpa-onnx not installed. Install with: pip install sherpa-onnx")
            raise
        except Exception as e:
            logger.error(f"Failed to load ASR model {model_id}: {e}")
            raise

    async def transcribe(self, audio_path: str) -> str:
        """Transcribe an audio file to text."""
        if self._recognizer is None:
            raise RuntimeError("No ASR model loaded. Please load a model first.")

        import sherpa_onnx
        import wave

        # Read WAV file
        with wave.open(audio_path, "rb") as wf:
            sample_rate = wf.getframerate()
            num_channels = wf.getnchannels()
            num_frames = wf.getnframes()
            audio_data = wf.readframes(num_frames)

        # Convert to float32 samples
        import struct
        import numpy as np

        samples = np.frombuffer(audio_data, dtype=np.int16).astype(np.float32) / 32768.0

        # If stereo, convert to mono
        if num_channels == 2:
            samples = samples.reshape(-1, 2).mean(axis=1)

        # Resample to 16kHz if needed
        if sample_rate != 16000:
            from scipy import signal as scipy_signal
            num_samples = int(len(samples) * 16000 / sample_rate)
            samples = scipy_signal.resample(samples, num_samples)
            sample_rate = 16000

        # Run recognition
        stream = self._recognizer.create_stream()
        stream.accept_waveform(sample_rate, samples.tolist())
        self._recognizer.decode_stream(stream)

        text = stream.result.text.strip()
        logger.info(f"ASR result: '{text}' (audio: {len(samples)/sample_rate:.1f}s)")
        return text
