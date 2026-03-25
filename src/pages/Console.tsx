import { useRef, useEffect } from "react";
import type { ConsoleEntry } from "../store";

interface ConsoleProps {
  logs: ConsoleEntry[];
  onClear: () => void;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function latencyColor(ms: number): string {
  if (ms < 200) return "text-green-400";
  if (ms < 1000) return "text-amber-400";
  return "text-red-400";
}

function latencyBg(ms: number): string {
  if (ms < 200) return "bg-green-500/10";
  if (ms < 1000) return "bg-amber-500/10";
  return "bg-red-500/10";
}

export default function Console({ logs, onClear }: ConsoleProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const avgAsr =
    logs.length > 0
      ? logs.reduce((s, l) => s + (l.metrics.asr_latency_ms || 0), 0) / logs.length
      : 0;
  const avgLlm =
    logs.length > 0
      ? logs.reduce((s, l) => s + (l.metrics.llm_latency_ms || 0), 0) / logs.length
      : 0;
  const avgTotal =
    logs.length > 0
      ? logs.reduce((s, l) => s + (l.metrics.total_latency_ms || 0), 0) / logs.length
      : 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800/40">
        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-500 font-mono">
            {logs.length} entries
          </span>
          {logs.length > 0 && (
            <div className="flex items-center gap-2 text-[10px] font-mono">
              <span className="text-zinc-600">AVG:</span>
              <span className={latencyColor(avgAsr)}>ASR {formatMs(avgAsr)}</span>
              <span className="text-zinc-700">/</span>
              <span className={latencyColor(avgLlm)}>LLM {formatMs(avgLlm)}</span>
              <span className="text-zinc-700">/</span>
              <span className={latencyColor(avgTotal)}>Total {formatMs(avgTotal)}</span>
            </div>
          )}
        </div>
        {logs.length > 0 && (
          <button
            onClick={onClear}
            className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Log list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-600">
            <p className="text-sm">No transcriptions yet</p>
            <p className="text-xs mt-1 text-zinc-700">
              Press and hold the hotkey to start recording
            </p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/30">
            {logs.map((entry) => (
              <div key={entry.id} className="px-4 py-3 hover:bg-zinc-800/20 transition-colors">
                <div className="flex items-center gap-3 mb-2 flex-wrap">
                  <span className="text-[10px] text-zinc-600 font-mono tabular-nums">
                    {entry.timestamp.toLocaleTimeString()}
                  </span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${latencyBg(entry.metrics.asr_latency_ms)} ${latencyColor(entry.metrics.asr_latency_ms)}`}>
                      ASR {formatMs(entry.metrics.asr_latency_ms)}
                    </span>
                    {entry.metrics.llm_latency_ms > 0 && (
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${latencyBg(entry.metrics.llm_latency_ms)} ${latencyColor(entry.metrics.llm_latency_ms)}`}>
                        LLM {formatMs(entry.metrics.llm_latency_ms)}
                      </span>
                    )}
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${latencyBg(entry.metrics.total_latency_ms)} ${latencyColor(entry.metrics.total_latency_ms)}`}>
                      Total {formatMs(entry.metrics.total_latency_ms)}
                    </span>
                  </div>
                </div>
                <div className="space-y-1">
                  {entry.optimizedText && entry.optimizedText !== entry.originalText && (
                    <p className="text-xs text-zinc-600 line-through">{entry.originalText}</p>
                  )}
                  <p className="text-sm text-zinc-200">{entry.optimizedText || entry.originalText}</p>
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-[9px] text-zinc-700 font-mono">{entry.metrics.asr_model}</span>
                  {entry.metrics.llm_model && entry.metrics.llm_model !== "none" && (
                    <>
                      <span className="text-zinc-800">&rarr;</span>
                      <span className="text-[9px] text-zinc-700 font-mono">{entry.metrics.llm_model}</span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Legend footer */}
      <div className="flex items-center justify-center gap-4 px-4 py-1.5 border-t border-zinc-800/40 text-[9px] text-zinc-600">
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> &lt;200ms
        </span>
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> &lt;1s
        </span>
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> &gt;1s
        </span>
      </div>
    </div>
  );
}
