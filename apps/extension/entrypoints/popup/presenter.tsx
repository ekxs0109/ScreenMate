import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Check,
  Copy,
  ExternalLink,
  FileVideo,
  Globe,
  Hash,
  Info,
  Key,
  Link as LinkIcon,
  Maximize,
  MessageCircle,
  Monitor,
  MonitorUp,
  Moon,
  Play,
  RefreshCw,
  Search,
  Send,
  Sun,
  Target,
  Trash2,
  UploadCloud,
  Users,
  X,
  Zap,
} from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { cn } from "../../lib/utils";
import type { ExtensionDictionary } from "./i18n";
import type { ExtensionSceneModel, PopupTab, SourceType } from "./scene-model";
import { HeaderControls } from "../../components/header-controls";

const cubesPattern = "/patterns/cubes.png";

export function ExtensionPopupPresenter({
  windowMode,
  scene,
  copy,
  language,
  onLanguageChange,
  themeMode,
  resolvedThemeMode,
  sniffScrollTop,
  onThemeToggle,
  onOpenPopout,
  onSelectTab,
  onSelectSourceType,
  onSelectSource,
  onPreviewSource,
  onClearSourcePreview,
  onRefreshSniff,
  onToggleFollowActiveTabVideo = () => { },
  onSniffScrollChange,
  onCaptureScreen,
  onOpenPlayer,
  onToggleScreenReady,
  onSelectLocalFile,
  onClearLocalFile,
  onStartOrAttach,
  onStopRoom,
  onSavePassword,
  onPasswordChange,
  onCopyLink,
  onCopyRoomId,
  onJumpToRoom,
  onSendChat,
}: {
  windowMode: "popup" | "popout";
  scene: ExtensionSceneModel;
  copy: ExtensionDictionary;
  language?: string;
  onLanguageChange?: (lang: string) => void;
  themeMode: "light" | "dark" | "system";
  resolvedThemeMode: "light" | "dark";
  sniffScrollTop: number;
  onThemeToggle: () => void;
  onOpenPopout: () => void;
  onSelectTab: (tab: PopupTab) => void;
  onSelectSourceType: (kind: SourceType) => void;
  onSelectSource: (id: string) => void;
  onPreviewSource: (id: string) => void;
  onClearSourcePreview: () => void;
  onRefreshSniff: () => void;
  onToggleFollowActiveTabVideo?: (enabled: boolean) => void;
  onSniffScrollChange: (scrollTop: number) => void;
  onCaptureScreen: (type: "screen" | "window" | "tab") => void;
  onOpenPlayer: () => void;
  onToggleScreenReady: () => void;
  onSelectLocalFile: (file: { name: string; size: number; type: string }) => void;
  onClearLocalFile: () => void;
  onStartOrAttach: () => void;
  onStopRoom: () => void;
  onSavePassword: () => void;
  onPasswordChange: (value: string) => void;
  onCopyLink: () => void;
  onCopyRoomId: () => void;
  onJumpToRoom: () => void;
  onSendChat: (text: string) => boolean | Promise<boolean>;
}) {
  const shouldShowMetaMessage =
    scene.meta.message !== null && scene.meta.message !== "Room closed.";
  const isAutoFollow = scene.sourceTab.followActiveTabVideo;
  const effectiveSourceType = scene.sourceTab.activeSourceType;
  const playbackLabel =
    formatPlaybackLabel(scene.header.playback.label, copy) ||
    (scene.header.playback.state === "active"
      ? copy.currentPlayback
      : copy.waitingPlayback);
  const playbackModeLabel =
    scene.header.playback.mode === "auto" ? copy.autoMode : copy.manualMode;
  const [collapsedSniffGroupIds, setCollapsedSniffGroupIds] = useState<Set<string>>(
    () => new Set(),
  );
  const themeIcon =
    themeMode === "system" ? (
      <Monitor className="w-4 h-4" />
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
  const toggleSniffGroup = (groupId: string) => {
    setCollapsedSniffGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  return (
    <main
      className={cn(
        "bg-card text-card-foreground flex min-h-0 flex-col border border-border/80 overflow-hidden",
        windowMode === "popup"
          ? "h-[600px] w-[400px]"
          : "h-[min(600px,calc(100dvh-2rem))] w-[min(400px,calc(100vw-2rem))] rounded-2xl shadow-2xl",
      )}
    >
      <header className="shrink-0 border-b border-border bg-zinc-50/85 dark:bg-zinc-950/85 backdrop-blur transition-colors p-3 flex items-center gap-2">
        <div className="flex-1 min-w-0 flex items-center gap-2 px-1">
          <span
            className={cn(
              "size-2 rounded-full shrink-0",
              scene.header.playback.state === "active"
                ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.55)] flex-none"
                : "bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.45)] flex-none",
            )}
          />
          <div className="min-w-0 flex-1 flex items-center gap-1.5">
            <span className="shrink-0 font-black tracking-tight text-[13px] text-foreground">
              {copy.appName}
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground/30 dark:text-muted-foreground/50">/</span>
            <span
              className={cn(
                "shrink-0 text-[11px] font-semibold",
                scene.header.playback.mode === "auto" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
              )}
            >
              {playbackModeLabel}
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground/30 dark:text-muted-foreground/50">·</span>
            <span className="truncate text-[11px] font-medium text-muted-foreground" title={playbackLabel}>
              {playbackLabel}
            </span>
          </div>
          <span data-testid="popup-room-status" className="sr-only">
            {scene.header.statusText}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            aria-label={copy.themeLabel}
            className={cn(
              "hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg transition-colors flex items-center justify-center size-8",
              themeTriggerClassName,
            )}
            onClick={onThemeToggle}
            title={copy.themeLabel}
            type="button"
          >
            {themeIcon}
          </button>
          <button
            className="text-muted-foreground hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg transition-colors flex items-center justify-center size-8"
            onClick={onOpenPopout}
            aria-label={copy.popout}
            title={copy.popout}
            type="button"
          >
            <ExternalLink className="w-4 h-4" />
          </button>
        </div>
      </header>

      <Tabs
        className="flex min-h-0 flex-1 flex-col"
        value={scene.tabs.active}
        onValueChange={(value) => onSelectTab(value as PopupTab)}
      >
        <TabsList className="mx-3 mt-3 shrink-0 h-auto justify-start gap-1 rounded-none border-b border-border bg-transparent p-0">
          <TabsTrigger data-testid="popup-tab-source" className="rounded-none border-b-[3px] border-transparent px-4 pb-2.5 pt-0 text-sm font-semibold shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none transition-colors" value="source">
            {copy.tabSource}
          </TabsTrigger>
          <TabsTrigger data-testid="popup-tab-room" className="rounded-none border-b-[3px] border-transparent px-4 pb-2.5 pt-0 text-sm font-semibold shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none transition-colors" value="room">
            {copy.tabRoom}
            {scene.tabs.roomBadgeVisible && <span className="ml-2 inline-block size-2 rounded-full bg-green-500 animate-pulse" />}
          </TabsTrigger>
          {scene.tabs.chatVisible && (
            <TabsTrigger data-testid="popup-tab-chat" className="rounded-none border-b-[3px] border-transparent px-4 pb-2.5 pt-0 text-sm font-semibold shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none transition-colors" value="chat">
              {copy.tabChat}
            </TabsTrigger>
          )}
        </TabsList>

        <div className="min-h-0 flex-1 overflow-hidden">
          <TabsContent value="source" className="mt-0 h-full outline-none">
            <div className="flex h-full min-h-0 flex-col">
              <div className="shrink-0 p-4 pb-0">
                <div className="p-1 bg-zinc-100 dark:bg-zinc-900/50 rounded-lg flex items-center shadow-inner">
                  <SourceTypeButton active={scene.sourceTab.activeSourceType === "auto"} sourceActive={scene.sourceTab.activeSourceIndicator === "auto"} icon={<Zap className="w-3.5 h-3.5 shrink-0" />} label={copy.sourceAuto} onClick={() => onSelectSourceType("auto")} />
                  <SourceTypeButton active={scene.sourceTab.activeSourceType === "sniff"} sourceActive={scene.sourceTab.activeSourceIndicator === "sniff"} icon={<Search className="w-3.5 h-3.5 shrink-0" />} label={copy.sourceSniff} onClick={() => onSelectSourceType("sniff")} />
                  <SourceTypeButton active={scene.sourceTab.activeSourceType === "screen"} sourceActive={scene.sourceTab.activeSourceIndicator === "screen"} icon={<MonitorUp className="w-3.5 h-3.5 shrink-0" />} label={copy.sourceScreen} onClick={() => onSelectSourceType("screen")} />
                  <SourceTypeButton active={scene.sourceTab.activeSourceType === "upload"} sourceActive={scene.sourceTab.activeSourceIndicator === "upload"} icon={<UploadCloud className="w-3.5 h-3.5 shrink-0" />} label={copy.sourceUpload} onClick={() => onSelectSourceType("upload")} />
                </div>
              </div>
              {effectiveSourceType === "auto" ? (
                <PopupScrollArea className="min-h-0 flex-1" contentClassName="p-4 pb-8 flex flex-col gap-4 min-h-full">
                  <AutoTabPanel
                    copy={copy}
                    enabled={isAutoFollow}
                    playbackLabel={playbackLabel}
                    playbackState={scene.header.playback.state}
                    onEnable={() => onToggleFollowActiveTabVideo(true)}
                    onDisable={() => onToggleFollowActiveTabVideo(false)}
                  />
                </PopupScrollArea>
              ) : effectiveSourceType === "sniff" ? (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="shrink-0 px-4 pb-2 pt-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-1">
                        <LinkIcon className="w-3 h-3" />
                        {copy.detected}
                      </div>
                      <button onClick={onRefreshSniff} aria-label={copy.refreshSniff} className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400 hover:text-blue-700 transition-colors bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded disabled:opacity-70" type="button" disabled={scene.sourceTab.isRefreshing}>
                        <RefreshCw className={cn("w-3.5 h-3.5", scene.sourceTab.isRefreshing && "animate-spin")} />
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
                    <div className="flex flex-col gap-4" data-testid="popup-sniff-groups">
                      {scene.sourceTab.sniffGroups.length > 0 ? scene.sourceTab.sniffGroups.map((group) => (
                        <section key={group.id} className="flex flex-col gap-2">
                          {(() => {
                            const isCollapsed = collapsedSniffGroupIds.has(group.id);
                            return (
                              <>
                                <button
                                  aria-expanded={!isCollapsed}
                                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] font-bold text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors group/header"
                                  onClick={() => toggleSniffGroup(group.id)}
                                  type="button"
                                >
                                  {isCollapsed ? (
                                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover/header:translate-x-0.5" />
                                  ) : (
                                    <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover/header:translate-y-0.5" />
                                  )}
                                  <span className="size-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.4)]" />
                                  <span className="min-w-0 flex-1 truncate" title={group.title}>{group.title}</span>
                                  <span className="shrink-0 text-[10px] font-bold text-muted-foreground bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded-md border border-border/50 tabular-nums">{group.cards.length}</span>
                                </button>
                                {!isCollapsed && (
                                  group.cards.length > 0 ? group.cards.map((card) => (
                                    <button
                                      key={card.id}
                                      data-testid={`popup-sniff-card-${card.id}`}
                                      data-selected={card.selected ? "true" : "false"}
                                      type="button"
                                      onClick={() => onSelectSource(card.id)}
                                      onPointerEnter={() => onPreviewSource(card.id)}
                                      onPointerLeave={onClearSourcePreview}
                                      className={cn(
                                        "relative overflow-hidden rounded-xl border transition-[border-color,background-color,box-shadow,ring] duration-200 cursor-pointer group flex bg-zinc-50 dark:bg-zinc-900/40 text-left w-full hover:shadow-md",
                                        card.selected ? "border-blue-600 dark:border-blue-500 shadow-sm ring-2 ring-blue-500/20 bg-blue-50/10 dark:bg-blue-900/10" : "border-border/60 hover:border-blue-500/50 hover:bg-white dark:hover:bg-zinc-800/60",
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
                                      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 px-3 py-2 pr-9">
                                        <p className="truncate text-xs font-bold leading-tight text-foreground transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400" title={card.label}>{card.title}</p>
                                        <div className="flex min-w-0 items-center gap-2">
                                          <span className="truncate text-[9px] text-blue-700 dark:text-blue-300 bg-blue-100/60 dark:bg-blue-900/40 px-1.5 py-[1px] rounded font-bold border border-blue-200/50 dark:border-blue-800/40 tracking-tight uppercase">
                                            {card.format}
                                          </span>
                                          <span className="shrink-0 text-[10px] text-muted-foreground font-mono font-medium">{card.rate}</span>
                                        </div>
                                      </div>
                                      {card.selected && (
                                        <div className="absolute right-2.5 top-1/2 -translate-y-1/2 size-5 rounded-full bg-blue-600 dark:bg-blue-500 flex items-center justify-center shadow-md animate-in zoom-in duration-200">
                                          <Check className="w-3 h-3 text-white stroke-[3]" />
                                        </div>
                                      )}
                                    </button>
                                  )) : (
                                    <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground bg-zinc-50/50 dark:bg-zinc-900/20">
                                      {copy.noVideo}
                                    </div>
                                  )
                                )}
                              </>
                            );
                          })()}
                        </section>
                      )) : (
                        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground bg-zinc-50/50 dark:bg-zinc-900/20">
                          {copy.noVideo}
                        </div>
                      )}
                    </div>
                  </PopupScrollArea>
                </div>
              ) : (
                <PopupScrollArea className="min-h-0 flex-1" contentClassName="p-4 pb-8 flex flex-col gap-6 min-h-full">
                  {effectiveSourceType === "screen" && (
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
                            <p className="text-[15px] font-bold text-green-600 dark:text-green-400 mb-1">{copy.screenReady}</p>
                            <p className="text-xs text-muted-foreground mb-5 font-medium leading-relaxed max-w-[240px] mx-auto">{copy.screenReadyDescription}</p>
                            <button className="py-2 px-4 bg-white hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900 text-foreground font-semibold rounded-lg border border-border shadow-sm transition-colors text-xs active:scale-95" onClick={onToggleScreenReady} type="button">
                              {copy.reselect}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {effectiveSourceType === "upload" && (
                    <div className="flex flex-col gap-4 flex-1 pb-6">
                      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
                        <FileVideo className="w-3.5 h-3.5" />
                        {copy.sourceUpload}
                      </div>

                      <div className="border-2 border-dashed border-border rounded-xl aspect-[4/3] flex flex-col items-center justify-center p-8 gap-5 text-center bg-zinc-50/30 dark:bg-zinc-900/10 transition-all hover:bg-zinc-50/50 dark:hover:bg-zinc-900/20 group cursor-pointer" onClick={onOpenPlayer}>
                        <div className="size-16 rounded-full bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform duration-300">
                          <ExternalLink className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div>
                          <p className="text-[15px] font-bold text-foreground group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">{copy.openPlayer}</p>
                          <p className="text-xs text-muted-foreground mt-2 font-medium leading-relaxed max-w-[200px] mx-auto">{copy.playerDesc}</p>
                        </div>
                        <div className="mt-2 py-1.5 px-4 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black text-xs font-bold rounded-lg shadow-md active:scale-95 transition-transform flex items-center gap-2">
                          Launch Player <ChevronRight className="w-3 h-3" />
                        </div>
                      </div>
                    </div>
                  )}
                </PopupScrollArea>
              )}
              {shouldShowMetaMessage && (
                <div className="shrink-0 px-4 pb-3">
                  <div className="rounded-xl bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400 border border-red-100 dark:border-red-500/20 p-3 text-xs shadow-sm flex items-start gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
                    <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span className="leading-relaxed">{scene.meta.message}</span>
                  </div>
                </div>
              )}
              <PopupFooterActions
                copy={copy}
                scene={scene}
                context="source"
                onCancel={() => onSelectTab("room")}
                onStartOrAttach={onStartOrAttach}
                onStopRoom={onStopRoom}
              />
            </div>
          </TabsContent>

          <TabsContent value="room" className="mt-0 h-full outline-none">
            <div className="flex h-full min-h-0 flex-col">
              <PopupScrollArea className="min-h-0 flex-1" contentClassName="p-4 flex flex-col gap-6">
                {scene.roomTab.state === "empty" ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center gap-4 opacity-70 px-8 py-20 min-h-[400px] animate-in fade-in duration-500">
                    <div className="size-16 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mb-2">
                      <Info className="w-8 h-8 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium leading-relaxed">{copy.notSharedYet}</p>
                  </div>
                ) : (
                  <>
                    <div className="bg-white dark:bg-zinc-900 border border-border rounded-xl shadow-sm text-sm overflow-hidden animate-in slide-in-from-bottom-2 duration-300" data-testid="popup-room-card">
                      <div className="p-3 border-b border-border bg-zinc-50/50 dark:bg-zinc-950/50 flex justify-between items-center transition-colors">
                        <div className="flex items-center gap-2">
                          <Hash className="w-4 h-4 text-blue-500" />
                          <span className="font-bold">
                            {copy.roomId}: <span data-testid="popup-room-id-value">{scene.roomTab.roomId}</span>
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button className="rounded-md p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors" onClick={onCopyRoomId} aria-label="Copy Room ID" type="button">
                            <Copy className="w-4 h-4" />
                          </button>
                          <button className="text-xs text-blue-600 dark:text-blue-400 font-bold flex items-center gap-1.5 hover:underline decoration-2 underline-offset-4 transition-[color,text-decoration-color]" onClick={onJumpToRoom} type="button">
                            {copy.openRoom} <ExternalLink className="w-3 h-3 stroke-[3]" />
                          </button>
                        </div>
                      </div>
                      <div className="p-3 flex flex-col gap-4">
                        <div className="relative group">
                          <input readOnly type="text" value={scene.roomTab.shareUrl ?? ""} className="w-full bg-zinc-100 dark:bg-zinc-950 border border-border rounded-lg pl-3 pr-10 py-2.5 text-xs font-mono text-muted-foreground outline-none truncate transition-colors focus:bg-white dark:focus:bg-black" />
                          <button className="absolute right-1.5 top-1.5 p-1.5 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-800 text-muted-foreground transition-[background-color,transform] active:scale-90" onClick={onCopyLink} aria-label="Copy Room Link" type="button">
                            <Copy className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="size-7 flex items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800 shrink-0 border border-border shadow-sm">
                            <Key className="w-3.5 h-3.5 text-muted-foreground" />
                          </div>
                          <input
                            data-testid="popup-room-password-input"
                            type="text"
                            value={scene.roomTab.passwordDraft}
                            onChange={(event) => onPasswordChange(event.target.value)}
                            placeholder={copy.passwordPlaceholder}
                            className="flex-1 bg-transparent border-b border-border px-1 py-1.5 text-xs font-bold focus:border-blue-500 focus:outline-none transition-colors dark:text-zinc-200 placeholder:font-medium"
                          />
                          <button
                            data-testid="popup-room-password-save"
                            onClick={onSavePassword}
                            type="button"
                            className={cn("text-xs px-3 py-1.5 rounded-lg font-bold transition-[background-color,transform,box-shadow] shadow-sm whitespace-nowrap active:scale-95", scene.roomTab.passwordSaved ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border border-green-200 dark:border-green-800/50" : "bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200 border border-transparent")}
                          >
                            {scene.roomTab.passwordSaved ? copy.saved : copy.save}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white dark:bg-zinc-900 border border-border rounded-xl shadow-sm text-sm overflow-hidden flex flex-col animate-in slide-in-from-bottom-3 duration-400" data-testid="popup-viewer-roster">
                      <div className="p-3 border-b border-border bg-zinc-50/50 dark:bg-zinc-950/50 flex justify-between items-center transition-colors">
                        <div className="flex items-center gap-2">
                          <Users className="w-4 h-4 text-blue-500" />
                          <span className="font-bold">{copy.viewerList}</span>
                        </div>
                        <span data-testid="popup-viewer-count" className="px-2 py-0.5 rounded-full bg-blue-100/80 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-[10px] font-bold border border-blue-200 dark:border-blue-800/30 tabular-nums">
                          {scene.roomTab.viewerCount}
                        </span>
                      </div>
                      <div className="grid grid-cols-[1fr_70px_50px] gap-2 px-3 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-widest items-center border-b border-border/50 bg-zinc-50 dark:bg-zinc-900/30 transition-colors">
                        <span>{copy.viewerName}</span>
                        <span className="text-center">{copy.connType}</span>
                        <span className="text-right flex items-center justify-end gap-1">
                          <Activity className="w-2.5 h-2.5" />
                          {copy.connPing}
                        </span>
                      </div>
                      <div className="divide-y divide-border/50">
                        {scene.roomTab.viewerDetails.map((viewer) => (
                          <div key={viewer.id} data-testid={`popup-viewer-row-${viewer.id}`} data-online={viewer.online ? "true" : "false"} className="grid grid-cols-[1fr_70px_50px] gap-2 px-3 py-2.5 items-center hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors group">
                            <div className="font-bold text-xs flex items-center gap-2 min-w-0 pr-1">
                              <div
                                className={cn(
                                  "size-1.5 rounded-full shrink-0",
                                  viewer.online
                                    ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]"
                                    : "bg-zinc-300 dark:bg-zinc-600",
                                )}
                              />
                              <span data-testid={`popup-viewer-name-${viewer.id}`} className="truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">{viewer.name}</span>
                            </div>
                            <div className="flex justify-center">
                              <span className="text-[9px] font-bold text-muted-foreground bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded-md border border-border whitespace-nowrap transition-colors group-hover:border-zinc-300 dark:group-hover:border-zinc-700">
                                {viewer.connType}
                              </span>
                            </div>
                            <div className={cn("font-mono font-bold text-[11px] text-right transition-colors", viewer.isGood ? "text-green-600 dark:text-green-400" : "text-amber-500")}>
                              {viewer.ping}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </PopupScrollArea>
              {scene.tabs.hasOpenRoomSession && (
                <PopupFooterActions
                  copy={copy}
                  scene={scene}
                  context="room"
                  onCancel={() => onSelectTab("room")}
                  onStartOrAttach={onStartOrAttach}
                  onStopRoom={onStopRoom}
                />
              )}
            </div>
          </TabsContent>

          {scene.tabs.chatVisible && (
            <TabsContent value="chat" className="mt-0 h-full outline-none">
              <div className="flex h-full min-h-0 flex-col animate-in fade-in slide-in-from-right-2 duration-200">
                <ChatPane messages={scene.chatTab.messages} onSend={onSendChat} placeholder={copy.chatPlaceholder} />
              </div>
            </TabsContent>
          )}
        </div>
      </Tabs>
    </main>
  );
}

function PopupFooterActions({
  context,
  copy,
  onCancel,
  onStartOrAttach,
  onStopRoom,
  scene,
}: {
  context: "source" | "room";
  copy: ExtensionDictionary;
  onCancel: () => void;
  onStartOrAttach: () => void;
  onStopRoom: () => void;
  scene: ExtensionSceneModel;
}) {
  if (scene.footer.variant === "hidden") {
    return null;
  }

  return (
    <div className="shrink-0 border-t border-border bg-card/95 backdrop-blur-md p-4">
      {scene.footer.variant === "end-share" ? (
        <button
          data-testid="popup-stop-room"
          onClick={onStopRoom}
          disabled={scene.footer.disabled}
          type="button"
          className="w-full py-3.5 bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-900/40 border border-red-200 dark:border-red-900/50 rounded-xl font-bold transition-[background-color,transform,box-shadow] text-sm flex items-center justify-center gap-2 shadow-sm active:scale-[0.98] disabled:opacity-50"
        >
          <X className="w-4 h-4 stroke-[3]" />
          {copy.endShare}
        </button>
      ) : scene.footer.variant === "start-room" ? (
        <button
          data-testid="popup-start-or-attach"
          onClick={onStartOrAttach}
          className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-sm transition-[background-color,transform,box-shadow] shadow-sm hover:shadow-md active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
          disabled={scene.footer.disabled}
          type="button"
        >
          <Play className="w-4 h-4 fill-current" />
          {copy.generateShare}
        </button>
      ) : (
        <div className="flex items-center gap-3 w-full">
          <button
            onClick={onCancel}
            className="flex-1 py-3.5 px-4 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900/80 dark:hover:bg-zinc-800 text-sm font-bold rounded-xl transition-colors border border-transparent flex items-center justify-center text-foreground"
            type="button"
          >
            {copy.cancel}
          </button>
          <button
            onClick={onStartOrAttach}
            className="flex-1 py-3.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition-[background-color,transform,box-shadow] shadow-sm hover:shadow-md active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
            disabled={scene.footer.confirmDisabled}
            type="button"
          >
            <RefreshCw className="w-4 h-4" />
            {copy.changeSource}
          </button>
        </div>
      )}
    </div>
  );
}

function SourceTypeButton({ active, icon, label, onClick, sourceActive }: { active: boolean; icon: ReactNode; label: string; onClick: () => void; sourceActive?: boolean }) {
  return (
    <button
      onClick={onClick}
      type="button"
      className={cn("relative flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] font-semibold rounded-md transition-[background-color,color,box-shadow,border-color] border", active ? "bg-white dark:bg-zinc-800 shadow-sm border-zinc-200 dark:border-zinc-700 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
    >
      {icon}
      <span className="truncate">{label}</span>
      {sourceActive && (
        <span aria-hidden="true" className="absolute top-1 right-1 size-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]" />
      )}
    </button>
  );
}

function AutoTabPanel({
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
          <span className={cn(
            "h-2.5 w-2.5 rounded-full",
            playbackState === "active" ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)] animate-[pulse_2s_ease-in-out_infinite]" : "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]"
          )} />
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
        <span className="font-semibold text-foreground truncate max-w-[150px]" title={playbackLabel}>
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

function formatPlaybackLabel(label: string, copy: ExtensionDictionary) {
  const trimmed = label.trim();
  return trimmed.startsWith("blob:") ? copy.webVideoStream : trimmed;
}

function CaptureOptionCard({ title, description, icon, onClick }: { title: string; description: string; icon: ReactNode; onClick: () => void }) {
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
        <p className="text-[12px] font-bold text-foreground leading-none">{title}</p>
        <p className="text-[10px] text-muted-foreground leading-tight truncate">{description}</p>
      </div>
      <ChevronRight className="size-4 text-zinc-300 dark:text-zinc-600 group-hover:text-blue-400 transition-colors shrink-0" />
    </button>
  );
}

function Dropzone({ onSelectFile, placeholder }: { onSelectFile: (file: { name: string; size: number; type: string }) => void; placeholder: string }) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file && file.type.startsWith("video/")) {
      onSelectFile({
        name: file.name,
        size: file.size,
        type: file.type,
      });
    }
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      className={cn(
        "border-2 border-dashed rounded-xl aspect-[4/3] flex flex-col items-center justify-center p-8 gap-5 text-center transition-all cursor-pointer group",
        isDragging
          ? "border-blue-500 bg-blue-50/50 dark:bg-blue-900/20 scale-[1.02] shadow-lg"
          : "border-border bg-zinc-50/30 dark:bg-zinc-900/10 hover:bg-zinc-50/50 dark:hover:bg-zinc-900/20",
      )}
    >
      <input
        type="file"
        ref={inputRef}
        className="hidden"
        accept="video/mp4,video/webm,video/x-matroska"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <div className={cn("size-16 rounded-full flex items-center justify-center transition-all duration-300 shadow-sm", isDragging ? "bg-blue-100 dark:bg-blue-900/40 scale-110" : "bg-blue-50 dark:bg-blue-500/10 group-hover:scale-110")}>
        <UploadCloud className={cn("size-8 transition-colors", isDragging ? "text-blue-600 dark:text-blue-400" : "text-blue-500")} />
      </div>
      <div>
        <p className={cn("text-[15px] font-bold transition-colors", isDragging ? "text-blue-600 dark:text-blue-400" : "text-foreground group-hover:text-blue-600 dark:group-hover:text-blue-400")}>{placeholder}</p>
        <p className="text-xs text-muted-foreground mt-2 font-medium">MP4, WebM, MKV • Max 2GB</p>
      </div>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function ChatPane({ messages, onSend, placeholder }: { messages: ExtensionSceneModel["chatTab"]["messages"]; onSend: (text: string) => boolean | Promise<boolean>; placeholder: string }) {
  return <ChatPaneInner messages={messages} onSend={onSend} placeholder={placeholder} roundedBottom />;
}

export function ContentChatWidget({
  messages,
  onSend,
  minimized,
  onToggleMinimized,
  title,
  placeholder,
}: {
  messages: ExtensionSceneModel["chatTab"]["messages"];
  onSend: (text: string) => boolean | Promise<boolean>;
  minimized: boolean;
  onToggleMinimized: () => void;
  title: string;
  placeholder: string;
}) {
  return (
    <div className={cn("fixed bottom-6 left-6 z-[2147483646] bg-card border border-border shadow-2xl rounded-2xl overflow-hidden transition-[width,height,opacity,box-shadow] duration-300 flex flex-col font-sans hover:shadow-blue-500/10", minimized ? "w-48 h-12 cursor-pointer opacity-90 hover:opacity-100" : "w-[340px] h-[480px]")}>
      <div className="p-3 border-b border-border bg-zinc-50 dark:bg-zinc-900/50 flex items-center justify-between shrink-0 cursor-pointer transition-colors" onClick={onToggleMinimized}>
        <div className="flex items-center gap-2.5 px-1">
          <MessageCircle className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <span className="font-bold text-sm tracking-tight">{title}</span>
        </div>
        {minimized ? <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse mr-2" /> : <span className="w-7 h-7 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 rounded-md flex items-center justify-center transition-colors"><X className="w-4 h-4 text-muted-foreground stroke-[3]" /></span>}
      </div>
      {!minimized && <ChatPaneInner messages={messages} onSend={onSend} placeholder={placeholder} />}
    </div>
  );
}

function ChatPaneInner({ messages, onSend, placeholder, roundedBottom = false }: { messages: ExtensionSceneModel["chatTab"]["messages"]; onSend: (text: string) => boolean | Promise<boolean>; placeholder: string; roundedBottom?: boolean }) {
  return (
    <>
      <PopupScrollArea
        data-testid="popup-chat-messages"
        className="flex-1"
        contentClassName="p-4 flex flex-col gap-4 relative min-h-full bg-zinc-50/50 dark:bg-zinc-950/30"
      >
        <div
          className="absolute inset-0 opacity-100 dark:opacity-0 pointer-events-none"
          style={{ backgroundImage: `url(${cubesPattern})` }}
        />
        {messages.map((message) => (
          <div key={message.id} data-testid={`popup-chat-message-${message.id}`} className="flex flex-col gap-1 animate-in fade-in slide-in-from-bottom-1 duration-200 relative z-10">
            <span className={cn("text-[10px] font-bold tracking-widest uppercase", message.sender === "System" ? "text-gray-400" : "text-blue-500")}>
              {message.sender}
            </span>
            <p className={cn("text-sm px-3.5 py-2 rounded-2xl w-max max-w-[90%] shadow-sm leading-relaxed transition-[background-color,color,border-color]", message.sender === "System" ? "bg-transparent text-gray-500 italic px-0 shadow-none" : "bg-white dark:bg-zinc-900 text-foreground border border-border")}>
              {message.text}
            </p>
          </div>
        ))}
      </PopupScrollArea>
      <form
        className={cn("p-3 border-t border-border bg-card flex gap-2 shrink-0", roundedBottom && "pb-6 rounded-b-2xl")}
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const formData = new FormData(form);
          const value = String(formData.get("message") ?? "").trim();
          if (!value) {
            return;
          }
          void Promise.resolve(onSend(value)).then((sent) => {
            if (sent) {
              form.reset();
            }
          });
        }}
      >
        <input
          data-testid="popup-chat-input"
          name="message"
          type="text"
          placeholder={placeholder}
          className="flex-1 min-w-0 bg-zinc-100 dark:bg-zinc-900 border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-[background-color,ring] font-medium"
        />
        <button data-testid="popup-chat-send" type="submit" className="w-12 bg-blue-600 text-white rounded-xl flex items-center justify-center transition-[background-color,transform] hover:bg-blue-700 active:scale-90 shadow-sm shrink-0">
          <Send className="w-4 h-4" />
        </button>
      </form>
    </>
  );
}

function PopupScrollArea({
  children,
  className,
  contentClassName,
  initialScrollTop = 0,
  onScrollTopChange,
  "data-testid": dataTestId,
}: {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  initialScrollTop?: number;
  onScrollTopChange?: (scrollTop: number) => void;
  "data-testid"?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hasRestoredScrollRef = useRef(false);

  useEffect(() => {
    if (hasRestoredScrollRef.current) {
      return;
    }

    const node = containerRef.current;
    if (node) {
      node.scrollTop = initialScrollTop;
      hasRestoredScrollRef.current = true;
    }
  }, [initialScrollTop]);

  return (
    <div
      ref={containerRef}
      data-testid={dataTestId}
      className={cn("popup-scroll-area min-h-0 flex-1 overflow-y-auto overflow-x-hidden", className)}
      onScroll={(event) => {
        onScrollTopChange?.(event.currentTarget.scrollTop);
      }}
    >
      <div className={cn("box-border", contentClassName)}>{children}</div>
    </div>
  );
}
