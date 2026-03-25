"""
LLM Engine - Text optimization using llama.cpp (via llama-cpp-python).
Supports custom prompts for text correction and formatting.
Updated to use Qwen3 models with chat completion format.
Thinking mode is disabled for speed - only final output is produced.
"""

import logging
import re
import time
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

DEFAULT_SYSTEM_PROMPT = """你是一个语音转文字的后处理助手。你的任务是优化语音识别的原始输出文本。请：
1. 修正明显的识别错误
2. 添加合适的标点符号
3. 修正语法问题
4. 保持原文含义不变
5. 不要添加任何额外的解释或内容

只输出优化后的文本，不要输出任何其他内容。"""

# Model filename mapping
MODEL_FILES = {
    "qwen3-0.6b": "Qwen3-0.6B-Q8_0.gguf",
    "qwen3-1.7b": "Qwen_Qwen3-1.7B-Q4_K_M.gguf",
    # Legacy models (still supported if user has them)
    "qwen2.5-0.5b": "qwen2.5-0.5b-instruct-q4_k_m.gguf",
    "qwen2.5-1.5b": "qwen2.5-1.5b-instruct-q4_k_m.gguf",
}


class LLMEngine:
    def __init__(self, models_dir: Path):
        self.models_dir = models_dir
        self.llm_dir = models_dir / "llm"
        self.current_model_id: Optional[str] = None
        self._llm = None
        self._system_prompt = DEFAULT_SYSTEM_PROMPT

    def is_loaded(self) -> bool:
        return self._llm is not None or self.current_model_id == "none"

    def set_prompt(self, prompt: str):
        """Set custom system prompt for text optimization."""
        self._system_prompt = prompt
        logger.info("LLM system prompt updated")

    def get_prompt(self) -> str:
        return self._system_prompt

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

            filename = MODEL_FILES.get(model_id)
            if not filename:
                raise ValueError(f"Unknown LLM model: {model_id}")

            model_path = self.llm_dir / filename
            if not model_path.exists():
                raise FileNotFoundError(f"Model file not found: {model_path}")

            self._llm = Llama(
                model_path=str(model_path),
                n_ctx=2048,
                n_threads=4,
                n_gpu_layers=0,  # CPU only for portability; set to -1 for GPU on Metal
                verbose=False,
                chat_format="chatml",  # Qwen models use ChatML format
            )

            self.current_model_id = model_id
            logger.info(f"LLM model {model_id} loaded successfully")

        except ImportError:
            logger.error("llama-cpp-python not installed. Install with: pip install llama-cpp-python")
            raise
        except Exception as e:
            logger.error(f"Failed to load LLM model {model_id}: {e}")
            raise

    def _strip_thinking(self, text: str) -> str:
        """Remove any <think>...</think> blocks from the output."""
        cleaned = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
        return cleaned if cleaned else text

    async def optimize_text(self, text: str) -> str:
        """Optimize ASR output text using LLM. Thinking mode is disabled."""
        if self.current_model_id == "none" or self._llm is None:
            return text

        try:
            t0 = time.time()

            # Build system prompt with /no_think to disable Qwen3 thinking mode
            # This tells Qwen3 to skip the internal reasoning and output directly
            system_content = self._system_prompt + "\n/no_think"

            messages = [
                {"role": "system", "content": system_content},
                {"role": "user", "content": text},
            ]

            response = self._llm.create_chat_completion(
                messages=messages,
                max_tokens=len(text) * 3 + 100,
                temperature=0.1,
                top_p=0.9,
                stop=["<|endoftext|>", "<|im_end|>"],
            )

            raw_content = response["choices"][0]["message"]["content"]
            result = raw_content.strip() if raw_content else ""
            elapsed = time.time() - t0

            logger.info(f"LLM raw response: {repr(raw_content)}")

            # Safety: strip any thinking tags that might still appear
            before_strip = result
            result = self._strip_thinking(result)

            if before_strip != result:
                logger.info(f"LLM after strip_thinking: {repr(result)}")

            logger.info(
                f"LLM optimization: {elapsed:.2f}s, "
                f"input={len(text)} chars, output={len(result)} chars"
            )
            logger.info(f"LLM input:  {text}")
            logger.info(f"LLM output: {result}")

            # If LLM returns completely empty, fall back to original
            if not result:
                logger.warning("LLM returned empty, using original text")
                return text

            return result

        except Exception as e:
            logger.error(f"LLM optimization failed: {e}")
            return text
