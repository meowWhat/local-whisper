import { useState, useCallback } from "react";
import { Mic, Settings as SettingsIcon, Terminal } from "lucide-react";
import Home from "./pages/Home";
import Settings from "./pages/Settings";
import Console from "./pages/Console";
import type { ConsoleEntry } from "./store";
import { DEFAULT_LLM_PROMPT } from "./store";

type Tab = "home" | "settings" | "console";

function App() {
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([]);
  const [llmPrompt, setLlmPrompt] = useState(DEFAULT_LLM_PROMPT);
  
  const addConsoleEntry = useCallback((entry: ConsoleEntry) => {
    setConsoleEntries((prev) => [...prev, entry]);
  }, []);

  const clearConsole = useCallback(() => {
    setConsoleEntries([]);
  }, []);

  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: "home", label: "Record", icon: Mic },
    { id: "settings", label: "Settings", icon: SettingsIcon },
    { id: "console", label: "Console", icon: Terminal },
  ];

  return (
    <div className="flex h-screen bg-[var(--bg-primary)]">
      {/* Sidebar */}
      <nav className="w-14 flex flex-col items-center py-4 gap-1 bg-[var(--bg-secondary)] border-r border-[var(--border)]">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          const hasNewEntries = tab.id === "console" && consoleEntries.length > 0;

          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative w-10 h-10 rounded-lg flex items-center justify-center transition-all duration-150 group ${
                isActive
                  ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
              }`}
              title={tab.label}
            >
              <Icon size={18} />
              {hasNewEntries && !isActive && (
                <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-[var(--accent)] rounded-full" />
              )}
              {/* Tooltip */}
              <span className="absolute left-full ml-2 px-2 py-1 text-xs bg-[var(--bg-tertiary)] border border-[var(--border)] rounded whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
                {tab.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden">
        {activeTab === "home" && (
          <Home onConsoleEntry={addConsoleEntry} />
        )}
        {activeTab === "settings" && (
          <Settings
            llmPrompt={llmPrompt}
            onPromptChange={setLlmPrompt}
            onConsoleEntry={addConsoleEntry}
          />
        )}
        {activeTab === "console" && (
          <Console entries={consoleEntries} onClear={clearConsole} />
        )}
      </main>
    </div>
  );
}

export default App;
