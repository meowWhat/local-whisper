"""
LLM Engine - Text optimization using llama.cpp (via llama-cpp-python).

Designed for ASR post-processing: corrects recognition errors, adds punctuation,
and applies user-defined formatting rules. Thinking mode is fully disabled by
pre-filling an empty <think> block in the assistant response, forcing the model
to skip reasoning and output directly.
"""

import logging
import re
import time
import concurrent.futures
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

DEFAULT_SYSTEM_PROMPT = (
    "你是语音转文字的后处理工具。直接输出修正后的文本，不要解释。"
    "修正识别错误和语法问题，添加标点符号，保持原意不变。"
)

# Model filename mapping
MODEL_FILES = {
    "qwen3.5-2b": "Qwen3.5-2B-Q4_K_M.gguf",
    "qwen3.5-0.8b": "Qwen3.5-0.8B-Q4_K_M.gguf",
    "qwen3-0.6b": "Qwen3-0.6B-Q8_0.gguf",
    "qwen3-1.7b": "Qwen_Qwen3-1.7B-Q4_K_M.gguf",
    # Legacy models (still supported if user has them)
    "qwen2.5-0.5b": "qwen2.5-0.5b-instruct-q4_k_m.gguf",
    "qwen2.5-1.5b": "qwen2.5-1.5b-instruct-q4_k_m.gguf",
}

# Timeout for LLM inference (seconds). If exceeded, fall back to original text.
LLM_TIMEOUT_SECONDS = 5.0


class LLMEngine:
    def __init__(self, models_dir: Path):
        self.models_dir = models_dir
        self.llm_dir = models_dir / "llm"
        self.current_model_id: Optional[str] = None
        self._llm = None
        self._system_prompt = DEFAULT_SYSTEM_PROMPT
        # Thread pool for running sync llama-cpp calls with timeout
        self._executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)

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

            # Do NOT set chat_format — we use raw prompt mode to control thinking
            self._llm = Llama(
                model_path=str(model_path),
                n_ctx=512,          # Short context — ASR segments are typically < 200 chars
                n_threads=4,
                n_gpu_layers=0,     # CPU only for portability
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

    def _strip_thinking(self, text: str) -> str:
        """Remove any <think>...</think> blocks from the output.
        Safety net in case thinking mode leaks through."""
        cleaned = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
        return cleaned if cleaned else text

    def _build_prompt(self, text: str) -> str:
        """Build a ChatML prompt with pre-filled empty <think> block.

        This is the key trick to disable thinking in Qwen3/3.5 models:
        by pre-filling `<think>\\n</think>\\n` at the start of the assistant
        response, the model skips its internal reasoning and outputs directly.
        """
        system = self._system_prompt.strip()
        return (
            f"<|im_start|>system\n{system}<|im_end|>\n"
            f"<|im_start|>user\n{text}<|im_end|>\n"
            f"<|im_start|>assistant\n<think>\n</think>\n"
        )

    def _run_inference(self, prompt: str, max_tokens: int) -> str:
        """Run LLM inference synchronously (called from thread pool)."""
        response = self._llm(
            prompt,
            max_tokens=max_tokens,
            temperature=0.0,        # Deterministic — no creativity needed for text cleanup
            top_p=1.0,
            repeat_penalty=1.1,     # Prevent repetitive output
            stop=["<|im_end|>", "<|endoftext|>", "<|im_start|>"],
        )
        raw_text = response["choices"][0]["text"]
        return raw_text.strip() if raw_text else ""

    async def optimize_text(self, text: str) -> str:
        """Optimize ASR output text using LLM.

        Uses raw prompt mode with pre-filled empty <think> block to
        completely bypass thinking. If inference exceeds the timeout,
        the original text is returned to avoid blocking the user.
        """
        if self.current_model_id == "none" or self._llm is None:
            return text

        # Skip very short text (single word / punctuation)
        if len(text.strip()) < 2:
            return text

        try:
            t0 = time.time()

            prompt = self._build_prompt(text)

            # Max tokens: proportional to input but capped
            max_tokens = min(len(text) * 3 + 50, 400)

            # Run inference with timeout protection
            import asyncio
            loop = asyncio.get_event_loop()
            try:
                result = await asyncio.wait_for(
                    loop.run_in_executor(self._executor, self._run_inference, prompt, max_tokens),
                    timeout=LLM_TIMEOUT_SECONDS,
                )
            except asyncio.TimeoutError:
                elapsed = time.time() - t0
                logger.warning(f"LLM timeout after {elapsed:.1f}s, using original text")
                return text

            elapsed = time.time() - t0

            # Safety: strip any leaked thinking blocks
            result = self._strip_thinking(result)

            logger.info(f"LLM [{self.current_model_id}] {elapsed:.2f}s | "
                        f"in={len(text)}c out={len(result)}c")
            logger.info(f"  ASR: {text}")
            logger.info(f"  LLM: {result}")

            # Fall back to original if LLM returns empty
            if not result:
                logger.warning("LLM returned empty, using original text")
                return text

            return result

        except Exception as e:
            logger.error(f"LLM optimization failed: {e}")
            return text
