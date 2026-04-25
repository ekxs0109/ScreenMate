import { Globe, MonitorUp, Moon, Sun } from "lucide-react";
import { cn } from "../lib/utils";
import { useViewerI18n, type ViewerLocale } from "../i18n";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

export function HeaderControls({
  language = "en",
  onLanguageChange,
  themeMode,
  resolvedThemeMode,
  onThemeToggle,
  children,
}: {
  language?: ViewerLocale;
  onLanguageChange?: (lang: ViewerLocale) => void;
  themeMode: "light" | "dark" | "system";
  resolvedThemeMode: "light" | "dark";
  onThemeToggle: () => void;
  children?: React.ReactNode;
}) {
  const { copy } = useViewerI18n();
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
      <Select
        value={language}
        onValueChange={(next) => onLanguageChange?.(next as ViewerLocale)}
      >
        <SelectTrigger
          aria-label={copy.languageLabel}
          className="h-8 w-[105px] gap-1.5 border-border bg-background px-2.5 text-xs font-medium shadow-sm"
        >
          <Globe className="size-3.5 shrink-0 text-muted-foreground" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          <SelectGroup>
            <SelectItem value="zh">中文</SelectItem>
            <SelectItem value="en">English</SelectItem>
            <SelectItem value="ja">日本語</SelectItem>
            <SelectItem value="es">Español</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>

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
