/**
 * API client for communicating with the Python sidecar server.
 */

const BASE_URL = "http://127.0.0.1:11435";

export interface TranscribeResponse {
  original_text: string;
  optimized_text: string;
  metrics: {
    audio_receive_ms: number;
    audio_size_bytes: number;
    asr_latency_ms: number;
    asr_model: string;
    llm_latency_ms: number;
    llm_model: string;
    total_latency_ms: number;
  };
}

export interface ModelInfo {
  id: string;
  name: string;
  description: string;
  size_mb: number;
  downloaded: boolean;
  engine?: string;
}

export interface ModelsResponse {
  asr_models: ModelInfo[];
  llm_models: ModelInfo[];
  current_asr: string | null;
  current_llm: string | null;
}

export interface HealthResponse {
  status: string;
  asr_loaded: boolean;
  llm_loaded: boolean;
}

export interface DownloadProgress {
  model_type?: string;
  model_id?: string;
  progress?: number;
  status?: string;
  file?: string;
}

export async function checkHealth(): Promise<HealthResponse> {
  const res = await fetch(`${BASE_URL}/api/health`);
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return res.json();
}

export async function listModels(): Promise<ModelsResponse> {
  const res = await fetch(`${BASE_URL}/api/models`);
  if (!res.ok) throw new Error(`List models failed: ${res.status}`);
  return res.json();
}

export async function downloadModel(modelType: string, modelId: string): Promise<any> {
  const formData = new FormData();
  formData.append("model_type", modelType);
  formData.append("model_id", modelId);
  const res = await fetch(`${BASE_URL}/api/models/download`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return res.json();
}

export async function getDownloadProgress(): Promise<DownloadProgress> {
  const res = await fetch(`${BASE_URL}/api/models/download-progress`);
  if (!res.ok) throw new Error(`Progress check failed: ${res.status}`);
  return res.json();
}

export async function updateSettings(settings: {
  asr_model?: string;
  llm_model?: string;
  llm_prompt?: string;
}): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error(`Settings update failed: ${res.status}`);
  return res.json();
}

export async function transcribe(audioBlob: Blob): Promise<TranscribeResponse> {
  const formData = new FormData();
  formData.append("audio", audioBlob, "recording.wav");
  const res = await fetch(`${BASE_URL}/api/transcribe`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error(`Transcribe failed: ${res.status}`);
  return res.json();
}

export async function transcribeAsrOnly(audioBlob: Blob): Promise<any> {
  const formData = new FormData();
  formData.append("audio", audioBlob, "recording.wav");
  const res = await fetch(`${BASE_URL}/api/transcribe-asr-only`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error(`Transcribe failed: ${res.status}`);
  return res.json();
}
