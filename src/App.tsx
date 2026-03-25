import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { emit } from "@tauri-apps/api/event";
import Console from "./pages/Console";
import Settings from "./pages/Settings";
import { checkHealth, transcribeFile, getSettings, saveHotkey } from "./api";
import { ConsoleEntry, DEFAULT_HOTKEY } from "./store";

type Tab = "console" | "settings";
type RecordingStatus = "idle" | "recording" | "processing" | "done" | "error";

function App() {
  const [activeTab, setActiveTab] = useState<Tab>("settings");
  const [serverOk, setServerOk] = useState(false);
  const [asrLoaded, setAsrLoaded] = useState(false);
  const [status, setStatus] = useState<RecordingStatus>("idle");
  const [statusText, setStatusText] = useState("");
  const [hotkey, setHotkey] = useState(DEFAULT_HOTKEY);
  const [logs, setLogs] = useState<ConsoleEntry[]>([]);
  const [settingsRestored, setSettingsRestored] = useState(false);
  const recordingStartTime = useRef<number>(0);
  const serverOkRef = useRef(false);

  // ---------------------------------------------------------------------------
  // Overlay window management (via Rust commands - window pre-created in setup)
  // ---------------------------------------------------------------------------

  const showOverlay = useCallback(async (overlayStatus: string, text?: string) => {
    try {
      // First emit the status update so overlay has data when shown
      await emit("overlay-update", { status: overlayStatus, text: text || "" });
      // Then show the pre-created hidden window
      await invoke("show_overlay");
    } catch (err) {
      console.error("Overlay show error:", err);
    }
  }, []);

  const hideOverlay = useCallback(async () => {
    try {
      await invoke("hide_overlay");
    } catch (err) {
      console.error("Overlay hide error:", err);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Health check polling
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const check = async () => {
      try {
        const h = await checkHealth();
        const ok = h.status === "ok";
        setServerOk(ok);
        serverOkRef.current = ok;
        setAsrLoaded(h.asr_loaded);
      } catch {
        setServerOk(false);
        serverOkRef.current = false;
        setAsrLoaded(false);
      }
    };
    check();
    const interval = setInterval(check, 3000);
    return () => clearInterval(interval);
  }, []);

  // Restore settings from backend on first server connection
  useEffect(() => {
    if (!serverOk || settingsRestored) return;

    const restore = async () => {
      try {
        const saved = await getSettings();
        if (saved.hotkey) {
          setHotkey(saved.hotkey);
        }
        setSettingsRestored(true);
        console.log("Settings restored from backend:", saved);
      } catch (err) {
        console.error("Failed to restore settings:", err);
      }
    };
    restore();
  }, [serverOk, settingsRestored]);

  // ---------------------------------------------------------------------------
  // Add log entry
  // ---------------------------------------------------------------------------

  const addLog = useCallback((entry: ConsoleEntry) => {
    setLogs((prev) => [entry, ...prev].slice(0, 200));
  }, []);

  // ---------------------------------------------------------------------------
  // Core pipeline: stop recording -> transcribe -> type text
  // ---------------------------------------------------------------------------

  const handleStopAndTranscribe = useCallback(async () => {
    try {
      setStatus("processing");
      setStatusText("Transcribing...");
      await emit("overlay-update", { status: "processing", text: "" });

      // Stop recording and get WAV path
      const wavPath: string = await invoke("stop_recording");

      // Send to Python sidecar for ASR + LLM
      const result = await transcribeFile(wavPath);

      const finalText = result.optimized_text || result.original_text;

      if (finalText && finalText.trim()) {
        setStatus("processing");
        setStatusText("Typing...");
        await emit("overlay-update", { status: "typing", text: "" });

        // Hide overlay before typing so the target app regains focus
        await hideOverlay();

        // Small delay to ensure focus returns to the target app
        await new Promise((r) => setTimeout(r, 150));

        // Type the text into the currently focused application
        await invoke("type_text", { text: finalText });

        // Log to console
        addLog({
          id: crypto.randomUUID(),
          timestamp: new Date(),
          originalText: result.original_text,
          optimizedText: result.optimized_text,
          metrics: result.metrics,
        });

        setStatus("done");
        setStatusText("Done!");
      } else {
        setStatus("done");
        setStatusText("No speech detected");
        await hideOverlay();
      }
    } catch (err) {
      console.error("Pipeline error:", err);
      setStatus("error");
      const errMsg = err instanceof Error ? err.message : "Error";
      setStatusText(errMsg);
      await emit("overlay-update", { status: "error", text: errMsg });
      setTimeout(() => hideOverlay(), 1500);
    }

    // Reset after a short delay
    setTimeout(() => {
      setStatus("idle");
      setStatusText("");
    }, 1200);
  }, [addLog, hideOverlay]);

  // ---------------------------------------------------------------------------
  // Handle hotkey change with persistence
  // ---------------------------------------------------------------------------

  const handleHotkeyChange = useCallback(async (newHotkey: string) => {
    setHotkey(newHotkey);
    try {
      await saveHotkey(newHotkey);
    } catch (err) {
      console.error("Failed to save hotkey:", err);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Register global shortcut
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    const setup = async () => {
      try {
        await unregisterAll();
        await register(hotkey, async (event) => {
          if (cancelled) return;

          if (event.state === "Pressed") {
            try {
              await invoke("start_recording");
              recordingStartTime.current = Date.now();
              setStatus("recording");
              setStatusText("Recording...");
              await showOverlay("recording");
            } catch (err) {
              console.error("Start recording error:", err);
              setStatus("error");
              setStatusText(
                err instanceof Error ? err.message : "Record error"
              );
              await showOverlay("error", err instanceof Error ? err.message : "Record error");
              setTimeout(() => {
                setStatus("idle");
                setStatusText("");
                hideOverlay();
              }, 2000);
            }
          } else if (event.state === "Released") {
            const elapsed = Date.now() - recordingStartTime.current;
            if (elapsed > 300) {
              handleStopAndTranscribe();
            } else {
              try {
                await invoke("stop_recording");
              } catch {
                /* ignore */
              }
              setStatus("idle");
              setStatusText("");
              await hideOverlay();
            }
          }
        });
        console.log(`Global shortcut registered: ${hotkey}`);
      } catch (err) {
        console.error("Failed to register shortcut:", err);
      }
    };

    setup();

    return () => {
      cancelled = true;
      unregisterAll().catch(() => {});
    };
  }, [hotkey, handleStopAndTranscribe, showOverlay, hideOverlay]);

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------

  const tabs: { id: Tab; label: string }[] = [
    { id: "console", label: "Console" },
    { id: "settings", label: "Settings" },
  ];

  const statusColor = {
    idle: "bg-zinc-700",
    recording: "bg-red-500 animate-pulse",
    processing: "bg-yellow-500 animate-pulse",
    done: "bg-green-500",
    error: "bg-red-500",
  }[status];

  const statusLabel =
    status === "idle"
      ? serverOk
        ? asrLoaded
          ? `Ready (${hotkey})`
          : "ASR not loaded"
        : "Backend connecting..."
      : statusText;

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-200">
      {/* Header */}
      <header
        className="flex items-center justify-between px-4 h-11 border-b border-zinc-800/60 shrink-0 bg-zinc-900/50"
        data-tauri-drag-region="true"
      >
        <div className="flex items-center gap-3" data-tauri-drag-region="true">
          <span
            className="text-sm font-semibold text-zinc-300 tracking-tight"
            data-tauri-drag-region="true"
          >
            Local Whisper
          </span>
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-zinc-800/50">
            <div className={`w-1.5 h-1.5 rounded-full ${statusColor}`} />
            <span className="text-[10px] text-zinc-400 font-mono">
              {statusLabel}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                activeTab === tab.id
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 min-h-0 overflow-hidden">
        {activeTab === "console" && (
          <Console logs={logs} onClear={() => setLogs([])} />
        )}
        {activeTab === "settings" && (
          <Settings
            hotkey={hotkey}
            onHotkeyChange={handleHotkeyChange}
            serverOk={serverOk}
          />
        )}
      </main>
    </div>
  );
}

export default App;
