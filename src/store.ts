/**
 * Global state store using React context.
 */

// Global state types and defaults

export interface ConsoleEntry {
  id: string;
  timestamp: Date;
  type: "asr" | "llm" | "pipeline" | "info" | "error";
  message: string;
  metrics?: Record<string, number | string>;
}

export interface AppState {
  // Server status
  serverConnected: boolean;
  asrLoaded: boolean;
  llmLoaded: boolean;

  // Current models
  currentAsrModel: string | null;
  currentLlmModel: string | null;

  // Recording
  isRecording: boolean;
  recordingDuration: number;

  // Results
  lastOriginalText: string;
  lastOptimizedText: string;

  // Console
  consoleEntries: ConsoleEntry[];

  // Settings
  llmPrompt: string;
  enableLlm: boolean;
  hotkey: string;
}

export const DEFAULT_LLM_PROMPT = `你是一个语音转文字的后处理助手。你的任务是优化语音识别的原始输出文本。请：
1. 修正明显的识别错误
2. 添加合适的标点符号
3. 修正语法问题
4. 保持原文含义不变
5. 不要添加任何额外的解释或内容

只输出优化后的文本，不要输出任何其他内容。

原始文本：{text}

优化后的文本：`;

export const initialState: AppState = {
  serverConnected: false,
  asrLoaded: false,
  llmLoaded: false,
  currentAsrModel: null,
  currentLlmModel: null,
  isRecording: false,
  recordingDuration: 0,
  lastOriginalText: "",
  lastOptimizedText: "",
  consoleEntries: [],
  llmPrompt: DEFAULT_LLM_PROMPT,
  enableLlm: true,
  hotkey: "Right Fn",
};
