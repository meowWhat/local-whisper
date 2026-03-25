import { useState, useEffect } from "react";
import { Download, Check, Loader2, RefreshCw, AlertCircle } from "lucide-react";
import { listModels, downloadModel, updateSettings, getDownloadProgress, ModelInfo, ModelsResponse } from "../api";
import type { ConsoleEntry } from "../store";
import { DEFAULT_LLM_PROMPT } from "../store";

interface SettingsProps {
  llmPrompt: string;
  onPromptChange: (prompt: string) => void;
  onConsoleEntry: (entry: ConsoleEntry) => void;
}

export default function Settings({ llmPrompt, onPromptChange, onConsoleEntry }: SettingsProps) {
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadPct, setDownloadPct] = useState(0);
  const [switchingAsr, setSwitchingAsr] = useState(false);
  const [switchingLlm, setSwitchingLlm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptDraft, setPromptDraft] = useState(llmPrompt);
  const [promptSaved, setPromptSaved] = useState(false);

  const fetchModels = async () => {
    setLoading(true);
    try {
      const data = await listModels();
      setModels(data);
      setError(null);
    } catch (err: any) {
      setError("Cannot connect to server. Make sure the Python sidecar is running.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchModels();
  }, []);

  const handleDownload = async (modelType: string, modelId: string) => {
    setDownloading(`${modelType}:${modelId}`);
    setDownloadPct(0);

    onConsoleEntry({
      id: crypto.randomUUID(),
      timestamp: new Date(),
      type: "info",
      message: `Downloading ${modelType} model: ${modelId}...`,
    });

    try {
      // Start download
      const downloadPromise = downloadModel(modelType, modelId);

      // Poll progress
      const progressInterval = setInterval(async () => {
        try {
          const progress = await getDownloadProgress();
          if (progress.progress) {
            setDownloadPct(progress.progress);
          }
        } catch {}
      }, 1000);

      await downloadPromise;
      clearInterval(progressInterval);

      onConsoleEntry({
        id: crypto.randomUUID(),
        timestamp: new Date(),
        type: "info",
        message: `Download complete: ${modelId}`,
      });

      await fetchModels();
    } catch (err: any) {
      onConsoleEntry({
        id: crypto.randomUUID(),
        timestamp: new Date(),
        type: "error",
        message: `Download failed: ${err.message}`,
      });
    } finally {
      setDownloading(null);
      setDownloadPct(0);
    }
  };

  const handleSwitchAsr = async (modelId: string) => {
    setSwitchingAsr(true);
    const t0 = Date.now();
    try {
      const result = await updateSettings({ asr_model: modelId });
      onConsoleEntry({
        id: crypto.randomUUID(),
        timestamp: new Date(),
        type: "info",
        message: `ASR model switched to: ${modelId}`,
        metrics: {
          "Load Time": `${result.asr_load_time_ms ?? Date.now() - t0}ms`,
        },
      });
      await fetchModels();
    } catch (err: any) {
      onConsoleEntry({
        id: crypto.randomUUID(),
        timestamp: new Date(),
        type: "error",
        message: `Failed to switch ASR model: ${err.message}`,
      });
    } finally {
      setSwitchingAsr(false);
    }
  };

  const handleSwitchLlm = async (modelId: string) => {
    setSwitchingLlm(true);
    const t0 = Date.now();
    try {
      const result = await updateSettings({ llm_model: modelId });
      onConsoleEntry({
        id: crypto.randomUUID(),
        timestamp: new Date(),
        type: "info",
        message: `LLM model switched to: ${modelId}`,
        metrics: {
          "Load Time": `${result.llm_load_time_ms ?? Date.now() - t0}ms`,
        },
      });
      await fetchModels();
    } catch (err: any) {
      onConsoleEntry({
        id: crypto.randomUUID(),
        timestamp: new Date(),
        type: "error",
        message: `Failed to switch LLM model: ${err.message}`,
      });
    } finally {
      setSwitchingLlm(false);
    }
  };

  const handleSavePrompt = async () => {
    try {
      await updateSettings({ llm_prompt: promptDraft });
      onPromptChange(promptDraft);
      setPromptSaved(true);
      setTimeout(() => setPromptSaved(false), 2000);
      onConsoleEntry({
        id: crypto.randomUUID(),
        timestamp: new Date(),
        type: "info",
        message: "LLM prompt updated",
      });
    } catch (err: any) {
      onConsoleEntry({
        id: crypto.randomUUID(),
        timestamp: new Date(),
        type: "error",
        message: `Failed to update prompt: ${err.message}`,
      });
    }
  };

  const handleResetPrompt = () => {
    setPromptDraft(DEFAULT_LLM_PROMPT);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin text-[var(--accent)]" size={32} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <AlertCircle size={48} className="text-red-400" />
        <p className="text-[var(--text-secondary)]">{error}</p>
        <button onClick={fetchModels} className="px-4 py-2 bg-[var(--accent)] rounded-lg text-sm hover:bg-[var(--accent-hover)] transition-colors">
          Retry
        </button>
      </div>
    );
  }

  const renderModelCard = (model: ModelInfo, type: "asr" | "llm", isCurrent: boolean) => {
    const isDownloading = downloading === `${type}:${model.id}`;
    const isSwitching = type === "asr" ? switchingAsr : switchingLlm;

    return (
      <div
        key={model.id}
        className={`p-4 rounded-lg border transition-colors ${
          isCurrent
            ? "border-[var(--accent)] bg-[var(--accent)]/5"
            : "border-[var(--border)] bg-[var(--bg-secondary)]"
        }`}
      >
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-sm">{model.name}</h3>
              {isCurrent && (
                <span className="px-1.5 py-0.5 text-[10px] bg-[var(--accent)]/20 text-[var(--accent)] rounded">
                  ACTIVE
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--text-secondary)] mt-1">{model.description}</p>
            <p className="text-xs text-[var(--text-secondary)] mt-1 opacity-60">
              Size: ~{model.size_mb}MB
            </p>
          </div>
          <div className="ml-4 flex-shrink-0">
            {!model.downloaded ? (
              <button
                onClick={() => handleDownload(type, model.id)}
                disabled={!!downloading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[var(--accent)] rounded-md hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50"
              >
                {isDownloading ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    {downloadPct > 0 ? `${downloadPct.toFixed(0)}%` : "..."}
                  </>
                ) : (
                  <>
                    <Download size={12} />
                    Download
                  </>
                )}
              </button>
            ) : isCurrent ? (
              <Check size={20} className="text-[var(--accent)]" />
            ) : (
              <button
                onClick={() => (type === "asr" ? handleSwitchAsr(model.id) : handleSwitchLlm(model.id))}
                disabled={isSwitching}
                className="px-3 py-1.5 text-xs border border-[var(--border)] rounded-md hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors disabled:opacity-50"
              >
                {isSwitching ? <Loader2 size={12} className="animate-spin" /> : "Use"}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto space-y-8">
        {/* ASR Models */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">ASR Models (Speech-to-Text)</h2>
            <button onClick={fetchModels} className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] transition-colors">
              <RefreshCw size={14} className="text-[var(--text-secondary)]" />
            </button>
          </div>
          <div className="space-y-3">
            {models?.asr_models.map((m) =>
              renderModelCard(m, "asr", m.id === models.current_asr)
            )}
          </div>
        </section>

        {/* LLM Models */}
        <section>
          <h2 className="text-lg font-semibold mb-4">LLM Models (Text Optimization)</h2>
          <div className="space-y-3">
            {models?.llm_models.map((m) =>
              renderModelCard(m, "llm", m.id === models.current_llm)
            )}
          </div>
        </section>

        {/* Custom Prompt */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">LLM Prompt</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={handleResetPrompt}
                className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                Reset to default
              </button>
              <button
                onClick={handleSavePrompt}
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-[var(--accent)] rounded-md hover:bg-[var(--accent-hover)] transition-colors"
              >
                {promptSaved ? <Check size={12} /> : null}
                {promptSaved ? "Saved" : "Save"}
              </button>
            </div>
          </div>
          <textarea
            value={promptDraft}
            onChange={(e) => setPromptDraft(e.target.value)}
            className="w-full h-48 p-3 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg text-sm font-mono text-[var(--text-primary)] resize-y focus:outline-none focus:border-[var(--accent)]"
            placeholder="Enter your custom prompt. Use {text} as placeholder for ASR output."
          />
          <p className="text-xs text-[var(--text-secondary)] mt-2">
            Use <code className="px-1 bg-[var(--bg-tertiary)] rounded">{"{text}"}</code> as a placeholder for the ASR output text.
          </p>
        </section>

        {/* Hotkey Info */}
        <section>
          <h2 className="text-lg font-semibold mb-4">Hotkey</h2>
          <div className="p-4 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border)]">
            <p className="text-sm text-[var(--text-secondary)]">
              Current hotkey: <kbd className="px-2 py-0.5 bg-[var(--bg-tertiary)] rounded border border-[var(--border)] text-xs font-mono text-[var(--text-primary)]">` (backtick)</kbd>
            </p>
            <p className="text-xs text-[var(--text-secondary)] mt-2 opacity-60">
              Press and hold to record, release to transcribe. Right Fn key support requires additional system configuration on macOS.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
