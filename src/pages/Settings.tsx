import { useState, useEffect, useCallback } from "react";
import {
  listModels,
  downloadModel,
  updateSettings,
  getDownloadProgress,
  getSettings,
} from "../api";
import type { ModelInfo, ModelsResponse } from "../api";
import { DEFAULT_LLM_PROMPT, DEFAULT_HOTKEY } from "../store";

interface SettingsProps {
  hotkey: string;
  onHotkeyChange: (hotkey: string) => void;
  serverOk: boolean;
}

export default function Settings({
  hotkey,
  onHotkeyChange,
  serverOk,
}: SettingsProps) {
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadPct, setDownloadPct] = useState(0);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [promptDraft, setPromptDraft] = useState(DEFAULT_LLM_PROMPT);
  const [promptSaved, setPromptSaved] = useState(false);
  const [hotkeyDraft, setHotkeyDraft] = useState(hotkey);
  const [promptRestored, setPromptRestored] = useState(false);

  // Sync hotkeyDraft when hotkey prop changes (e.g. restored from backend)
  useEffect(() => {
    setHotkeyDraft(hotkey);
  }, [hotkey]);

  const fetchModels = useCallback(async () => {
    if (!serverOk) return;
    setLoading(true);
    try {
      const m = await listModels();
      setModels(m);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch models");
    } finally {
      setLoading(false);
    }
  }, [serverOk]);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  // Restore prompt from backend on first load
  useEffect(() => {
    if (!serverOk || promptRestored) return;
    const restore = async () => {
      try {
        const saved = await getSettings();
        if (saved.llm_prompt) {
          setPromptDraft(saved.llm_prompt);
        }
        setPromptRestored(true);
      } catch {
        // ignore
      }
    };
    restore();
  }, [serverOk, promptRestored]);

  // Download polling
  useEffect(() => {
    if (!downloading) return;
    const interval = setInterval(async () => {
      try {
        const p = await getDownloadProgress();
        if (p.progress !== undefined) {
          setDownloadPct(Math.round(p.progress));
        }
        if (
          p.status === "done" ||
          p.status === "complete" ||
          p.status === "idle"
        ) {
          setDownloading(null);
          setDownloadPct(0);
          fetchModels();
        }
      } catch {
        /* ignore */
      }
    }, 500);
    return () => clearInterval(interval);
  }, [downloading, fetchModels]);

  const handleDownload = async (type: string, id: string) => {
    setDownloading(id);
    setDownloadPct(0);
    try {
      await downloadModel(type, id);
      setDownloading(null);
      setDownloadPct(0);
      await fetchModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
      setDownloading(null);
      setDownloadPct(0);
    }
  };

  const handleUse = async (type: "asr" | "llm", id: string) => {
    setSwitching(id);
    setError(null);
    try {
      const settings: Record<string, string> = {};
      if (type === "asr") settings.asr_model = id;
      else settings.llm_model = id;
      await updateSettings(settings);
      await fetchModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Switch failed");
    } finally {
      setSwitching(null);
    }
  };

  const handleSavePrompt = async () => {
    try {
      await updateSettings({ llm_prompt: promptDraft });
      setPromptSaved(true);
      setTimeout(() => setPromptSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  };

  const handleSaveHotkey = () => {
    onHotkeyChange(hotkeyDraft);
  };

  const renderModelCard = (
    model: ModelInfo,
    type: "asr" | "llm",
    isCurrent: boolean
  ) => {
    const isDownloading = downloading === model.id;
    const isSwitching = switching === model.id;

    return (
      <div
        key={model.id}
        className={`flex items-center justify-between py-2.5 px-3 rounded-lg border transition-colors ${
          isCurrent
            ? "border-blue-500/30 bg-blue-500/5"
            : "border-zinc-800/50 bg-zinc-900/20 hover:border-zinc-700/50"
        }`}
      >
        <div className="flex-1 min-w-0 mr-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-200 truncate">
              {model.name}
            </span>
            {isCurrent && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
                ACTIVE
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-500 mt-0.5 truncate">
            {model.description}
          </p>
          <span className="text-[10px] text-zinc-600 font-mono">
            ~{model.size_mb}MB
          </span>
        </div>

        <div className="shrink-0">
          {!model.downloaded && !isDownloading && (
            <button
              onClick={() => handleDownload(type, model.id)}
              disabled={!!downloading}
              className="text-xs px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
            >
              Download
            </button>
          )}
          {isDownloading && (
            <div className="flex items-center gap-2">
              <div className="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all"
                  style={{ width: `${Math.min(downloadPct, 100)}%` }}
                />
              </div>
              <span className="text-[10px] text-zinc-400 font-mono w-8">
                {Math.min(downloadPct, 100)}%
              </span>
            </div>
          )}
          {model.downloaded && !isCurrent && !isSwitching && (
            <button
              onClick={() => handleUse(type, model.id)}
              className="text-xs px-3 py-1.5 rounded-md border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
            >
              Use
            </button>
          )}
          {isSwitching && (
            <span className="text-xs text-zinc-500 px-3 py-1.5">
              Loading...
            </span>
          )}
        </div>
      </div>
    );
  };

  if (!serverOk) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-600">
        <div className="text-center">
          <p className="text-sm">Waiting for backend...</p>
          <p className="text-xs mt-1 text-zinc-700">
            The Python sidecar is starting up
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-4 space-y-6">
        {error && (
          <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            {error}
            <button
              onClick={() => setError(null)}
              className="ml-2 text-red-500 hover:text-red-300"
            >
              &times;
            </button>
          </div>
        )}

        {/* Hotkey section */}
        <section>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            Hotkey
          </h3>
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={hotkeyDraft}
              onChange={(e) => setHotkeyDraft(e.target.value)}
              placeholder="e.g. Alt+Space"
              className="flex-1 text-sm bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:border-blue-500/50"
            />
            <button
              onClick={handleSaveHotkey}
              disabled={hotkeyDraft === hotkey}
              className="text-xs px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-30"
            >
              Apply
            </button>
          </div>
          <p className="text-[10px] text-zinc-600 mt-1.5">
            Press and hold this key combination in any app to record. Release to
            transcribe and type. Default: {DEFAULT_HOTKEY}
          </p>
        </section>

        {/* ASR Models */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              ASR Models
            </h3>
            <button
              onClick={fetchModels}
              disabled={loading}
              className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>
          <div className="space-y-2">
            {models?.asr_models.map((m) =>
              renderModelCard(m, "asr", m.id === models.current_asr)
            )}
          </div>
        </section>

        {/* LLM Models */}
        <section>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            LLM Models
          </h3>
          <div className="space-y-2">
            {models?.llm_models.map((m) =>
              renderModelCard(m, "llm", m.id === models.current_llm)
            )}
          </div>
        </section>

        {/* LLM Prompt */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              LLM System Prompt
            </h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPromptDraft(DEFAULT_LLM_PROMPT)}
                className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                Reset
              </button>
              <button
                onClick={handleSavePrompt}
                className="text-xs px-3 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-500 transition-colors"
              >
                {promptSaved ? "Saved!" : "Save"}
              </button>
            </div>
          </div>
          <textarea
            value={promptDraft}
            onChange={(e) => setPromptDraft(e.target.value)}
            rows={8}
            className="w-full text-xs font-mono bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-300 resize-y focus:outline-none focus:border-blue-500/50"
            placeholder="Enter your custom system prompt for LLM text optimization."
          />
          <p className="text-[10px] text-zinc-600 mt-1">
            This is the system prompt sent to the LLM. The ASR output text is
            sent as the user message. The LLM response is used as the final
            output.
          </p>
        </section>

        {/* Permissions info */}
        <section>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            Permissions
          </h3>
          <div className="text-xs text-zinc-500 space-y-1.5 bg-zinc-900/30 border border-zinc-800/30 rounded-lg p-3">
            <p>
              <strong className="text-zinc-400">Microphone:</strong> Required
              for recording audio. Grant in System Settings &gt; Privacy &gt;
              Microphone.
            </p>
            <p>
              <strong className="text-zinc-400">Accessibility:</strong> Required
              for typing text into other apps. Grant in System Settings &gt;
              Privacy &gt; Accessibility.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
