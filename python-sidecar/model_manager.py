"""
Model Manager - handles model registry, download, and status tracking.
"""

import os
import asyncio
import logging
import hashlib
from pathlib import Path
from typing import Dict, List, Optional
from dataclasses import dataclass, field, asdict

import httpx

logger = logging.getLogger(__name__)

# Model registry
ASR_MODELS = {
    "sensevoice-small": {
        "id": "sensevoice-small",
        "name": "SenseVoice Small",
        "description": "FunASR SenseVoice - Ultra fast, 70ms/10s audio. Non-autoregressive.",
        "size_mb": 230,
        "files": {
            "model.onnx": "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2",
        },
        "archive": True,
        "archive_name": "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17",
        "engine": "sherpa-onnx",
    },
    "paraformer-small": {
        "id": "paraformer-small",
        "name": "Paraformer (FunASR)",
        "description": "FunASR Paraformer - Good accuracy, fast speed. Non-autoregressive.",
        "size_mb": 220,
        "files": {
            "model.onnx": "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-paraformer-zh-2023-09-14.tar.bz2",
        },
        "archive": True,
        "archive_name": "sherpa-onnx-paraformer-zh-2023-09-14",
        "engine": "sherpa-onnx",
    },
    "whisper-tiny": {
        "id": "whisper-tiny",
        "name": "Whisper Tiny",
        "description": "OpenAI Whisper Tiny - Lightweight, 99+ languages.",
        "size_mb": 120,
        "files": {
            "model.onnx": "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny.tar.bz2",
        },
        "archive": True,
        "archive_name": "sherpa-onnx-whisper-tiny",
        "engine": "sherpa-onnx-whisper",
    },
}

LLM_MODELS = {
    "qwen3-0.6b": {
        "id": "qwen3-0.6b",
        "name": "Qwen3 0.6B",
        "description": "Latest Qwen3 (Apr 2025). Ultra fast, thinking/non-thinking modes. Q8_0.",
        "size_mb": 639,
        "filename": "Qwen3-0.6B-Q8_0.gguf",
        "url": "https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q8_0.gguf",
    },
    "qwen3-1.7b": {
        "id": "qwen3-1.7b",
        "name": "Qwen3 1.7B",
        "description": "Qwen3 (Apr 2025). Better quality, still fast. Q4_K_M quantization.",
        "size_mb": 1100,
        "filename": "Qwen_Qwen3-1.7B-Q4_K_M.gguf",
        "url": "https://huggingface.co/bartowski/Qwen_Qwen3-1.7B-GGUF/resolve/main/Qwen_Qwen3-1.7B-Q4_K_M.gguf",
    },
    "none": {
        "id": "none",
        "name": "Disabled (No LLM)",
        "description": "Skip LLM optimization, use raw ASR output.",
        "size_mb": 0,
        "filename": None,
        "url": None,
    },
}


class ModelManager:
    def __init__(self, models_dir: Path):
        self.models_dir = models_dir
        self.asr_dir = models_dir / "asr"
        self.llm_dir = models_dir / "llm"
        self.asr_dir.mkdir(parents=True, exist_ok=True)
        self.llm_dir.mkdir(parents=True, exist_ok=True)
        self._download_progress: Dict = {}

    def get_asr_models(self) -> List[dict]:
        result = []
        for model_id, info in ASR_MODELS.items():
            downloaded = self._is_asr_downloaded(model_id)
            result.append({**info, "downloaded": downloaded})
        return result

    def get_llm_models(self) -> List[dict]:
        result = []
        for model_id, info in LLM_MODELS.items():
            if model_id == "none":
                result.append({**info, "downloaded": True})
            else:
                downloaded = self._is_llm_downloaded(model_id)
                result.append({**info, "downloaded": downloaded})
        return result

    def _is_asr_downloaded(self, model_id: str) -> bool:
        info = ASR_MODELS.get(model_id)
        if not info:
            return False
        model_dir = self.asr_dir / model_id
        if info.get("archive"):
            return (model_dir / info["archive_name"]).exists()
        return model_dir.exists()

    def _is_llm_downloaded(self, model_id: str) -> bool:
        info = LLM_MODELS.get(model_id)
        if not info or not info.get("filename"):
            return model_id == "none"
        return (self.llm_dir / info["filename"]).exists()

    def get_download_progress(self) -> dict:
        return self._download_progress.copy()

    async def download_model(self, model_type: str, model_id: str) -> dict:
        if model_type == "asr":
            return await self._download_asr_model(model_id)
        elif model_type == "llm":
            return await self._download_llm_model(model_id)
        else:
            raise ValueError(f"Unknown model type: {model_type}")

    async def _download_asr_model(self, model_id: str) -> dict:
        info = ASR_MODELS.get(model_id)
        if not info:
            raise ValueError(f"Unknown ASR model: {model_id}")

        if self._is_asr_downloaded(model_id):
            return {"status": "already_downloaded", "model_id": model_id}

        model_dir = self.asr_dir / model_id
        model_dir.mkdir(parents=True, exist_ok=True)

        for file_key, url in info["files"].items():
            self._download_progress = {
                "model_type": "asr",
                "model_id": model_id,
                "file": file_key,
                "progress": 0,
                "status": "downloading",
            }
            logger.info(f"Downloading ASR model {model_id}: {url}")

            if info.get("archive"):
                # Download and extract tar.bz2
                archive_path = model_dir / "archive.tar.bz2"
                await self._download_file(url, archive_path)

                self._download_progress["status"] = "extracting"
                logger.info(f"Extracting {archive_path}...")

                proc = await asyncio.create_subprocess_exec(
                    "tar", "xjf", str(archive_path), "-C", str(model_dir),
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                await proc.wait()
                archive_path.unlink(missing_ok=True)
            else:
                await self._download_file(url, model_dir / file_key)

        self._download_progress = {"status": "done", "model_id": model_id}
        return {"status": "downloaded", "model_id": model_id}

    async def _download_llm_model(self, model_id: str) -> dict:
        info = LLM_MODELS.get(model_id)
        if not info:
            raise ValueError(f"Unknown LLM model: {model_id}")
        if model_id == "none":
            return {"status": "no_download_needed", "model_id": model_id}
        if self._is_llm_downloaded(model_id):
            return {"status": "already_downloaded", "model_id": model_id}

        self._download_progress = {
            "model_type": "llm",
            "model_id": model_id,
            "progress": 0,
            "status": "downloading",
        }

        dest = self.llm_dir / info["filename"]
        logger.info(f"Downloading LLM model {model_id}: {info['url']}")
        await self._download_file(info["url"], dest)

        self._download_progress = {"status": "done", "model_id": model_id}
        return {"status": "downloaded", "model_id": model_id}

    async def _download_file(self, url: str, dest: Path):
        """Download a file with progress tracking."""
        async with httpx.AsyncClient(follow_redirects=True, timeout=httpx.Timeout(30.0, read=300.0)) as client:
            async with client.stream("GET", url) as response:
                response.raise_for_status()
                total = int(response.headers.get("content-length", 0))
                downloaded = 0

                with open(dest, "wb") as f:
                    async for chunk in response.aiter_bytes(chunk_size=1024 * 256):
                        f.write(chunk)
                        downloaded += len(chunk)
                        if total > 0:
                            self._download_progress["progress"] = round(downloaded / total * 100, 1)

        logger.info(f"Downloaded: {dest} ({dest.stat().st_size / 1024 / 1024:.1f} MB)")
