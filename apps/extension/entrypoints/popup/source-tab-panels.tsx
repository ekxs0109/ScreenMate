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
  Square,
  Target,
  UploadCloud,
  Zap,
  Radio,
  Activity,
  Layers,
  PlayCircle,
  PlayIcon,
  Annoyed,
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
  if (trimmed === "Shared browser tab") {
    return copy.sourceShareBrowserTab;
  }

  if (trimmed === "Shared window") {
    return copy.sourceShareWindow;
  }

  if (trimmed === "Shared screen") {
    return copy.sourceShareScreen;
  }

  return trimmed.startsWith("blob:") ? copy.webVideoStream : trimmed;
}

export function StatusIconVisual({
  icon: Icon,
  colorClass = "blue",
  isActive = false,
}: {
  icon: React.ElementType;
  colorClass?: "blue" | "emerald";
  isActive?: boolean;
}) {
  const isBlue = colorClass === "blue";

  return (
    <div className="relative mb-8 group flex size-32 items-center justify-center">
      {/* Outer Glow Rings - Always mounted for transition, only visible when active */}
      <div className={cn(
        "absolute inset-0 rounded-full border transition-all duration-1000 ease-out",
        isActive ? "scale-100 opacity-100 animate-[ping_4s_linear_infinite]" : "scale-50 opacity-0",
        isBlue ? "border-blue-500/20" : "border-emerald-500/20"
      )} />
      <div className={cn(
        "absolute inset-4 rounded-full border transition-all duration-1000 ease-out delay-75",
        isActive ? "scale-100 opacity-100 animate-[ping_4s_linear_infinite_1s]" : "scale-50 opacity-0",
        isBlue ? "border-blue-500/40" : "border-emerald-500/40"
      )} />
      <div className={cn(
        "absolute inset-8 rounded-full border transition-all duration-1000 ease-out delay-150",
        isActive ? "scale-100 opacity-100 animate-[ping_4s_linear_infinite_2s]" : "scale-50 opacity-0",
        isBlue ? "border-blue-500/60" : "border-emerald-500/60"
      )} />


      {/* Core Device / Icon Container */}
      <div className={cn(
        "relative size-16 rounded-2xl flex items-center justify-center overflow-hidden transition-all duration-700 ease-[cubic-bezier(0.34,1.56,0.64,1)] z-10",
        isActive
          ? "bg-zinc-950 border-2 border-zinc-800 shadow-[0_0_30px_-5px_rgba(0,0,0,0.5)] scale-110"
          : "bg-gradient-to-b from-white to-zinc-50/50 dark:from-zinc-900 dark:to-zinc-950/50 border border-border/80 shadow-[inset_0_2px_4px_rgba(255,255,255,0.8),0_2px_8px_rgba(0,0,0,0.04)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.05),0_4px_12px_rgba(0,0,0,0.2)] scale-100 group-hover:scale-105 group-hover:shadow-xl"
      )}>
        {/* Inactive Texture: Subtle micro-grid pattern */}
        <div className={cn(
          "absolute inset-0 transition-opacity duration-700 pointer-events-none",
          "bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:6px_6px]",
          isActive ? "opacity-0" : "opacity-100"
        )} />

        {/* Inner colored sheen (Active only) */}
        <div className={cn(
          "absolute inset-0 opacity-0 transition-opacity duration-700",
          isActive && "opacity-100",
          isBlue ? "bg-gradient-to-br from-blue-500/10 to-transparent" : "bg-gradient-to-br from-emerald-500/10 to-transparent"
        )} />

        {/* Icon itself */}
        <Icon className={cn(
          "relative z-10 size-8 transition-all duration-700",
          isActive
            ? (isBlue ? "text-blue-500 drop-shadow-[0_0_8px_rgba(59,130,246,0.6)] scale-100" : "text-emerald-500 drop-shadow-[0_0_8px_rgba(16,185,129,0.6)] scale-100")
            : "text-zinc-400 dark:text-zinc-500 scale-95 drop-shadow-sm group-hover:scale-100 group-hover:text-zinc-600 dark:group-hover:text-zinc-300"
        )} />

        {/* Scanning line only when active */}
        <div className={cn(
          "absolute top-0 inset-x-0 h-px blur-[1px] transition-opacity duration-500",
          isActive ? "opacity-100 animate-[scan_2s_ease-in-out_infinite]" : "opacity-0 hidden",
          isBlue ? "bg-blue-400" : "bg-emerald-400"
        )} />
      </div>
    </div>
  );
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
    <div className="flex-1 flex flex-col items-center justify-center p-6 animate-in fade-in zoom-in-95 duration-400">
      <StatusIconVisual
        icon={enabled ? Radio : Zap}
        colorClass="emerald"
        isActive={enabled}
      />

      <div className="text-center w-full max-w-[280px]">
        <div className="space-y-2 relative h-[80px] w-full flex flex-col justify-center mb-6">
          <div key={enabled ? "on" : "off"} className="animate-in fade-in slide-in-from-bottom-2 duration-500">
            <h3 className="text-lg font-black text-foreground tracking-tight flex items-center justify-center gap-2">
              {enabled ? copy.autoFollowEmptyTitle : copy.sourceAuto}
            </h3>
            <p className="text-xs text-muted-foreground font-medium leading-relaxed opacity-70 mt-1">
              {enabled ? copy.autoFollowEmptyDescription : copy.sourceAutoDescription}
            </p>
          </div>
        </div>

        <button
          data-testid={enabled ? "popup-auto-disable" : "popup-auto-enable"}
          onClick={enabled ? onDisable : onEnable}
          type="button"
          className={cn(
            "h-11 px-8 w-full rounded-2xl font-bold text-sm shadow-xl active:scale-95 transition-all flex items-center justify-center gap-2",
            enabled
              ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black hover:scale-[1.02]"
              : "bg-emerald-500 text-white hover:bg-emerald-600 shadow-emerald-500/20 hover:scale-[1.02]"
          )}
        >
          {enabled ? (
            <>关闭自动接管</>
          ) : (
            <>
              <Zap className="size-4 fill-current" />
              {copy.autoEnable}
            </>
          )}
        </button>
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
      {/* Modern Header */}
      <div className="shrink-0 px-5  py-2 border-b border-border/40 bg-zinc-50/80 dark:bg-zinc-950/80 backdrop-blur-xl z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold text-foreground tracking-tight">
            <Search className="w-3.5 h-3.5" />
            {copy.detected}
          </div>
          <button
            onClick={onRefreshSniff}
            aria-label={copy.refreshSniff}
            className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 transition-colors px-2.5 py-1.5 rounded-lg active:scale-95"
            type="button"
            disabled={scene.sourceTab.isRefreshing}
          >
            <RefreshCw
              className={cn(
                "w-3.5 h-3.5",
                scene.sourceTab.isRefreshing && "animate-spin text-blue-500",
              )}
            />
            <span className="text-[11px] font-bold">{copy.refreshSniff}</span>
          </button>
        </div>
      </div>

      <PopupScrollArea
        className="min-h-0 flex-1 bg-zinc-50/30 dark:bg-zinc-950/30"
        contentClassName="p-4 flex flex-col gap-4 min-h-full"
        initialScrollTop={sniffScrollTop}
        onScrollTopChange={onSniffScrollChange}
      >
        <div className="flex flex-col gap-4" data-testid="popup-sniff-groups">
          {scene.sourceTab.sniffGroups.length > 0 ? (
            scene.sourceTab.sniffGroups.map((group) => (
              <section key={group.id} className="flex flex-col">
                {(() => {
                  const isCollapsed = collapsedSniffGroupIds.has(group.id);
                  return (
                    <>
                      {/* Premium Group Header */}
                      <button
                        aria-expanded={!isCollapsed}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all group/header bg-white dark:bg-zinc-900 border border-border/50 shadow-sm hover:shadow-md hover:border-border"
                        onClick={() => onToggleSniffGroup(group.id)}
                        type="button"
                      >
                        <div className="flex-1 min-w-0 flex items-center gap-2.5">
                          <span className="truncate text-xs font-bold text-foreground" title={group.title}>
                            {group.title}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] font-bold text-muted-foreground bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full tabular-nums border border-border/50">
                            {group.cards.length}
                          </span>
                          <div className="size-6 flex items-center justify-center rounded-full bg-zinc-50 dark:bg-zinc-800 group-hover/header:bg-zinc-100 dark:group-hover/header:bg-zinc-700 transition-colors border border-border/50">
                            {isCollapsed ? (
                              <ChevronRight className="size-3.5 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="size-3.5 text-muted-foreground" />
                            )}
                          </div>
                        </div>
                      </button>

                      <div
                        className={cn(
                          "grid transition-all duration-300 ease-in-out",
                          isCollapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100 mt-3"
                        )}
                      >
                        <div className="overflow-hidden min-h-0">
                          {group.cards.length > 0 ? (
                            <div className="flex flex-col gap-2">
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
                            <div className="rounded-xl border border-dashed border-border/60 py-8 px-4 flex flex-col items-center justify-center gap-3 bg-zinc-50/50 dark:bg-zinc-900/20 text-center transition-all hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                              <span className="text-xs font-bold text-muted-foreground">
                                {copy.noVideo}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  );
                })()}
              </section>
            ))
          ) : (
            <div className="flex flex-col items-center justify-center py-20 px-6 rounded-[2rem] border border-dashed border-border/60 bg-gradient-to-b from-white/50 to-zinc-50/80 dark:from-zinc-900/20 dark:to-zinc-950/40 text-center gap-5 shadow-sm">
              <div className="relative group">
                <div className="absolute -inset-4 rounded-full bg-blue-500/5 blur-xl animate-pulse" />
                <div className="relative size-16 rounded-2xl bg-white dark:bg-zinc-900 border border-border shadow-sm flex items-center justify-center overflow-hidden transition-transform duration-500 group-hover:scale-105 group-hover:shadow-md">
                  <div className="absolute inset-0 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:4px_4px]" />
                  <Search className="size-6 text-muted-foreground/40 relative z-10" />
                </div>
              </div>
              <p className="text-sm font-bold text-muted-foreground">
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
        "relative overflow-hidden rounded-xl border transition-all duration-300 group flex items-stretch text-left w-full",
        card.active
          ? "bg-emerald-50/30 dark:bg-emerald-950/20 border-emerald-500/30 shadow-[0_4px_12px_-2px_rgba(16,185,129,0.15)] ring-1 ring-emerald-500/20"
          : card.selected
            ? "bg-blue-50/30 dark:bg-blue-950/20 border-blue-500/30 shadow-[0_4px_12px_-2px_rgba(59,130,246,0.15)] ring-1 ring-blue-500/20"
            : "bg-white dark:bg-zinc-900 border-border/60 shadow-sm hover:shadow-md hover:border-border hover:-translate-y-[1px]"
      )}
    >
      {/* Clickable Overlay */}
      <button
        type="button"
        onClick={() => onStartOrAttach("sniff", { selectedVideoId: card.id })}
        disabled={isBusy}
        className="absolute inset-0 z-10 w-full h-full focus:outline-none focus:ring-2 focus:ring-blue-500/50 rounded-xl disabled:cursor-not-allowed"
        aria-label={`${copy.switchSource} ${card.title}`}
      />

      {/* Thumbnail Area */}
      <div className="h-[72px] w-[116px] shrink-0 overflow-hidden relative bg-zinc-100 dark:bg-zinc-950 p-1">
        <div className="w-full h-full rounded-lg overflow-hidden relative shadow-inner border border-border/50 bg-black">
          {card.thumb ? (
            <img
              alt={card.title}
              className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110 opacity-90 group-hover:opacity-100"
              src={card.thumb}
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-zinc-400 dark:text-zinc-600 bg-zinc-200/50 dark:bg-zinc-800/50">
              <FileVideo className="size-6 opacity-50" />
            </div>
          )}

          {/* Play Button Overlay */}
          <div className={cn(
            "absolute inset-0 flex items-center justify-center transition-all duration-300",
            card.active ? "bg-emerald-900/40 backdrop-blur-[2px]" : "bg-black/40 backdrop-blur-[2px] opacity-0 group-hover:opacity-100"
          )}>
            <div className={cn(
              "size-8 rounded-full flex items-center justify-center shadow-lg transform transition-all duration-300",
              card.active ? "bg-emerald-500 text-white scale-100 shadow-[0_0_15px_rgba(16,185,129,0.5)]" : "bg-blue-500 text-white scale-75 group-hover:scale-100"
            )}>
              {card.active ? <Activity className="size-4 animate-pulse" /> : <Play className="size-4 ml-0.5 fill-current" />}
            </div>
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex min-w-0 flex-1 flex-col justify-center px-3 py-2 gap-1.5 z-0">
        <div className="flex items-start justify-between gap-2">
          <p
            className={cn(
              "truncate text-xs font-bold leading-tight flex-1 transition-colors",
              card.active ? "text-emerald-700 dark:text-emerald-400" : "text-foreground group-hover:text-blue-600 dark:group-hover:text-blue-400"
            )}
            title={card.title}
          >
            {card.title}
          </p>
          {card.active && (
            <div className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-[9px] font-black uppercase tracking-tight text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
              LIVE
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 mt-0.5">
          <span className="shrink-0 text-[9px] text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded-md font-bold border border-border/50 uppercase tracking-tight">
            {card.format}
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground font-mono font-medium">
            {card.rate}
          </span>
        </div>
      </div>
    </div>
  );
}
export function ScreenPanel({
  scene,
  copy,
  onCaptureScreen,
  onToggleScreenReady,
  onStopScreenShare,
}: {
  scene: ExtensionSceneModel;
  copy: ExtensionDictionary;
  onCaptureScreen: (type: "screen" | "window" | "tab") => void;
  onToggleScreenReady: () => void;
  onStopScreenShare: () => void;
}) {
  const canStopAttachedScreenShare =
    scene.header.playback.state === "active" &&
    scene.sourceTab.activeSourceIndicator === "screen";
  const closeLabel = getCloseScreenShareLabel(scene, copy);

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
          <StatusIconVisual
            icon={Monitor}
            colorClass="blue"
            isActive={true}
          />

          <div className="text-center space-y-6 w-full max-w-[280px]">
            <div className="space-y-1.5">
              <h3 className="text-lg font-black text-foreground tracking-tight flex items-center justify-center gap-2">
                {copy.screenReady}
              </h3>
              <p className="text-xs text-muted-foreground font-medium leading-relaxed opacity-70">
                {copy.screenReadyDescription}
              </p>
            </div>

            <button
              data-testid="popup-close-screen-share"
              onClick={
                canStopAttachedScreenShare ? onStopScreenShare : onToggleScreenReady
              }
              type="button"
              className="h-11 px-8 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black rounded-2xl font-bold text-sm shadow-xl active:scale-95 transition-all hover:scale-105"
            >
              {closeLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function getCloseScreenShareLabel(
  scene: ExtensionSceneModel,
  copy: ExtensionDictionary,
) {
  const detailKind = scene.header.source.detail?.kind;
  if (detailKind === "display-tab") {
    return copy.closeBrowserTabShare;
  }

  if (detailKind === "display-window") {
    return copy.closeWindowShare;
  }

  if (detailKind === "display-screen") {
    return copy.closeScreenShare;
  }

  const label = scene.header.playback.label.trim();
  if (label === "Shared browser tab") {
    return copy.closeBrowserTabShare;
  }

  if (label === "Shared window") {
    return copy.closeWindowShare;
  }

  if (label === "Shared screen") {
    return copy.closeScreenShare;
  }

  return copy.closeDisplayShare;
}

export function UploadPanel({
  scene,
  copy,
  onOpenPlayer,
  onStopLocalPlayback,
}: {
  scene: ExtensionSceneModel;
  copy: ExtensionDictionary;
  onOpenPlayer: () => void;
  onStopLocalPlayback: () => void;
}) {
  const isLocalPlaybackActive =
    scene.header.playback.state === "active" &&
    scene.sourceTab.activeSourceIndicator === "upload";
  const localPlaybackLabel = getLocalPlaybackLabel(scene, copy);
  const title = isLocalPlaybackActive ? copy.currentPlayback : copy.openPlayer;
  const description = isLocalPlaybackActive && localPlaybackLabel
    ? localPlaybackLabel
    : copy.playerDesc;

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 animate-in fade-in zoom-in-95 duration-400">
      <div onClick={onOpenPlayer} className="cursor-pointer group/upload" data-testid="popup-upload-panel">
        <StatusIconVisual
          icon={FileVideo}
          colorClass={isLocalPlaybackActive ? "emerald" : "blue"}
          isActive={isLocalPlaybackActive}
        />
      </div>

      <div className="text-center w-full max-w-[280px]">
        <div className="space-y-2 relative h-[80px] w-full flex flex-col justify-center mb-6">
          <div key={isLocalPlaybackActive ? "active" : "inactive"} className="animate-in fade-in slide-in-from-bottom-2 duration-500">
            <h3 className="text-lg font-black text-foreground tracking-tight flex items-center justify-center gap-2">
              {title}
            </h3>
            <p className="text-xs text-muted-foreground font-medium leading-relaxed opacity-70 mt-1 line-clamp-2 px-2" title={description}>
              {description}
            </p>
          </div>
        </div>

        <div className="flex w-full items-center gap-3">
          <button
            type="button"
            onClick={onOpenPlayer}
            className={cn(
              "h-11 px-4 flex-1 rounded-2xl font-bold  active:scale-95 transition-all flex items-center justify-center gap-2",
              isLocalPlaybackActive
                ? "bg-white dark:bg-zinc-800 text-foreground border border-border hover:scale-[1.02]"
                : "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black hover:scale-[1.02]"
            )}
          >

            <PlayIcon className="size-4" />
            {copy.openPlayer}
          </button>

          {isLocalPlaybackActive && (
            <button
              aria-label={copy.closeLocalPlayback}
              className="flex h-11 px-4 flex-1 items-center justify-center gap-2 rounded-2xl border border-red-200/70 bg-red-50/70 text-xs font-bold text-red-600 shadow-sm transition-all hover:scale-[1.01] hover:bg-red-100 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-400 dark:hover:bg-red-950/35"
              disabled={scene.meta.isBusy}
              onClick={onStopLocalPlayback}
              type="button"
            >
              <Square className="size-3.5 fill-current" />
              {copy.closeLocalPlayback}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function getLocalPlaybackLabel(
  scene: ExtensionSceneModel,
  copy: ExtensionDictionary,
) {
  if (scene.header.source.detail?.kind === "local-file") {
    return formatPlaybackLabel(scene.header.source.detail.label, copy);
  }

  return formatPlaybackLabel(scene.header.playback.label, copy);
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
      className="flex items-center gap-4 p-3.5 rounded-2xl border border-border bg-white dark:bg-zinc-900/50 hover:border-blue-500/50 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 group text-left w-full shadow-sm"
    >
      <div className="size-12 shrink-0 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-border/60 shadow-inner flex items-center justify-center text-muted-foreground group-hover:text-blue-600 dark:group-hover:text-blue-400 group-hover:scale-110 group-hover:bg-blue-50 dark:group-hover:bg-blue-900/20 transition-all duration-300">
        {icon}
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <p className="text-sm font-bold text-foreground leading-none group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
          {title}
        </p>
        <p className="text-xs text-muted-foreground leading-tight line-clamp-2 opacity-80 group-hover:opacity-100">
          {description}
        </p>
      </div>
      <div className="size-8 flex items-center justify-center rounded-full opacity-0 group-hover:opacity-100 group-hover:bg-blue-50 dark:group-hover:bg-blue-900/30 transition-all duration-300">
        <ChevronRight className="size-5 text-blue-500 shrink-0" />
      </div>
    </button>
  );
}
