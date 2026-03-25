import { useState, useEffect, useCallback, useRef } from "react";
import { Mic, MicOff, Copy, Check, Loader2, AlertCircle } from "lucide-react";
import { useRecorder } from "../useRecorder";
import { transcribe, checkHealth, TranscribeResponse } from "../api";
import type { ConsoleEntry } from "../store";

interface HomeProps {
  onConsoleEntry: (entry: ConsoleEntry) => void;
}

export default function Home({ onConsoleEntry }: HomeProps) {
  const { isRecording, duration, error, startRecording, stopRecording } = useRecorder();
  const [originalText, setOriginalText] = useState("");
  const [optimizedText, setOptimizedText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [serverOk, setServerOk] = useState(false);
  const [statusMsg, setStatusMsg] = useState("Connecting to server...");
  const keyDownRef = useRef(false);

  // Health check
  useEffect(() => {
    const check = async () => {
      try {
        const h = await checkHealth();
        setServerOk(h.status === "ok");
        if (h.asr_loaded) {
          setStatusMsg("Ready - Press and hold Right Fn to record");
        } else {
          setStatusMsg("Server connected. Please load an ASR model in Settings.");
        }
      } catch {
        setServerOk(false);
        setStatusMsg("Server not connected. Start the Python sidecar first.");
      }
    };
    check();
    const interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, []);

  // Handle recording result
  const handleStopAndTranscribe = useCallback(async () => {
    const blob = await stopRecording();
    if (!blob) return;

    setIsProcessing(true);
    const startTime = Date.now();

    onConsoleEntry({
      id: crypto.randomUUID(),
      timestamp: new Date(),
      type: "info",
      message: `Recording stopped. Audio size: ${(blob.size / 1024).toFixed(1)} KB. Processing...`,
    });

    try {
      const result: TranscribeResponse = await transcribe(blob);
      setOriginalText(result.original_text);
      setOptimizedText(result.optimized_text || result.original_text);

      // Log ASR metrics
      onConsoleEntry({
        id: crypto.randomUUID(),
        timestamp: new Date(),
        type: "asr",
        message: `ASR: "${result.original_text.substring(0, 80)}${result.original_text.length > 80 ? "..." : ""}"`,
        metrics: {
          "Model": result.metrics.asr_model,
          "Latency": `${result.metrics.asr_latency_ms}ms`,
          "Audio Size": `${(result.metrics.audio_size_bytes / 1024).toFixed(1)}KB`,
        },
      });

      // Log LLM metrics if applicable
      if (result.metrics.llm_latency_ms !== undefined) {
        onConsoleEntry({
          id: crypto.randomUUID(),
          timestamp: new Date(),
          type: "llm",
          message: `LLM: "${(result.optimized_text || "").substring(0, 80)}${(result.optimized_text || "").length > 80 ? "..." : ""}"`,
          metrics: {
            "Model": result.metrics.llm_model,
            "Latency": `${result.metrics.llm_latency_ms}ms`,
          },
        });
      }

      // Log total pipeline
      onConsoleEntry({
        id: crypto.randomUUID(),
        timestamp: new Date(),
        type: "pipeline",
        message: `Pipeline complete`,
        metrics: {
          "Total": `${result.metrics.total_latency_ms}ms`,
          "ASR": `${result.metrics.asr_latency_ms}ms`,
          "LLM": `${result.metrics.llm_latency_ms ?? "N/A"}`,
          "E2E (incl. network)": `${Date.now() - startTime}ms`,
        },
      });
    } catch (err: any) {
      onConsoleEntry({
        id: crypto.randomUUID(),
        timestamp: new Date(),
        type: "error",
        message: `Transcription failed: ${err.message}`,
      });
    } finally {
      setIsProcessing(false);
    }
  }, [stopRecording, onConsoleEntry]);

  // Keyboard shortcut: use F24 (mapped from right Fn on macOS) or F19
  // Fallback: use ` (backtick) key for testing
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Use backtick (`) as hotkey for testing, or F19/F24
      if ((e.key === "`" || e.key === "F19" || e.key === "F24" || e.code === "Fn") && !keyDownRef.current) {
        e.preventDefault();
        keyDownRef.current = true;
        startRecording();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if ((e.key === "`" || e.key === "F19" || e.key === "F24" || e.code === "Fn") && keyDownRef.current) {
        e.preventDefault();
        keyDownRef.current = false;
        handleStopAndTranscribe();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [startRecording, handleStopAndTranscribe]);

  const handleCopy = () => {
    const text = optimizedText || originalText;
    if (text) {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const displayText = optimizedText || originalText;

  return (
    <div className="flex flex-col h-full p-6 gap-4">
      {/* Status Bar */}
      <div className="flex items-center gap-2 text-sm">
        <div className={`w-2 h-2 rounded-full ${serverOk ? "bg-green-500" : "bg-red-500"}`} />
        <span className="text-[var(--text-secondary)]">{statusMsg}</span>
      </div>

      {/* Recording Area */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6">
        {/* Mic Button */}
        <button
          onMouseDown={startRecording}
          onMouseUp={handleStopAndTranscribe}
          onMouseLeave={() => {
            if (isRecording) handleStopAndTranscribe();
          }}
          disabled={!serverOk || isProcessing}
          className={`w-28 h-28 rounded-full flex items-center justify-center transition-all duration-200 ${
            isRecording
              ? "bg-red-500/20 border-2 border-red-500 scale-110 shadow-[0_0_30px_rgba(239,68,68,0.3)]"
              : isProcessing
              ? "bg-[var(--bg-tertiary)] border-2 border-[var(--border)] cursor-wait"
              : "bg-[var(--bg-tertiary)] border-2 border-[var(--border)] hover:border-[var(--accent)] hover:bg-[var(--accent)]/10 cursor-pointer"
          }`}
        >
          {isProcessing ? (
            <Loader2 size={40} className="text-[var(--accent)] animate-spin" />
          ) : isRecording ? (
            <Mic size={40} className="text-red-500 animate-pulse" />
          ) : (
            <MicOff size={40} className="text-[var(--text-secondary)]" />
          )}
        </button>

        {/* Duration */}
        {isRecording && (
          <div className="text-lg font-mono text-red-400">
            {duration.toFixed(1)}s
          </div>
        )}

        {/* Instructions */}
        {!isRecording && !isProcessing && !displayText && (
          <div className="text-center text-[var(--text-secondary)] text-sm max-w-md">
            <p className="mb-2">Press and hold <kbd className="px-2 py-0.5 bg-[var(--bg-tertiary)] rounded border border-[var(--border)] text-xs font-mono">` (backtick)</kbd> to record</p>
            <p className="text-xs opacity-60">Or click and hold the microphone button</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 text-red-400 text-sm">
            <AlertCircle size={16} />
            {error}
          </div>
        )}
      </div>

      {/* Result Area */}
      {displayText && (
        <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border)] p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[var(--text-secondary)] uppercase tracking-wider">
              {optimizedText && optimizedText !== originalText ? "Optimized Result" : "Transcription Result"}
            </span>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
            >
              {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="text-base leading-relaxed">{displayText}</p>
          {optimizedText && optimizedText !== originalText && (
            <details className="mt-3">
              <summary className="text-xs text-[var(--text-secondary)] cursor-pointer hover:text-[var(--text-primary)]">
                Show original ASR output
              </summary>
              <p className="mt-1 text-sm text-[var(--text-secondary)] leading-relaxed">{originalText}</p>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
