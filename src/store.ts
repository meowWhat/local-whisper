/**
 * Shared types and constants.
 */

export interface ConsoleEntry {
  id: string;
  timestamp: Date;
  originalText: string;
  optimizedText: string;
  metrics: {
    asr_latency_ms: number;
    llm_latency_ms: number;
    total_latency_ms: number;
    asr_model: string;
    llm_model: string;
    audio_size_bytes?: number;
  };
}

export const DEFAULT_LLM_PROMPT = `你是一个语音转文字的后处理助手。你的任务是优化语音识别的原始输出文本。请：
1. 修正明显的识别错误
2. 添加合适的标点符号
3. 修正语法问题
4. 保持原文含义不变
5. 不要添加任何额外的解释或内容

只输出优化后的文本，不要输出任何其他内容。`;

export const DEFAULT_HOTKEY = "CommandOrControl+L";
