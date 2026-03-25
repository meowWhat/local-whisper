#!/usr/bin/env python3
"""
Local Whisper - Python Sidecar Server
Provides ASR (SenseVoice / Sherpa-ONNX) and LLM (llama.cpp) inference.
Runs as a standalone HTTP server that the Tauri frontend communicates with.
"""

import asyncio
import json
import os
import sys
import time
import tempfile
import logging
from pathlib import Path
from typing import Optional

import uvicorn
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from model_manager import ModelManager
from asr_engine import ASREngine
from llm_engine import LLMEngine

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
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
SETTINGS_FILE = APP_DATA_DIR / "settings.json"

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


# ---------------------------------------------------------------------------
# Settings persistence
# ---------------------------------------------------------------------------

def load_saved_settings() -> dict:
    """Load settings from disk."""
    if SETTINGS_FILE.exists():
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            logger.info(f"Loaded settings from {SETTINGS_FILE}")
            return data
        except Exception as e:
            logger.warning(f"Failed to load settings: {e}")
    return {}


def save_settings(settings: dict):
    """Save settings to disk."""
    try:
        # Merge with existing settings
        existing = load_saved_settings()
        existing.update(settings)
        with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(existing, f, ensure_ascii=False, indent=2)
        logger.info(f"Settings saved to {SETTINGS_FILE}")
    except Exception as e:
        logger.warning(f"Failed to save settings: {e}")


async def restore_settings():
    """Restore saved settings on startup."""
    saved = load_saved_settings()
    if not saved:
        logger.info("No saved settings found")
        return

    # Restore LLM prompt first (before loading model)
    if "llm_prompt" in saved and saved["llm_prompt"]:
        llm_engine.set_prompt(saved["llm_prompt"])
        logger.info("Restored LLM prompt from settings")

    # Restore ASR model
    if "asr_model" in saved and saved["asr_model"]:
        try:
            logger.info(f"Restoring ASR model: {saved['asr_model']}")
            await asr_engine.load_model(saved["asr_model"])
        except Exception as e:
            logger.warning(f"Failed to restore ASR model: {e}")

    # Restore LLM model
    if "llm_model" in saved and saved["llm_model"]:
        try:
            logger.info(f"Restoring LLM model: {saved['llm_model']}")
            await llm_engine.load_model(saved["llm_model"])
        except Exception as e:
            logger.warning(f"Failed to restore LLM model: {e}")


# ---------------------------------------------------------------------------
# Startup event
# ---------------------------------------------------------------------------

@app.on_event("startup")
async def on_startup():
    """Restore settings when the server starts."""
    await restore_settings()


# ---------------------------------------------------------------------------
# API models
# ---------------------------------------------------------------------------

class SettingsRequest(BaseModel):
    asr_model: Optional[str] = None
    llm_model: Optional[str] = None
    llm_prompt: Optional[str] = None


class TranscribeFileRequest(BaseModel):
    file_path: str


class TranscribeResponse(BaseModel):
    original_text: str
    optimized_text: str
    metrics: dict


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "asr_loaded": asr_engine.is_loaded(),
        "llm_loaded": llm_engine.is_loaded(),
        "asr_model": asr_engine.current_model_id,
        "llm_model": llm_engine.current_model_id,
    }


@app.get("/api/models")
async def list_models():
    return {
        "asr_models": model_manager.get_asr_models(),
        "llm_models": model_manager.get_llm_models(),
        "current_asr": asr_engine.current_model_id,
        "current_llm": llm_engine.current_model_id,
    }


@app.post("/api/models/download")
async def download_model(model_type: str = Form(...), model_id: str = Form(...)):
    try:
        result = await model_manager.download_model(model_type, model_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/models/download-progress")
async def download_progress():
    return model_manager.get_download_progress()


@app.post("/api/settings")
async def update_settings(settings: SettingsRequest):
    result = {}
    persist = {}

    if settings.llm_prompt is not None:
        llm_engine.set_prompt(settings.llm_prompt)
        persist["llm_prompt"] = settings.llm_prompt
        result["prompt_updated"] = True

    if settings.asr_model:
        t0 = time.time()
        await asr_engine.load_model(settings.asr_model)
        result["asr_load_time_ms"] = round((time.time() - t0) * 1000)
        persist["asr_model"] = settings.asr_model

    if settings.llm_model:
        t0 = time.time()
        await llm_engine.load_model(settings.llm_model)
        result["llm_load_time_ms"] = round((time.time() - t0) * 1000)
        persist["llm_model"] = settings.llm_model

    # Persist settings to disk
    if persist:
        save_settings(persist)

    return result


@app.get("/api/settings")
async def get_settings():
    """Get current settings (for frontend to restore state)."""
    saved = load_saved_settings()
    return {
        "asr_model": asr_engine.current_model_id,
        "llm_model": llm_engine.current_model_id,
        "llm_prompt": llm_engine.get_prompt(),
        "hotkey": saved.get("hotkey", ""),
    }


@app.post("/api/settings/hotkey")
async def save_hotkey(data: dict):
    """Save hotkey setting (frontend-only, but persisted here)."""
    hotkey = data.get("hotkey", "")
    save_settings({"hotkey": hotkey})
    return {"ok": True}


@app.post("/api/transcribe-file")
async def transcribe_file(req: TranscribeFileRequest):
    """Transcribe from a local file path (faster than upload)."""
    metrics = {}
    total_start = time.time()

    file_path = req.file_path
    if not os.path.exists(file_path):
        raise HTTPException(status_code=400, detail=f"File not found: {file_path}")

    metrics["audio_size_bytes"] = os.path.getsize(file_path)

    # ASR inference
    t0 = time.time()
    original_text = await asr_engine.transcribe(file_path)
    metrics["asr_latency_ms"] = round((time.time() - t0) * 1000, 1)
    metrics["asr_model"] = asr_engine.current_model_id or "none"

    if not original_text or not original_text.strip():
        return TranscribeResponse(
            original_text="",
            optimized_text="",
            metrics={
                **metrics,
                "llm_latency_ms": 0,
                "llm_model": "none",
                "total_latency_ms": round((time.time() - total_start) * 1000, 1),
            },
        )

    # LLM optimization
    t0 = time.time()
    optimized_text = await llm_engine.optimize_text(original_text)
    metrics["llm_latency_ms"] = round((time.time() - t0) * 1000, 1)
    metrics["llm_model"] = llm_engine.current_model_id or "none"
    metrics["total_latency_ms"] = round((time.time() - total_start) * 1000, 1)

    return TranscribeResponse(
        original_text=original_text,
        optimized_text=optimized_text,
        metrics=metrics,
    )


@app.post("/api/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    """Transcribe from uploaded audio file."""
    metrics = {}
    total_start = time.time()

    t0 = time.time()
    audio_bytes = await audio.read()
    metrics["audio_receive_ms"] = round((time.time() - t0) * 1000, 1)
    metrics["audio_size_bytes"] = len(audio_bytes)

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        f.write(audio_bytes)
        temp_path = f.name

    try:
        t0 = time.time()
        original_text = await asr_engine.transcribe(temp_path)
        metrics["asr_latency_ms"] = round((time.time() - t0) * 1000, 1)
        metrics["asr_model"] = asr_engine.current_model_id or "none"

        if not original_text or not original_text.strip():
            return TranscribeResponse(
                original_text="",
                optimized_text="",
                metrics={
                    **metrics,
                    "llm_latency_ms": 0,
                    "llm_model": "none",
                    "total_latency_ms": round(
                        (time.time() - total_start) * 1000, 1
                    ),
                },
            )

        t0 = time.time()
        optimized_text = await llm_engine.optimize_text(original_text)
        metrics["llm_latency_ms"] = round((time.time() - t0) * 1000, 1)
        metrics["llm_model"] = llm_engine.current_model_id or "none"
        metrics["total_latency_ms"] = round((time.time() - total_start) * 1000, 1)

        return TranscribeResponse(
            original_text=original_text,
            optimized_text=optimized_text,
            metrics=metrics,
        )
    finally:
        os.unlink(temp_path)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 11435
    logger.info(f"Starting Local Whisper sidecar on port {port}")
    logger.info(f"Models directory: {MODELS_DIR}")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")


if __name__ == "__main__":
    main()
