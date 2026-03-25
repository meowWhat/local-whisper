"""
LLM Engine - Text optimization using llama.cpp (via llama-cpp-python).
Supports custom prompts for text correction and formatting.
"""

import logging
import time
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

DEFAULT_PROMPT = """你是一个语音转文字的后处理助手。你的任务是优化语音识别的原始输出文本。请：
1. 修正明显的识别错误
2. 添加合适的标点符号
3. 修正语法问题
4. 保持原文含义不变
5. 不要添加任何额外的解释或内容

只输出优化后的文本，不要输出任何其他内容。

原始文本：{text}

优化后的文本："""


class LLMEngine:
    def __init__(self, models_dir: Path):
        self.models_dir = models_dir
        self.llm_dir = models_dir / "llm"
        self.current_model_id: Optional[str] = None
        self._llm = None
        self._prompt_template = DEFAULT_PROMPT

    def is_loaded(self) -> bool:
        return self._llm is not None or self.current_model_id == "none"

    def set_prompt(self, prompt: str):
        """Set custom prompt template. Must contain {text} placeholder."""
        if "{text}" not in prompt:
            prompt = prompt + "\n\n{text}"
        self._prompt_template = prompt
        logger.info("LLM prompt updated")

    def get_prompt(self) -> str:
        return self._prompt_template

    async def load_model(self, model_id: str):
        """Load a LLM model by ID."""
        if model_id == self.current_model_id and (self._llm is not None or model_id == "none"):
            logger.info(f"LLM model {model_id} already loaded")
            return

        logger.info(f"Loading LLM model: {model_id}")
        self._llm = None
        self.current_model_id = None

        if model_id == "none":
            self.current_model_id = "none"
            logger.info("LLM disabled")
            return

        try:
            from llama_cpp import Llama

            model_files = {
                "qwen2.5-0.5b": "qwen2.5-0.5b-instruct-q4_k_m.gguf",
                "qwen2.5-1.5b": "qwen2.5-1.5b-instruct-q4_k_m.gguf",
            }

            filename = model_files.get(model_id)
            if not filename:
                raise ValueError(f"Unknown LLM model: {model_id}")

            model_path = self.llm_dir / filename
            if not model_path.exists():
                raise FileNotFoundError(f"Model file not found: {model_path}")

            self._llm = Llama(
                model_path=str(model_path),
                n_ctx=2048,
                n_threads=4,
                n_gpu_layers=0,  # CPU only for portability; set to -1 for GPU
                verbose=False,
            )

            self.current_model_id = model_id
            logger.info(f"LLM model {model_id} loaded successfully")

        except ImportError:
            logger.error("llama-cpp-python not installed. Install with: pip install llama-cpp-python")
            raise
        except Exception as e:
            logger.error(f"Failed to load LLM model {model_id}: {e}")
            raise

    async def optimize_text(self, text: str) -> str:
        """Optimize ASR output text using LLM."""
        if self.current_model_id == "none" or self._llm is None:
            return text

        prompt = self._prompt_template.format(text=text)

        try:
            t0 = time.time()
            response = self._llm(
                prompt,
                max_tokens=len(text) * 3 + 100,  # Allow some expansion
                temperature=0.1,
                top_p=0.9,
                stop=["\n\n", "<|endoftext|>", "<|im_end|>"],
                echo=False,
            )

            result = response["choices"][0]["text"].strip()
            elapsed = time.time() - t0
            logger.info(f"LLM optimization: {elapsed:.2f}s, input={len(text)} chars, output={len(result)} chars")

            # If LLM returns empty or garbage, fall back to original
            if not result or len(result) < len(text) * 0.3:
                logger.warning("LLM output too short, using original text")
                return text

            return result

        except Exception as e:
            logger.error(f"LLM optimization failed: {e}")
            return text
