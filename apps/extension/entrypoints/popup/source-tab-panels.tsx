import { type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileVideo,
  Globe,
  Maximize,
  Monitor,
  MonitorUp,
  Play,
  RefreshCw,
  Search,
  Target,
  UploadCloud,
  Zap,
} from "lucide-react";
import { cn } from "../../lib/utils";
import type { ExtensionDictionary } from "./i18n";
import type { ExtensionSceneModel, SourceType } from "./scene-model";
import { PopupScrollArea } from "./presenter";

export function SourceTypeButton({
  active,
  icon,
  label,
  onClick,
  sourceActive,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  sourceActive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      type="button"
      className={cn(
        "relative flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] font-semibold rounded-md transition-[background-color,color,box-shadow,border-color] border",
        active
          ? "bg-white dark:bg-zinc-800 shadow-sm border-zinc-200 dark:border-zinc-700 text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
      {sourceActive && (
        <span
          aria-hidden="true"
          className="absolute top-1 right-1 size-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]"
        />
      )}
    </button>
  );
}

export function formatPlaybackLabel(label: string, copy: ExtensionDictionary) {
  const trimmed = label.trim();
  return trimmed.startsWith("blob:") ? copy.webVideoStream : trimmed;
}

export function AutoTabPanel({
  copy,
  enabled,
  playbackLabel,
  playbackState,
  onEnable,
  onDisable,
}: {
  copy: ExtensionDictionary;
  enabled: boolean;
  playbackLabel: string;
  playbackState: "active" | "waiting";
  onEnable: () => void;
  onDisable: () => void;
}) {
  if (!enabled) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 mt-2 text-center rounded-2xl border border-dashed border-border bg-zinc-50/50 dark:bg-zinc-900/20">
        <div className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400 ring-8 ring-emerald-50 dark:ring-emerald-900/10 shadow-sm">
          <Zap className="size-7" />
        </div>
        <h3 className="mb-2 text-sm font-bold text-foreground tracking-tight">
          {copy.sourceAuto}
        </h3>
        <p className="text-[11px] text-muted-foreground max-w-[240px] leading-relaxed mb-6">
          {copy.sourceAutoDescription}
        </p>
        <button
          data-testid="popup-auto-enable"
          onClick={onEnable}
          type="button"
          className="py-2.5 px-5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs transition-[background-color,transform,box-shadow] shadow-sm hover:shadow-md active:scale-[0.98] flex items-center justify-center gap-1.5"
        >
          <Zap className="w-3.5 h-3.5 fill-current" />
          {copy.autoEnable}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8 mt-2 text-center rounded-2xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/40 dark:bg-emerald-900/10">
      <div className="relative mb-5 flex size-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400 ring-8 ring-emerald-50 dark:ring-emerald-900/10 shadow-sm">
        <Target className="size-7" />
        <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-background shadow-sm">
          <span
            className={cn(
              "h-2.5 w-2.5 rounded-full",
              playbackState === "active"
                ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)] animate-[pulse_2s_ease-in-out_infinite]"
                : "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]",
            )}
          />
        </span>
      </div>
      <h3 className="mb-2 text-sm font-bold text-foreground tracking-tight">
        {copy.autoFollowEmptyTitle}
      </h3>
      <p className="text-[11px] text-muted-foreground max-w-[240px] leading-relaxed mb-5">
        {copy.autoFollowEmptyDescription}
      </p>

      <div className="mb-5 flex items-center gap-2 rounded-full border border-border bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs shadow-sm">
        <span className="px-1.5 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 border text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
          {copy.currentPlayback}
        </span>
        <span
          className="font-semibold text-foreground truncate max-w-[150px]"
          title={playbackLabel}
        >
          {playbackLabel}
        </span>
      </div>

      <button
        data-testid="popup-auto-disable"
        onClick={onDisable}
        type="button"
        className="py-2 px-4 bg-white hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900 text-foreground font-semibold rounded-lg border border-border shadow-sm transition-colors text-xs active:scale-95"
      >
        {copy.autoDisable}
      </button>
    </div>
  );
}

export function SniffPanel({
  scene,
  copy,
  sniffScrollTop,
  collapsedSniffGroupIds,
  onRefreshSniff,
  onPreviewSource,
  onClearSourcePreview,
  onStartOrAttach,
  onSniffScrollChange,
  onToggleSniffGroup,
}: {
  scene: ExtensionSceneModel;
  copy: ExtensionDictionary;
  sniffScrollTop: number;
  collapsedSniffGroupIds: Set<string>;
  onRefreshSniff: () => void;
  onPreviewSource: (id: string) => void;
  onClearSourcePreview: () => void;
  onStartOrAttach: (
    sourceType?: SourceType,
    options?: { selectedVideoId?: string },
  ) => void;
  onSniffScrollChange: (scrollTop: number) => void;
  onToggleSniffGroup: (groupId: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-4 pb-2 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-1">
            <Search className="w-3 h-3" />
            {copy.detected}
          </div>
          <button
            onClick={onRefreshSniff}
            aria-label={copy.refreshSniff}
            className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400 hover:text-blue-700 transition-colors bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded disabled:opacity-70"
            type="button"
            disabled={scene.sourceTab.isRefreshing}
          >
            <RefreshCw
              className={cn(
                "w-3.5 h-3.5",
                scene.sourceTab.isRefreshing && "animate-spin",
              )}
            />
            <span className="text-[10px] font-bold">{copy.refreshSniff}</span>
          </button>
        </div>
      </div>
      <PopupScrollArea
        className="min-h-0 flex-1"
        contentClassName="px-4 pb-4 flex flex-col gap-4 min-h-full"
        initialScrollTop={sniffScrollTop}
        onScrollTopChange={onSniffScrollChange}
      >
        <div
          className="flex flex-col gap-4"
          data-testid="popup-sniff-groups"
        >
          {scene.sourceTab.sniffGroups.length > 0 ? (
            scene.sourceTab.sniffGroups.map((group) => (
              <section key={group.id} className="flex flex-col gap-2">
                {(() => {
                  const isCollapsed = collapsedSniffGroupIds.has(group.id);
                  return (
                    <>
                      <button
                        aria-expanded={!isCollapsed}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] font-bold text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors group/header"
                        onClick={() => onToggleSniffGroup(group.id)}
                        type="button"
                      >
                        {isCollapsed ? (
                          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover/header:translate-x-0.5" />
                        ) : (
                          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover/header:translate-y-0.5" />
                        )}
                        <span className="size-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.4)]" />
                        <span
                          className="min-w-0 flex-1 truncate"
                          title={group.title}
                        >
                          {group.title}
                        </span>
                        <span className="shrink-0 text-[10px] font-bold text-muted-foreground bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded-md border border-border/50 tabular-nums">
                          {group.cards.length}
                        </span>
                      </button>
                      {!isCollapsed &&
                        (group.cards.length > 0 ? (
                          group.cards.map((card) => (
                            <SniffCard
                              key={card.id}
                              card={card}
                              copy={copy}
                              isBusy={scene.meta.isBusy}
                              onPreview={onPreviewSource}
                              onClearPreview={onClearSourcePreview}
                              onStartOrAttach={onStartOrAttach}
                            />
                          ))
                        ) : (
                          <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground bg-zinc-50/50 dark:bg-zinc-900/20">
                            {copy.noVideo}
                          </div>
                        ))}
                    </>
                  );
                })()}
              </section>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground bg-zinc-50/50 dark:bg-zinc-900/20">
              {copy.noVideo}
            </div>
          )}
        </div>
      </PopupScrollArea>
    </div>
  );
}

function SniffCard({
  card,
  copy,
  isBusy,
  onPreview,
  onClearPreview,
  onStartOrAttach,
}: {
  card: ExtensionSceneModel["sourceTab"]["sniffGroups"][number]["cards"][number];
  copy: ExtensionDictionary;
  isBusy: boolean;
  onPreview: (id: string) => void;
  onClearPreview: () => void;
  onStartOrAttach: (
    sourceType?: SourceType,
    options?: { selectedVideoId?: string },
  ) => void;
}) {
  return (
    <div
      data-testid={`popup-sniff-card-${card.id}`}
      data-selected={card.selected ? "true" : "false"}
      data-active={card.active ? "true" : "false"}
      onPointerEnter={() => onPreview(card.id)}
      onPointerLeave={onClearPreview}
      className={cn(
        "relative overflow-hidden rounded-xl border transition-[border-color,background-color,box-shadow,ring] duration-200 group flex bg-zinc-50 dark:bg-zinc-900/40 text-left w-full hover:shadow-md",
        card.active
          ? "border-emerald-500 dark:border-emerald-400 shadow-sm ring-2 ring-emerald-500/20 bg-emerald-50/40 dark:bg-emerald-900/10"
          : card.selected
            ? "border-blue-600 dark:border-blue-500 shadow-sm ring-2 ring-blue-500/20 bg-blue-50/10 dark:bg-blue-900/10"
            : "border-border/60 hover:border-blue-500/50 hover:bg-white dark:hover:bg-zinc-800/60",
      )}
    >
      <div className="h-16 w-24 shrink-0 overflow-hidden relative bg-black transition-transform duration-300 group-hover:scale-[1.05]">
        {card.thumb ? (
          <img
            alt={card.title}
            className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
            src={card.thumb}
            onError={(event) => {
              event.currentTarget.style.display = "none";
            }}
          />
        ) : (
          <div className="absolute inset-0 bg-zinc-900" />
        )}
        {card.thumb && (
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <Play className="w-5 h-5 text-white drop-shadow-lg fill-white/20 ml-0.5" />
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 px-3 py-2 pr-20">
        <p
          className="truncate text-xs font-bold leading-tight text-foreground transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400"
          title={card.label}
        >
          {card.title}
        </p>
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[9px] text-blue-700 dark:text-blue-300 bg-blue-100/60 dark:bg-blue-900/40 px-1.5 py-[1px] rounded font-bold border border-blue-200/50 dark:border-blue-800/40 tracking-tight uppercase">
            {card.format}
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground font-mono font-medium">
            {card.rate}
          </span>
        </div>
      </div>
      {card.active && (
        <div className="absolute right-[68px] top-1/2 -translate-y-1/2 flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          <span className="size-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]" />
          {copy.activeSource}
        </div>
      )}
      <button
        aria-label={`${copy.switchSource} ${card.title}`}
        data-testid={`popup-sniff-switch-${card.id}`}
        type="button"
        onClick={() =>
          onStartOrAttach("sniff", { selectedVideoId: card.id })
        }
        className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg border border-blue-200 bg-blue-600 px-2.5 py-1.5 text-[10px] font-bold text-white shadow-sm transition-[background-color,transform] hover:bg-blue-700 active:scale-95 disabled:opacity-50 dark:border-blue-800"
        disabled={isBusy}
      >
        {copy.switchSource}
      </button>
    </div>
  );
}

export function ScreenPanel({
  scene,
  copy,
  onCaptureScreen,
  onToggleScreenReady,
}: {
  scene: ExtensionSceneModel;
  copy: ExtensionDictionary;
  onCaptureScreen: (type: "screen" | "window" | "tab") => void;
  onToggleScreenReady: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 flex-1">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
        <MonitorUp className="w-3.5 h-3.5" />
        {copy.sourceScreen}
      </div>

      {!scene.sourceTab.screenReady ? (
        <div className="flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <CaptureOptionCard
            title={copy.captureEntireScreen}
            description={copy.captureEntireScreenDesc}
            icon={<Monitor className="w-5 h-5" />}
            onClick={() => onCaptureScreen("screen")}
          />
          <CaptureOptionCard
            title={copy.captureWindow}
            description={copy.captureWindowDesc}
            icon={<Maximize className="w-5 h-5" />}
            onClick={() => onCaptureScreen("window")}
          />
          <CaptureOptionCard
            title={copy.captureTab}
            description={copy.captureTabDesc}
            icon={<Globe className="w-5 h-5" />}
            onClick={() => onCaptureScreen("tab")}
          />
        </div>
      ) : (
        <div className="border-2 border-dashed border-green-500/50 bg-green-50/30 dark:bg-green-900/10 rounded-xl aspect-[4/3] flex flex-col items-center justify-center p-6 gap-4 text-center transition-[border-color,background-color,box-shadow] shadow-inner animate-in zoom-in-95 duration-300">
          <div className="size-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center transition-all duration-300 shadow-sm scale-110">
            <Check className="w-8 h-8 text-green-600 dark:text-green-500" />
          </div>
          <div>
            <p className="text-[15px] font-bold text-green-600 dark:text-green-400 mb-1">
              {copy.screenReady}
            </p>
            <p className="text-xs text-muted-foreground mb-5 font-medium leading-relaxed max-w-[240px] mx-auto">
              {copy.screenReadyDescription}
            </p>
            <button
              className="py-2 px-4 bg-white hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900 text-foreground font-semibold rounded-lg border border-border shadow-sm transition-colors text-xs active:scale-95"
              onClick={onToggleScreenReady}
              type="button"
            >
              {copy.reselect}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function UploadPanel({
  copy,
  onOpenPlayer,
}: {
  copy: ExtensionDictionary;
  onOpenPlayer: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 flex-1 pb-6">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
        <FileVideo className="w-3.5 h-3.5" />
        {copy.sourceUpload}
      </div>

      <div
        className="border-2 border-dashed border-border rounded-xl aspect-[4/3] flex flex-col items-center justify-center p-8 gap-5 text-center bg-zinc-50/30 dark:bg-zinc-900/10 transition-all hover:bg-zinc-50/50 dark:hover:bg-zinc-900/20 group cursor-pointer"
        onClick={onOpenPlayer}
      >
        <div className="size-16 rounded-full bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform duration-300">
          <ExternalLink className="w-8 h-8 text-blue-600 dark:text-blue-400" />
        </div>
        <div>
          <p className="text-[15px] font-bold text-foreground group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
            {copy.openPlayer}
          </p>
          <p className="text-xs text-muted-foreground mt-2 font-medium leading-relaxed max-w-[200px] mx-auto">
            {copy.playerDesc}
          </p>
        </div>
        <div className="mt-2 py-1.5 px-4 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black text-xs font-bold rounded-lg shadow-md active:scale-95 transition-transform flex items-center gap-2">
          Launch Player <ChevronRight className="w-3 h-3" />
        </div>
      </div>
    </div>
  );
}

function CaptureOptionCard({
  title,
  description,
  icon,
  onClick,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      type="button"
      className="flex items-center gap-3 p-3 rounded-xl border border-border bg-zinc-50/50 dark:bg-zinc-900/30 hover:border-blue-500/50 hover:bg-white dark:hover:bg-zinc-800/50 transition-all duration-200 group text-left w-full shadow-sm"
    >
      <div className="size-10 shrink-0 rounded-lg bg-white dark:bg-zinc-800 border border-border shadow-sm flex items-center justify-center text-muted-foreground group-hover:text-blue-600 dark:group-hover:text-blue-400 group-hover:scale-105 transition-all duration-200">
        {icon}
      </div>
      <div className="flex-1 min-w-0 space-y-0.5">
        <p className="text-[12px] font-bold text-foreground leading-none">
          {title}
        </p>
        <p className="text-[10px] text-muted-foreground leading-tight truncate">
          {description}
        </p>
      </div>
      <ChevronRight className="size-4 text-zinc-300 dark:text-zinc-600 group-hover:text-blue-400 transition-colors shrink-0" />
    </button>
  );
}
