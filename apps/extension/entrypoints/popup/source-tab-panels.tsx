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
  Radio,
  Activity,
  Layers,
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
      data-source-active={sourceActive ? "true" : "false"}
      onClick={onClick}
      type="button"
      className={cn(
        "relative flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg transition-all duration-300",
        active
          ? "bg-white dark:bg-zinc-800 shadow-sm ring-1 ring-black/5 dark:ring-white/10"
          : "hover:bg-zinc-200/30 dark:hover:bg-zinc-800/30"
      )}
    >
      <div className={cn(
        "relative flex items-center justify-center size-6 rounded-md transition-all duration-300",
        sourceActive
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/20"
          : active
            ? "text-blue-600 dark:text-blue-400"
            : "text-muted-foreground"
      )}>
        {icon}
      </div>
      <span className={cn(
        "text-[11px] font-bold truncate tracking-tight transition-colors duration-300",
        sourceActive
          ? "text-emerald-600 dark:text-emerald-400"
          : active
            ? "text-foreground"
            : "text-muted-foreground"
      )}>
        {label}
      </span>
    </button>
  );
}

export function SourceTypeSwitcher({
  activeType,
  activeIndicator,
  copy,
  onSelect,
}: {
  activeType: SourceType;
  activeIndicator: SourceType | null;
  copy: ExtensionDictionary;
  onSelect: (type: SourceType) => void;
}) {
  return (
    <div className="shrink-0 px-4 pt-3 pb-0">
      <div className="p-1 bg-zinc-100 dark:bg-zinc-900/50 rounded-lg flex items-center border border-border/40">
        <SourceTypeButton
          active={activeType === "auto"}
          sourceActive={activeIndicator === "auto"}
          icon={<Zap className="w-3.5 h-3.5" />}
          label={copy.sourceAuto}
          onClick={() => onSelect("auto")}
        />
        <SourceTypeButton
          active={activeType === "sniff"}
          sourceActive={activeIndicator === "sniff"}
          icon={<Search className="w-3.5 h-3.5" />}
          label={copy.sourceSniff}
          onClick={() => onSelect("sniff")}
        />
        <SourceTypeButton
          active={activeType === "screen"}
          sourceActive={activeIndicator === "screen"}
          icon={<MonitorUp className="w-3.5 h-3.5" />}
          label={copy.sourceScreen}
          onClick={() => onSelect("screen")}
        />
        <SourceTypeButton
          active={activeType === "upload"}
          sourceActive={activeIndicator === "upload"}
          icon={<UploadCloud className="w-3.5 h-3.5" />}
          label={copy.sourceUpload}
          onClick={() => onSelect("upload")}
        />
      </div>
    </div>
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
  return (
    <div className="flex flex-1 flex-col animate-in fade-in zoom-in-95 duration-500">
      {/* 
        Container with fixed layout to prevent jumping.
        The border remains the same, only internal content changes.
      */}
      <div className={cn(
        "relative overflow-hidden rounded-[2rem] border transition-all duration-500  flex flex-col items-center text-center shadow-xl shadow-black/5  justify-center flex-1",
        enabled
          ? "border-emerald-500/20 bg-gradient-to-b from-emerald-50/30 to-white dark:from-emerald-900/10 dark:to-zinc-950"
          : "border-border/50 bg-gradient-to-b from-zinc-50/50 to-white dark:from-zinc-900/50 dark:to-zinc-950"
      )}>
        {/* State Indicator Beam */}
        <div className={cn(
          "absolute top-0 inset-x-0 h-px transition-colors duration-500",
          enabled ? "bg-gradient-to-r from-transparent via-emerald-500/40 to-transparent" : "bg-gradient-to-r from-transparent via-border to-transparent"
        )} />

        {/* Dynamic Icon Section */}
        <div className="relative mb-8 group perspective-1000">
          <div className={cn(
            "absolute -inset-10 rounded-full blur-3xl transition-all duration-700",
            enabled ? "bg-emerald-500/15 animate-pulse" : "bg-zinc-500/5 opacity-0 group-hover:opacity-100"
          )} />

          <div className={cn(
            "relative size-20 rounded-[2.5rem] shadow-2xl flex items-center justify-center transition-all duration-700",
            enabled
              ? "bg-emerald-500 text-white border-emerald-400/50 scale-100 rotate-0"
              : "bg-white dark:bg-zinc-900 text-emerald-500 border-border scale-95 -rotate-6 group-hover:scale-105 group-hover:rotate-0"
          )}>
            {enabled ? (
              <Radio className="size-10 animate-pulse" />
            ) : (
              <Zap className="size-10 fill-emerald-500/10" />
            )}

            <div className="absolute -right-2 -top-2 size-8 rounded-2xl bg-white dark:bg-zinc-900 border border-border flex items-center justify-center shadow-lg transition-transform duration-500">
              {enabled ? (
                <Activity className="size-4 text-emerald-500 animate-bounce" />
              ) : (
                <Layers className="size-4 text-emerald-600 dark:text-emerald-400" />
              )}
            </div>
          </div>
        </div>

        {/* Text Section - Fade/Slide Transition */}
        <div className="mb-10 space-y-2 relative h-[80px] w-full flex flex-col justify-center">
          <div key={enabled ? "on" : "off"} className="animate-in fade-in slide-in-from-bottom-2 duration-500">
            <h3 className="text-lg font-black text-foreground tracking-tight flex items-center justify-center gap-2">
              {enabled ? copy.autoFollowEmptyTitle : copy.sourceAuto}
            </h3>
            <p className="text-xs text-muted-foreground max-w-[240px] mx-auto leading-relaxed font-medium mt-1">
              {enabled ? copy.autoFollowEmptyDescription : copy.sourceAutoDescription}
            </p>
          </div>
        </div>

        {/* Action Button Section */}
        <div className="w-full max-w-[200px] flex flex-col items-center gap-4">
          <button
            data-testid={enabled ? "popup-auto-disable" : "popup-auto-enable"}
            onClick={enabled ? onDisable : onEnable}
            type="button"
            className={cn(
              "group relative h-12 w-full rounded-2xl font-bold text-sm shadow-2xl transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] overflow-hidden",
              enabled
                ? "bg-white dark:bg-zinc-800 text-foreground border border-border"
                : "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black"
            )}
          >
            {!enabled && (
              <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/0 via-emerald-500/10 to-emerald-500/0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
            )}
            <span className="relative flex items-center justify-center gap-2">
              {enabled ? (
                <>关闭自动接管</>
              ) : (
                <>
                  <Zap className="size-4 fill-current" />
                  {copy.autoEnable}
                </>
              )}
            </span>
          </button>
        </div>
      </div>
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
    <div className="flex min-h-0 flex-1 flex-col animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="shrink-0 px-4 pb-3 pt-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground uppercase tracking-wider px-1">
            <Search className="w-3.5 h-3.5 text-blue-500" />
            {copy.detected}
          </div>
          <button
            onClick={onRefreshSniff}
            aria-label={copy.refreshSniff}
            className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors px-2 py-1 rounded-lg border border-transparent hover:border-blue-100 dark:hover:border-blue-800/50 disabled:opacity-50"
            type="button"
            disabled={scene.sourceTab.isRefreshing}
          >
            <RefreshCw
              className={cn(
                "w-3.5 h-3.5",
                scene.sourceTab.isRefreshing && "animate-spin",
              )}
            />
            <span className="text-[11px] font-bold">{copy.refreshSniff}</span>
          </button>
        </div>
      </div>
      <PopupScrollArea
        className="min-h-0 flex-1"
        contentClassName="px-4 pb-6 flex flex-col gap-5 min-h-full"
        initialScrollTop={sniffScrollTop}
        onScrollTopChange={onSniffScrollChange}
      >
        <div
          className="flex flex-col gap-5"
          data-testid="popup-sniff-groups"
        >
          {scene.sourceTab.sniffGroups.length > 0 ? (
            scene.sourceTab.sniffGroups.map((group) => (
              <section key={group.id} className="flex flex-col gap-2.5">
                {(() => {
                  const isCollapsed = collapsedSniffGroupIds.has(group.id);
                  return (
                    <>
                      <button
                        aria-expanded={!isCollapsed}
                        className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[12px] font-bold text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all group/header border border-transparent hover:border-border/50"
                        onClick={() => onToggleSniffGroup(group.id)}
                        type="button"
                      >
                        <div className="size-5 flex items-center justify-center shrink-0">
                          {isCollapsed ? (
                            <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover/header:translate-x-0.5" />
                          ) : (
                            <ChevronDown className="size-4 text-muted-foreground transition-transform group-hover/header:translate-y-0.5" />
                          )}
                        </div>
                        <div className="size-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.4)] shrink-0" />
                        <span
                          className="min-w-0 flex-1 truncate"
                          title={group.title}
                        >
                          {group.title}
                        </span>
                        <span className="shrink-0 text-[10px] font-bold text-muted-foreground bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full border border-border/50 tabular-nums">
                          {group.cards.length}
                        </span>
                      </button>
                      {!isCollapsed &&
                        (group.cards.length > 0 ? (
                          <div className="flex flex-col gap-2.5 pl-2">
                            {group.cards.map((card) => (
                              <SniffCard
                                key={card.id}
                                card={card}
                                copy={copy}
                                isBusy={scene.meta.isBusy}
                                onPreview={onPreviewSource}
                                onClearPreview={onClearSourcePreview}
                                onStartOrAttach={onStartOrAttach}
                              />
                            ))}
                          </div>
                        ) : (
                          <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground bg-zinc-50/30 dark:bg-zinc-900/10 italic">
                            {copy.noVideo}
                          </div>
                        ))}
                    </>
                  );
                })()}
              </section>
            ))
          ) : (
            <div className="flex flex-col items-center justify-center py-12 px-6 rounded-2xl border-2 border-dashed border-zinc-200 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-900/10 text-center gap-3">
              <Search className="size-10 text-muted-foreground/30" />
              <p className="text-sm font-medium text-muted-foreground italic">
                {copy.noVideo}
              </p>
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
        "relative overflow-hidden rounded-xl border transition-all duration-300 group flex items-stretch bg-white dark:bg-zinc-900 text-left w-full hover:shadow-lg hover:-translate-y-0.5",
        card.active
          ? "border-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.15)] ring-1 ring-emerald-500/20"
          : card.selected
            ? "border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.15)] ring-1 ring-blue-500/20"
            : "border-border/60 hover:border-blue-500/40",
      )}
    >
      {/* Thumbnail Area */}
      <div className="h-16 w-28 shrink-0 overflow-hidden relative bg-zinc-950">
        {card.thumb ? (
          <img
            alt={card.title}
            className="h-full w-full object-cover opacity-80 transition-all duration-500 group-hover:opacity-100 group-hover:scale-110"
            src={card.thumb}
            onError={(event) => {
              event.currentTarget.style.display = "none";
            }}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-700">
            <FileVideo className="size-6 opacity-20" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-1.5">
          <Play className="size-3.5 text-white fill-white/20" />
        </div>
      </div>

      {/* Content Area */}
      <div className="flex min-w-0 flex-1 flex-col justify-center px-3.5 py-2.5 gap-1.5 pr-2">
        <div className="flex items-start justify-between gap-2">
          <p
            className="truncate text-xs font-bold leading-tight text-foreground flex-1 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors"
            title={card.label}
          >
            {card.title}
          </p>
          {card.active && (
            <div className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-[9px] font-black uppercase tracking-tight text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              <span className="size-1 rounded-full bg-emerald-500 animate-pulse" />
              LIVE
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[9px] text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded font-bold border border-blue-200/30 dark:border-blue-800/30 uppercase tracking-tight">
            {card.format}
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground font-mono font-bold opacity-60">
            {card.rate}
          </span>
        </div>
      </div>

      {/* Action Button - Slide in on hover or always show if small text */}
      <div className="shrink-0 flex items-center px-3 bg-zinc-50 dark:bg-zinc-950/50 border-l border-border/40 transition-colors group-hover:bg-blue-50/50 dark:group-hover:bg-blue-900/10">
        <button
          aria-label={`${copy.switchSource} ${card.title}`}
          data-testid={`popup-sniff-switch-${card.id}`}
          type="button"
          onClick={() =>
            onStartOrAttach("sniff", { selectedVideoId: card.id })
          }
          className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white p-2 shadow-sm transition-all active:scale-90 disabled:opacity-50"
          disabled={isBusy}
          title={copy.switchSource}
        >
          <Play className="size-4 fill-current" />
        </button>
      </div>
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
  const playbackLabel = formatPlaybackLabel(scene.header.playback.label, copy);

  return (
    <div className="flex flex-col gap-5 flex-1 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {!scene.sourceTab.screenReady ? (
        <>
          <div className="flex flex-col gap-3.5 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <CaptureOptionCard
              title={copy.captureEntireScreen}
              description={copy.captureEntireScreenDesc}
              icon={<Monitor className="w-6 h-6" />}
              onClick={() => onCaptureScreen("screen")}
            />
            <CaptureOptionCard
              title={copy.captureWindow}
              description={copy.captureWindowDesc}
              icon={<Maximize className="w-6 h-6" />}
              onClick={() => onCaptureScreen("window")}
            />
            <CaptureOptionCard
              title={copy.captureTab}
              description={copy.captureTabDesc}
              icon={<Globe className="w-6 h-6" />}
              onClick={() => onCaptureScreen("tab")}
            />
          </div>
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center p-6 animate-in fade-in zoom-in-95 duration-400">
          {/* Transmission Sonar Visual */}
          <div className="relative mb-12 flex size-32 items-center justify-center">
            <div className="absolute inset-0 rounded-full border border-blue-500/20 animate-[ping_4s_linear_infinite]" />
            <div className="absolute inset-4 rounded-full border border-blue-500/40 animate-[ping_4s_linear_infinite_1s]" />
            <div className="absolute inset-8 rounded-full border border-blue-500/60 animate-[ping_4s_linear_infinite_2s]" />

            <div className="relative size-16 rounded-2xl bg-zinc-900 dark:bg-black shadow-2xl flex items-center justify-center border-2 border-zinc-800 dark:border-zinc-700 z-10 overflow-hidden transition-transform duration-500 hover:scale-110">
              <div className="absolute inset-0 bg-blue-500/5" />
              <Monitor className="size-8 text-blue-500" />
              {/* Scanning Line */}
              <div className="absolute top-0 inset-x-0 h-0.5 bg-blue-500/50 blur-[2px] animate-[scan_2s_ease-in-out_infinite]" />
            </div>

            <div className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-white dark:bg-zinc-950 shadow-md border border-emerald-100 dark:border-emerald-800 z-20">
              <span className="size-3 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
            </div>
          </div>

          <div className="text-center space-y-6 w-full max-w-[280px]">
            <div className="space-y-1.5">
              <h3 className="text-2xl font-black text-foreground tracking-tight flex items-center justify-center gap-2">
                {copy.screenReady}
              </h3>
              <p className="text-[13px] text-muted-foreground font-medium leading-relaxed opacity-70">
                {copy.screenReadyDescription}
              </p>
            </div>

            {/* Transmission Info */}
            <div className="flex flex-col gap-2 rounded-2xl bg-zinc-100/50 dark:bg-zinc-900/50 border border-border/40 p-4">
              <div className="flex items-center justify-between text-[10px] font-black text-muted-foreground/60 uppercase tracking-widest px-1">
                <span>Transmission</span>
                <div className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
                  <Activity className="size-2.5 animate-pulse" />
                  LIVE
                </div>
              </div>
              <div className="bg-white dark:bg-zinc-950 rounded-xl p-3 border border-border/40 shadow-sm">
                <p className="text-[13px] font-bold text-foreground truncate text-left" title={playbackLabel}>
                  {playbackLabel || "Unknown Source"}
                </p>
              </div>
            </div>

            <button
              onClick={onToggleScreenReady}
              type="button"
              className="h-11 px-8 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black rounded-2xl font-bold text-sm shadow-xl active:scale-95 transition-all"
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
    <div className="flex flex-col flex-1 animate-in fade-in zoom-in-95 duration-500">
      <div
        className="flex-1 group relative overflow-hidden rounded-[2rem] border border-border/50 bg-gradient-to-b from-zinc-50/50 to-white dark:from-zinc-900/50 dark:to-zinc-950 flex flex-col items-center text-center shadow-xl shadow-black/5  justify-center cursor-pointer"
        onClick={onOpenPlayer}
      >
        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-border/50 to-transparent" />

        <div className="relative mb-8 group-hover:scale-110 transition-transform duration-500">
          <div className="absolute -inset-8 rounded-full bg-blue-500/10 blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
          <div className="relative size-20 rounded-full bg-white dark:bg-zinc-900 border border-border shadow-2xl flex items-center justify-center text-blue-500 transition-all duration-500 group-hover:rotate-6">
            <FileVideo className="size-9 fill-blue-500/10" />
            <div className="absolute -right-1 -top-1 size-7 rounded-full bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800/50 flex items-center justify-center shadow-lg">
              <Play className="size-3.5 text-blue-600 dark:text-blue-400 fill-current" />
            </div>
          </div>
        </div>

        <div className="mb-10 space-y-2 relative h-[70px] w-full flex flex-col justify-center">
          <h3 className="text-lg font-black text-foreground tracking-tight">
            {copy.openPlayer}
          </h3>
          <p className="text-xs text-muted-foreground max-w-[220px] mx-auto leading-relaxed font-medium opacity-80 line-clamp-2 min-h-[32px] flex items-center justify-center">
            {copy.playerDesc}
          </p>
        </div>

        <button
          type="button"
          className="group/btn relative h-12 w-full max-w-[200px] bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black rounded-2xl font-bold text-sm shadow-2xl transition-all hover:scale-[1.02] active:scale-[0.98] overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-blue-500/0 via-blue-500/20 to-blue-500/0 -translate-x-full group-hover/btn:translate-x-full transition-transform duration-1000" />
          <span className="relative flex items-center justify-center gap-2">
            {copy.openPlayer}
            <ChevronRight className="size-4 transition-transform group-hover/btn:translate-x-0.5" />
          </span>
        </button>
      </div>
    </div>
  );
} function CaptureOptionCard({
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
      className="flex items-center gap-4 p-3.5 rounded-2xl border border-border bg-white dark:bg-zinc-900/50 hover:border-blue-500/50 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 group text-left w-full shadow-sm"
    >
      <div className="size-12 shrink-0 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-border/60 shadow-inner flex items-center justify-center text-muted-foreground group-hover:text-blue-600 dark:group-hover:text-blue-400 group-hover:scale-110 group-hover:bg-blue-50 dark:group-hover:bg-blue-900/20 transition-all duration-300">
        {icon}
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <p className="text-[13px] font-bold text-foreground leading-none group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
          {title}
        </p>
        <p className="text-[11px] text-muted-foreground leading-tight line-clamp-2 opacity-80 group-hover:opacity-100">
          {description}
        </p>
      </div>
      <div className="size-8 flex items-center justify-center rounded-full opacity-0 group-hover:opacity-100 group-hover:bg-blue-50 dark:group-hover:bg-blue-900/30 transition-all duration-300">
        <ChevronRight className="size-5 text-blue-500 shrink-0" />
      </div>
    </button>
  );
}
