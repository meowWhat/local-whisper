import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";

interface OnboardingProps {
  onComplete: () => void;
  hotkey: string;
}

type Step = "welcome" | "microphone" | "accessibility" | "ready";

/** Human-readable display of an accelerator string */
function formatHotkeyDisplay(accelerator: string): string {
  return accelerator
    .replace(/CommandOrControl/g, "\u2318")
    .replace(/Shift/g, "\u21E7")
    .replace(/Alt/g, "\u2325")
    .replace(/\+/g, " + ");
}

export default function Onboarding({ onComplete, hotkey }: OnboardingProps) {
  const [step, setStep] = useState<Step>("welcome");
  const [micGranted, setMicGranted] = useState(false);
  const [accessGranted, setAccessGranted] = useState(false);
  const [checkingMic, setCheckingMic] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(false);

  // Check accessibility permission
  const checkAccessibility = useCallback(async () => {
    setCheckingAccess(true);
    try {
      const granted = await invoke<boolean>("check_accessibility");
      setAccessGranted(granted);
      return granted;
    } catch {
      setAccessGranted(false);
      return false;
    } finally {
      setCheckingAccess(false);
    }
  }, []);

  // Check microphone permission by trying to start/stop recording
  const checkMicrophone = useCallback(async () => {
    setCheckingMic(true);
    try {
      await invoke("start_recording");
      // Small delay then stop
      await new Promise((r) => setTimeout(r, 200));
      await invoke("stop_recording");
      setMicGranted(true);
      return true;
    } catch {
      setMicGranted(false);
      return false;
    } finally {
      setCheckingMic(false);
    }
  }, []);

  // Auto-check permissions when entering relevant steps
  useEffect(() => {
    if (step === "microphone") {
      checkMicrophone();
    } else if (step === "accessibility") {
      checkAccessibility();
    }
  }, [step, checkMicrophone, checkAccessibility]);

  // Poll for permission changes on mic/access steps
  useEffect(() => {
    if (step !== "microphone" && step !== "accessibility") return;

    const interval = setInterval(async () => {
      if (step === "microphone") {
        await checkMicrophone();
      } else if (step === "accessibility") {
        await checkAccessibility();
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [step, checkMicrophone, checkAccessibility]);

  const openSystemPrefs = async (pane: string) => {
    try {
      await open(pane);
    } catch {
      // Fallback
      try {
        await open("x-apple.systempreferences:");
      } catch {
        // ignore
      }
    }
  };

  const stepContent: Record<Step, React.ReactNode> = {
    welcome: (
      <div className="flex flex-col items-center text-center space-y-6">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-3xl shadow-lg shadow-blue-500/20">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 text-white">
            <path d="M8.25 4.5a3.75 3.75 0 117.5 0v8.25a3.75 3.75 0 11-7.5 0V4.5z" />
            <path d="M6 10.5a.75.75 0 01.75.75v1.5a5.25 5.25 0 1010.5 0v-1.5a.75.75 0 011.5 0v1.5a6.751 6.751 0 01-6 6.709v2.291h3a.75.75 0 010 1.5h-7.5a.75.75 0 010-1.5h3v-2.291a6.751 6.751 0 01-6-6.709v-1.5A.75.75 0 016 10.5z" />
          </svg>
        </div>
        <div>
          <h1 className="text-xl font-semibold text-zinc-100 mb-2">
            Welcome to Local Whisper
          </h1>
          <p className="text-sm text-zinc-400 max-w-sm leading-relaxed">
            Press and hold a shortcut key to record your voice, release to transcribe and type. Everything runs locally on your Mac.
          </p>
        </div>
        <button
          onClick={() => setStep("microphone")}
          className="px-6 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 transition-colors"
        >
          Get Started
        </button>
      </div>
    ),

    microphone: (
      <div className="flex flex-col items-center text-center space-y-5">
        <div className={`w-14 h-14 rounded-full flex items-center justify-center text-2xl ${
          micGranted ? "bg-green-500/20" : "bg-yellow-500/20"
        }`}>
          {micGranted ? (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7 text-green-400">
              <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7 text-yellow-400">
              <path d="M8.25 4.5a3.75 3.75 0 117.5 0v8.25a3.75 3.75 0 11-7.5 0V4.5z" />
              <path d="M6 10.5a.75.75 0 01.75.75v1.5a5.25 5.25 0 1010.5 0v-1.5a.75.75 0 011.5 0v1.5a6.751 6.751 0 01-6 6.709v2.291h3a.75.75 0 010 1.5h-7.5a.75.75 0 010-1.5h3v-2.291a6.751 6.751 0 01-6-6.709v-1.5A.75.75 0 016 10.5z" />
            </svg>
          )}
        </div>
        <div>
          <h2 className="text-lg font-semibold text-zinc-100 mb-1.5">
            Microphone Access
          </h2>
          <p className="text-sm text-zinc-400 max-w-sm leading-relaxed">
            {micGranted
              ? "Microphone access granted. You're all set!"
              : "Local Whisper needs microphone access to record your voice. A system dialog should appear — please click Allow."}
          </p>
        </div>
        {!micGranted && (
          <div className="flex items-center gap-3">
            <button
              onClick={() => openSystemPrefs("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")}
              className="text-xs px-4 py-2 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
            >
              Open System Settings
            </button>
            <button
              onClick={checkMicrophone}
              disabled={checkingMic}
              className="text-xs px-4 py-2 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-50"
            >
              {checkingMic ? "Checking..." : "Check Again"}
            </button>
          </div>
        )}
        <div className="flex items-center gap-3 pt-2">
          {micGranted ? (
            <button
              onClick={() => setStep("accessibility")}
              className="px-6 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 transition-colors"
            >
              Continue
            </button>
          ) : (
            <button
              onClick={() => setStep("accessibility")}
              className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              Skip for now
            </button>
          )}
        </div>
      </div>
    ),

    accessibility: (
      <div className="flex flex-col items-center text-center space-y-5">
        <div className={`w-14 h-14 rounded-full flex items-center justify-center text-2xl ${
          accessGranted ? "bg-green-500/20" : "bg-yellow-500/20"
        }`}>
          {accessGranted ? (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7 text-green-400">
              <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7 text-yellow-400">
              <path fillRule="evenodd" d="M12 1.5a5.25 5.25 0 00-5.25 5.25v3a3 3 0 00-3 3v6.75a3 3 0 003 3h10.5a3 3 0 003-3v-6.75a3 3 0 00-3-3v-3c0-2.9-2.35-5.25-5.25-5.25zm3.75 8.25v-3a3.75 3.75 0 10-7.5 0v3h7.5z" clipRule="evenodd" />
            </svg>
          )}
        </div>
        <div>
          <h2 className="text-lg font-semibold text-zinc-100 mb-1.5">
            Accessibility Access
          </h2>
          <p className="text-sm text-zinc-400 max-w-sm leading-relaxed">
            {accessGranted
              ? "Accessibility access granted. Local Whisper can type text into other apps!"
              : "Local Whisper needs accessibility access to type transcribed text into other apps. Please add it in System Settings."}
          </p>
        </div>
        {!accessGranted && (
          <div className="flex items-center gap-3">
            <button
              onClick={() => openSystemPrefs("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")}
              className="text-xs px-4 py-2 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
            >
              Open System Settings
            </button>
            <button
              onClick={checkAccessibility}
              disabled={checkingAccess}
              className="text-xs px-4 py-2 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-50"
            >
              {checkingAccess ? "Checking..." : "Check Again"}
            </button>
          </div>
        )}
        <div className="flex items-center gap-3 pt-2">
          {accessGranted ? (
            <button
              onClick={() => setStep("ready")}
              className="px-6 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 transition-colors"
            >
              Continue
            </button>
          ) : (
            <button
              onClick={() => setStep("ready")}
              className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              Skip for now
            </button>
          )}
        </div>
      </div>
    ),

    ready: (
      <div className="flex flex-col items-center text-center space-y-6">
        <div className="w-14 h-14 rounded-full bg-green-500/20 flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7 text-green-400">
            <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
          </svg>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-zinc-100 mb-1.5">
            You're All Set!
          </h2>
          <p className="text-sm text-zinc-400 max-w-sm leading-relaxed">
            Press and hold{" "}
            <span className="font-mono text-zinc-200 bg-zinc-800 px-1.5 py-0.5 rounded">
              {formatHotkeyDisplay(hotkey)}
            </span>{" "}
            in any app to start recording. Release to transcribe and type.
          </p>
          <p className="text-xs text-zinc-500 mt-3">
            You can change the shortcut and other settings anytime in the Settings tab.
            Close this window — the app keeps running in the background.
          </p>
        </div>
        <button
          onClick={onComplete}
          className="px-6 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 transition-colors"
        >
          Start Using Local Whisper
        </button>
      </div>
    ),
  };

  // Step indicator
  const steps: Step[] = ["welcome", "microphone", "accessibility", "ready"];
  const currentIdx = steps.indexOf(step);

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-200">
      {/* Drag region */}
      <div className="h-8 shrink-0" data-tauri-drag-region="true" />

      {/* Content */}
      <div className="flex-1 flex items-center justify-center px-8">
        {stepContent[step]}
      </div>

      {/* Step indicator */}
      <div className="flex items-center justify-center gap-2 pb-6">
        {steps.map((s, i) => (
          <div
            key={s}
            className={`w-1.5 h-1.5 rounded-full transition-colors ${
              i <= currentIdx ? "bg-blue-500" : "bg-zinc-800"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
