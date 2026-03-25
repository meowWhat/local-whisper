import { useState, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";

type OverlayStatus = "recording" | "processing" | "typing" | "done" | "error";

interface OverlayPayload {
  status: OverlayStatus;
  text?: string;
}

export default function Overlay() {
  const [status, setStatus] = useState<OverlayStatus>("recording");
  const [text, setText] = useState("");
  const [duration, setDuration] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(Date.now());

  // Listen for status updates from main window
  useEffect(() => {
    const unlisten = listen<OverlayPayload>("overlay-update", (event) => {
      const { status: s, text: t } = event.payload;
      setStatus(s);
      if (t !== undefined) setText(t || "");

      if (s === "recording") {
        startTimeRef.current = Date.now();
        setDuration(0);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Recording timer
  useEffect(() => {
    if (status === "recording") {
      timerRef.current = setInterval(() => {
        setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 200);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const statusConfig: Record<
    OverlayStatus,
    { icon: string; label: string; color: string; borderColor: string }
  > = {
    recording: {
      icon: "\u25CF",
      label: `Recording ${formatTime(duration)}`,
      color: "text-red-400",
      borderColor: "border-red-500/40",
    },
    processing: {
      icon: "\u25CC",
      label: "Transcribing...",
      color: "text-yellow-400",
      borderColor: "border-yellow-500/40",
    },
    typing: {
      icon: "\u2328",
      label: "Typing...",
      color: "text-blue-400",
      borderColor: "border-blue-500/40",
    },
    done: {
      icon: "\u2713",
      label: text || "Done",
      color: "text-green-400",
      borderColor: "border-green-500/40",
    },
    error: {
      icon: "\u2717",
      label: text || "Error",
      color: "text-red-400",
      borderColor: "border-red-500/40",
    },
  };

  const cfg = statusConfig[status];

  return (
    <div
      className="w-full h-full flex items-center justify-center"
      style={{ background: "transparent" }}
    >
      <div
        className={`flex items-center gap-2.5 px-5 py-3 rounded-2xl border shadow-2xl ${cfg.borderColor}`}
        style={{
          background: "rgba(24, 24, 27, 0.9)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
        }}
      >
        {/* Status icon */}
        <span
          className={`text-sm ${cfg.color} ${status === "recording" ? "animate-pulse" : ""}`}
        >
          {cfg.icon}
        </span>

        {/* Waveform bars for recording */}
        {status === "recording" && (
          <div className="flex items-center gap-px h-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="w-0.5 bg-red-400/80 rounded-full"
                style={{
                  animation: `wave 0.8s ease-in-out ${i * 0.1}s infinite alternate`,
                  height: "40%",
                }}
              />
            ))}
          </div>
        )}

        {/* Label */}
        <span
          className={`text-xs font-medium ${cfg.color} whitespace-nowrap max-w-48 truncate`}
        >
          {cfg.label}
        </span>
      </div>

      <style>{`
        @keyframes wave {
          0% { height: 20%; }
          100% { height: 100%; }
        }
      `}</style>
    </div>
  );
}
