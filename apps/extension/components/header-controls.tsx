import { MonitorUp, Moon, Sun } from "lucide-react";
import { cn } from "../lib/utils";


export function HeaderControls({
  language = "en",
  themeMode,
  resolvedThemeMode,
  onThemeToggle,
  children,
}: {
  language?: string;
  onLanguageChange?: (lang: string) => void;
  themeMode: "light" | "dark" | "system";
  resolvedThemeMode: "light" | "dark";
  onThemeToggle: () => void;
  children?: React.ReactNode;
}) {
  const themeIcon =
    themeMode === "system" ? (
      <MonitorUp className="w-4 h-4" />
    ) : themeMode === "dark" ? (
      <Moon className="w-4 h-4" />
    ) : (
      <Sun className="w-4 h-4" />
    );

  const themeTriggerClassName =
    themeMode === "system"
      ? "text-muted-foreground"
      : resolvedThemeMode === "dark"
        ? "text-amber-400"
        : "text-sky-600";

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={onThemeToggle}
        className={cn(
          "p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg transition-colors border border-border bg-white dark:bg-zinc-900 shadow-sm flex items-center justify-center h-8 w-8",
          themeTriggerClassName
        )}
      >
        {themeIcon}
      </button>
      {children}
    </div>
  );
}