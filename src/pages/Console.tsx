import { useEffect, useRef } from "react";
import { Trash2, Clock, Cpu, Brain, Zap, AlertCircle, Info } from "lucide-react";
import type { ConsoleEntry } from "../store";

interface ConsoleProps {
  entries: ConsoleEntry[];
  onClear: () => void;
}

const typeConfig: Record<string, { icon: any; color: string; label: string }> = {
  asr: { icon: Cpu, color: "text-blue-400", label: "ASR" },
  llm: { icon: Brain, color: "text-purple-400", label: "LLM" },
  pipeline: { icon: Zap, color: "text-yellow-400", label: "PIPELINE" },
  info: { icon: Info, color: "text-[var(--text-secondary)]", label: "INFO" },
  error: { icon: AlertCircle, color: "text-red-400", label: "ERROR" },
};

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }) + "." + String(date.getMilliseconds()).padStart(3, "0");
}

export default function Console({ entries, onClear }: ConsoleProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <Clock size={16} className="text-[var(--text-secondary)]" />
          <h2 className="text-sm font-semibold">Performance Console</h2>
          <span className="text-xs text-[var(--text-secondary)]">({entries.length} entries)</span>
        </div>
        <button
          onClick={onClear}
          className="flex items-center gap-1 px-2 py-1 text-xs text-[var(--text-secondary)] hover:text-red-400 rounded transition-colors"
        >
          <Trash2 size={12} />
          Clear
        </button>
      </div>

      {/* Entries */}
      <div className="flex-1 overflow-y-auto p-2 font-mono text-xs">
        {entries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--text-secondary)]">
            <p>No entries yet. Start recording to see performance metrics.</p>
          </div>
        ) : (
          entries.map((entry) => {
            const config = typeConfig[entry.type] || typeConfig.info;
            const Icon = config.icon;

            return (
              <div
                key={entry.id}
                className="flex gap-2 py-1.5 px-2 rounded hover:bg-[var(--bg-secondary)] transition-colors group"
              >
                {/* Timestamp */}
                <span className="text-[var(--text-secondary)] opacity-60 flex-shrink-0 w-[85px]">
                  {formatTime(entry.timestamp)}
                </span>

                {/* Type badge */}
                <span className={`flex items-center gap-1 flex-shrink-0 w-[80px] ${config.color}`}>
                  <Icon size={11} />
                  {config.label}
                </span>

                {/* Message */}
                <span className="text-[var(--text-primary)] flex-1 break-all">
                  {entry.message}
                </span>

                {/* Metrics */}
                {entry.metrics && (
                  <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                    {Object.entries(entry.metrics).map(([key, value]) => (
                      <span key={key} className="text-[var(--text-secondary)]">
                        <span className="opacity-60">{key}:</span>{" "}
                        <span className={
                          typeof value === "string" && value.endsWith("ms")
                            ? parseInt(value) < 200
                              ? "text-green-400"
                              : parseInt(value) < 1000
                              ? "text-yellow-400"
                              : "text-red-400"
                            : "text-[var(--text-primary)]"
                        }>
                          {value}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Summary bar */}
      {entries.length > 0 && (
        <div className="flex items-center gap-4 px-4 py-2 border-t border-[var(--border)] text-xs text-[var(--text-secondary)]">
          {(() => {
            const pipelineEntries = entries.filter((e) => e.type === "pipeline" && e.metrics);
            if (pipelineEntries.length === 0) return <span>No pipeline metrics yet</span>;

            const latencies = pipelineEntries
              .map((e) => {
                const total = e.metrics?.["Total"];
                return typeof total === "string" ? parseInt(total) : null;
              })
              .filter((v): v is number => v !== null);

            if (latencies.length === 0) return null;

            const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
            const min = Math.min(...latencies);
            const max = Math.max(...latencies);

            return (
              <>
                <span>Runs: {latencies.length}</span>
                <span>Avg: <span className="text-[var(--text-primary)]">{avg.toFixed(0)}ms</span></span>
                <span>Min: <span className="text-green-400">{min}ms</span></span>
                <span>Max: <span className="text-red-400">{max}ms</span></span>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
