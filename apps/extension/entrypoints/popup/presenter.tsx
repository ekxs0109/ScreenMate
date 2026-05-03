import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ExternalLink,
  Link as LinkIcon,
  Monitor,
  Moon,
  Play,
  Search,
  Sun,
  UploadCloud,
  MonitorUp,
} from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { cn } from "../../lib/utils";
import type { ExtensionDictionary } from "./i18n";
import type { ExtensionSceneModel, PopupTab, SourceType } from "./scene-model";
import { ChatPane } from "./chat-pane";
import { PopupHeaderStatusSummary } from "./header-status-summary";
import { RoomTabPanel } from "./room-tab-panel";
import {
  AutoTabPanel,
  formatPlaybackLabel,
  ScreenPanel,
  SniffPanel,
  SourceTypeButton,
  SourceTypeSwitcher,
  UploadPanel,
} from "./source-tab-panels";

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
  onCreateRoom = () => { },
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
  onStopScreenShare,
  onStopLocalPlayback = () => { },
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
  onCreateRoom?: () => void;
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
  onStopScreenShare?: () => void;
  onStopLocalPlayback?: () => void;
  onStartOrAttach: (
    sourceType?: SourceType,
    options?: { selectedVideoId?: string },
  ) => void;
  onStopRoom: () => void;
  onSavePassword: () => void;
  onPasswordChange: (value: string) => void;
  onCopyLink: () => void;
  onCopyRoomId: () => void;
  onJumpToRoom: () => void;
  onSendChat: (text: string) => boolean | Promise<boolean>;
}) {
  const isAutoFollow = scene.sourceTab.followActiveTabVideo;
  const effectiveSourceType = scene.sourceTab.activeSourceType;
  const playbackLabel =
    formatPlaybackLabel(scene.header.playback.label, copy) ||
    (scene.header.playback.state === "active"
      ? copy.currentPlayback
      : copy.waitingPlayback);
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
        "bg-card text-card-foreground flex min-h-0 flex-col overflow-hidden",
        windowMode === "popup"
          ? "h-[600px] w-[400px] border border-border/80"
          : "h-dvh w-dvw min-w-[360px] min-h-[500px]",
      )}
    >
      <header className="shrink-0 border-b border-border bg-zinc-50/85 dark:bg-zinc-950/85 backdrop-blur transition-colors p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="font-bold tracking-tight text-[15px] text-foreground">
            {copy.appName}
          </span>
          <div className="flex items-center gap-0.5 shrink-0 -mr-1">
            <button
              aria-label={copy.themeLabel}
              className={cn(
                "hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg transition-colors flex items-center justify-center size-7",
                themeTriggerClassName,
              )}
              onClick={onThemeToggle}
              title={copy.themeLabel}
              type="button"
            >
              {themeIcon}
            </button>
            {windowMode === "popup" && (
              <button
                className="text-muted-foreground hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg transition-colors flex items-center justify-center size-7"
                onClick={onOpenPopout}
                aria-label={copy.popout}
                title={copy.popout}
                type="button"
              >
                <ExternalLink className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        <PopupHeaderStatusSummary copy={copy} scene={scene} />
      </header>

      {!scene.tabs.hasOpenRoomSession ? (
        <PopupCreateRoomGate
          busy={scene.meta.isBusy}
          copy={copy}
          onCreateRoom={onCreateRoom}
        />
      ) : (

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
                <SourceTypeSwitcher
                  activeIndicator={scene.sourceTab.activeSourceIndicator || (isAutoFollow ? "auto" : null)}
                  activeType={scene.sourceTab.activeSourceType}
                  copy={copy}
                  onSelect={onSelectSourceType}
                />
                {effectiveSourceType === "auto" ? (
                  <PopupScrollArea className="min-h-0 flex-1" contentClassName="p-4 flex flex-col gap-4 min-h-full">
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
                  <SniffPanel
                    scene={scene}
                    copy={copy}
                    sniffScrollTop={sniffScrollTop}
                    collapsedSniffGroupIds={collapsedSniffGroupIds}
                    onRefreshSniff={onRefreshSniff}
                    onPreviewSource={onPreviewSource}
                    onClearSourcePreview={onClearSourcePreview}
                    onStartOrAttach={onStartOrAttach}
                    onSniffScrollChange={onSniffScrollChange}
                    onToggleSniffGroup={toggleSniffGroup}
                  />
                ) : (
                  <PopupScrollArea className="min-h-0 flex-1" contentClassName="p-4 flex flex-col gap-6 min-h-full">
                    {effectiveSourceType === "screen" && (
                      <ScreenPanel
                        scene={scene}
                        copy={copy}
                        onCaptureScreen={onCaptureScreen}
                        onToggleScreenReady={onToggleScreenReady}
                        onStopScreenShare={onStopScreenShare ?? onToggleScreenReady}
                      />
                    )}

                    {effectiveSourceType === "upload" && (
                      <UploadPanel
                        scene={scene}
                        copy={copy}
                        onOpenPlayer={onOpenPlayer}
                        onStopLocalPlayback={onStopLocalPlayback}
                      />
                    )}
                  </PopupScrollArea>
                )}
              </div>
            </TabsContent>

            <TabsContent value="room" className="mt-0 h-full outline-none">
              <RoomTabPanel
                scene={scene}
                copy={copy}
                onCopyLink={onCopyLink}
                onCopyRoomId={onCopyRoomId}
                onJumpToRoom={onJumpToRoom}
                onStopRoom={onStopRoom}
                onSavePassword={onSavePassword}
                onPasswordChange={onPasswordChange}
              />
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
      )}
    </main>
  );
}

function PopupCreateRoomGate({
  busy,
  copy,
  onCreateRoom,
}: {
  busy: boolean;
  copy: ExtensionDictionary;
  onCreateRoom: () => void;
}) {
  return (
    <section className="relative flex min-h-0 flex-1 flex-col items-center justify-center px-8 py-10 text-center overflow-hidden">
      {/* Decorative background gradients */}
      <div className="absolute -top-24 -left-24 size-64 rounded-full bg-blue-500/10 blur-[60px] pointer-events-none" />
      <div className="absolute -bottom-24 -right-24 size-64 rounded-full bg-emerald-500/10 blur-[60px] pointer-events-none" />

      <div className="group relative mb-8">
        {/* Pulse glow effect */}
        <div className="absolute -inset-1.5 rounded-[2rem] bg-gradient-to-b from-blue-500/20 to-purple-500/20 blur-xl transition-all duration-700 opacity-60 group-hover:opacity-100 group-hover:scale-110 group-hover:animate-pulse" />

        <div className="relative flex size-20 items-center justify-center rounded-3xl border border-zinc-200/60 bg-white/50 text-blue-600 shadow-xl backdrop-blur-xl transition-all duration-500 group-hover:-translate-y-1 group-hover:scale-105 group-hover:border-blue-500/30 group-hover:shadow-2xl group-hover:shadow-blue-500/20 dark:border-zinc-800/60 dark:bg-zinc-950/50 dark:text-blue-400">
          <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-blue-500/5 via-transparent to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

          {/* Main icon with subtle rotate and scale on hover */}
          <LinkIcon className="relative size-8 stroke-[2] transition-all duration-500 group-hover:scale-110 group-hover:-rotate-12 group-hover:text-blue-500 dark:group-hover:text-blue-300" />
        </div>
      </div>

      <div className="relative z-10 flex flex-col items-center gap-2">
        <h2 className="text-lg font-bold tracking-tight text-foreground">
          {copy.sourceGateTitle}
        </h2>
        <p className="max-w-[260px] text-xs leading-relaxed text-muted-foreground">
          {copy.sourceGateDescription}
        </p>
      </div>

      <button
        data-testid="popup-create-room"
        disabled={busy}
        onClick={onCreateRoom}
        type="button"
        className="group relative z-10 mt-8 flex h-11 w-full max-w-[220px] items-center justify-center gap-2 overflow-hidden rounded-xl bg-foreground text-sm font-semibold text-background shadow-[0_0_0_1px_rgba(255,255,255,0.1)_inset] transition-all duration-300 hover:scale-[1.02] hover:shadow-lg active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
      >
        <div className="absolute inset-0 bg-gradient-to-r from-blue-500/0 via-blue-500/20 to-blue-500/0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        {busy ? (
          <div className="size-4 animate-spin rounded-full border-2 border-background/30 border-t-background" />
        ) : (
          <Play className="size-4 fill-current transition-transform duration-300 group-hover:scale-110" />
        )}
        <span className="relative">{copy.generateShare}</span>
      </button>
    </section>
  );
}

export function PopupScrollArea({
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
