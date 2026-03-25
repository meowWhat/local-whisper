#!/usr/bin/env python3
"""
Local Whisper - Python Sidecar Server
Provides ASR (SenseVoice / Sherpa-ONNX) and LLM (llama.cpp) inference.
Runs as a standalone HTTP server that the Tauri frontend communicates with.
"""

import os
import sys
import json
import time
import wave
import struct
import tempfile
import logging
import asyncio
import signal
from pathlib import Path
from typing import Optional

import uvicorn
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from model_manager import ModelManager
from asr_engine import ASREngine
from llm_engine import LLMEngine

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)

# App data directory
def get_app_data_dir() -> Path:
    if sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support" / "local-whisper"
    elif sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", Path.home())) / "local-whisper"
    else:
        base = Path.home() / ".local" / "share" / "local-whisper"
    base.mkdir(parents=True, exist_ok=True)
    return base

APP_DATA_DIR = get_app_data_dir()
MODELS_DIR = APP_DATA_DIR / "models"
MODELS_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Local Whisper Sidecar")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global engines
model_manager = ModelManager(MODELS_DIR)
asr_engine = ASREngine(MODELS_DIR)
llm_engine = LLMEngine(MODELS_DIR)


class SettingsRequest(BaseModel):
    asr_model: Optional[str] = None
    llm_model: Optional[str] = None
    llm_prompt: Optional[str] = None


class TranscribeResponse(BaseModel):
    original_text: str
    optimized_text: str
    metrics: dict


@app.get("/api/health")
async def health():
    return {"status": "ok", "asr_loaded": asr_engine.is_loaded(), "llm_loaded": llm_engine.is_loaded()}


@app.get("/api/models")
async def list_models():
    """List available and downloaded models."""
    return {
        "asr_models": model_manager.get_asr_models(),
        "llm_models": model_manager.get_llm_models(),
        "current_asr": asr_engine.current_model_id,
        "current_llm": llm_engine.current_model_id,
    }


@app.post("/api/models/download")
async def download_model(model_type: str = Form(...), model_id: str = Form(...)):
    """Download a model."""
    try:
        result = await model_manager.download_model(model_type, model_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/models/download-progress")
async def download_progress():
    """Get current download progress."""
    return model_manager.get_download_progress()


@app.post("/api/settings")
async def update_settings(settings: SettingsRequest):
    """Update ASR/LLM model selection and prompt."""
    result = {}
    if settings.asr_model:
        t0 = time.time()
        await asr_engine.load_model(settings.asr_model)
        result["asr_load_time_ms"] = round((time.time() - t0) * 1000)
    if settings.llm_model:
        t0 = time.time()
        await llm_engine.load_model(settings.llm_model)
        result["llm_load_time_ms"] = round((time.time() - t0) * 1000)
    if settings.llm_prompt is not None:
        llm_engine.set_prompt(settings.llm_prompt)
        result["prompt_updated"] = True
    return result


@app.post("/api/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    """Main transcription endpoint: ASR -> LLM optimization."""
    metrics = {}
    total_start = time.time()

    # 1. Read audio data
    t0 = time.time()
    audio_bytes = await audio.read()
    metrics["audio_receive_ms"] = round((time.time() - t0) * 1000, 1)
    metrics["audio_size_bytes"] = len(audio_bytes)

    # Save to temp file
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        f.write(audio_bytes)
        temp_path = f.name

    try:
        # 2. ASR inference
        t0 = time.time()
        original_text = await asr_engine.transcribe(temp_path)
        metrics["asr_latency_ms"] = round((time.time() - t0) * 1000, 1)
        metrics["asr_model"] = asr_engine.current_model_id or "none"

        if not original_text or not original_text.strip():
            return TranscribeResponse(
                original_text="",
                optimized_text="",
                metrics={**metrics, "total_latency_ms": round((time.time() - total_start) * 1000, 1)}
            )

        # 3. LLM optimization
        t0 = time.time()
        optimized_text = await llm_engine.optimize_text(original_text)
        metrics["llm_latency_ms"] = round((time.time() - t0) * 1000, 1)
        metrics["llm_model"] = llm_engine.current_model_id or "none"

        metrics["total_latency_ms"] = round((time.time() - total_start) * 1000, 1)

        return TranscribeResponse(
            original_text=original_text,
            optimized_text=optimized_text,
            metrics=metrics
        )
    finally:
        os.unlink(temp_path)


@app.post("/api/transcribe-asr-only")
async def transcribe_asr_only(audio: UploadFile = File(...)):
    """ASR only, skip LLM optimization."""
    metrics = {}
    total_start = time.time()

    audio_bytes = await audio.read()
    metrics["audio_size_bytes"] = len(audio_bytes)

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        f.write(audio_bytes)
        temp_path = f.name

    try:
        t0 = time.time()
        text = await asr_engine.transcribe(temp_path)
        metrics["asr_latency_ms"] = round((time.time() - t0) * 1000, 1)
        metrics["asr_model"] = asr_engine.current_model_id or "none"
        metrics["total_latency_ms"] = round((time.time() - total_start) * 1000, 1)

        return {"text": text, "metrics": metrics}
    finally:
        os.unlink(temp_path)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 11435
    logger.info(f"Starting Local Whisper sidecar on port {port}")
    logger.info(f"Models directory: {MODELS_DIR}")

    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")


if __name__ == "__main__":
    main()
