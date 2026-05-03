import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  LogIn,
  LogOut,
  Monitor,
  Pause,
  Radio,
  Send,
  Shuffle,
  Users,
} from "lucide-react";
import { useTheme } from "next-themes";
import { createPlayer } from "@videojs/react";
import {
  LiveVideoSkin,
  Video,
  liveVideoFeatures,
} from "@videojs/react/live-video";
import "@videojs/react/live-video/skin.css";
import { JoinForm } from "./JoinForm";
import type { ViewerSceneModel } from "../viewer-scene-model";
import { cn } from "../lib/utils";
import { HeaderControls } from "./header-controls";
import { ChatPanel } from "./chat-panel";
import { useViewerI18n } from "../i18n";
import { createLogger } from "../lib/logger";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type PlaybackPrompt = "play" | "unmute" | null;

const viewerPlayerLogger = createLogger("viewer:player");
const viewerVideoPlayer = createPlayer({
  displayName: "ViewerVideoPlayer",
  features: liveVideoFeatures,
});
const ViewerVideoProvider = viewerVideoPlayer.Provider;

function getStreamResolution(stream: MediaStream | null) {
  if (!stream) {
    return null;
  }

  const fallbackTrack = stream.getVideoTracks?.()[0] ?? null;
  const fallbackSettings = fallbackTrack?.getSettings?.() ?? null;
  const fallbackWidth = typeof fallbackSettings?.width === "number" ? fallbackSettings.width : 0;
  const fallbackHeight = typeof fallbackSettings?.height === "number" ? fallbackSettings.height : 0;

  return fallbackWidth > 0 && fallbackHeight > 0
    ? `${fallbackWidth}x${fallbackHeight}`
    : null;
}

export function ViewerShell({
  scene,
  stream,
  onJoin,
  onLeaveRoom,
  onJoinOtherRoom,
  onRandomizeUsername,
  onDisplayNameChange,
  onSendMessage,
  initialRoomPassword = "",
}: {
  scene: ViewerSceneModel;
  stream: MediaStream | null;
  onJoin: (roomCode: string, password: string) => Promise<void>;
  onLeaveRoom: () => void;
  onJoinOtherRoom: () => void;
  onRandomizeUsername: () => void;
  onDisplayNameChange: (displayName: string) => void;
  onSendMessage: (text: string) => boolean;
  initialRoomPassword?: string;
}) {
  const { resolvedTheme, setTheme, theme } = useTheme();
  const { copy, locale, setLocale } = useViewerI18n();
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const playerVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(stream);
  const boundStreamRef = useRef<MediaStream | null>(null);
  const resolutionCleanupRef = useRef<(() => void) | null>(null);
  const playbackAttemptRef = useRef(0);
  const [playbackPrompt, setPlaybackPrompt] = useState<PlaybackPrompt>(null);
  const [videoResolution, setVideoResolution] = useState<string | null>(null);
  const [isWebFullscreen, setIsWebFullscreen] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'viewers'>('chat');
  const [sidebarWidth, setSidebarWidth] = useState(380);
  const [isResizing, setIsResizing] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState(
    scene.sidebar.username,
  );
  const fallbackStreamResolution = getStreamResolution(stream);
  const displayedResolution = videoResolution ?? fallbackStreamResolution;

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = window.innerWidth - e.clientX;
      if (newWidth > 280 && newWidth < 600) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  useEffect(() => {
    setDisplayNameDraft(scene.sidebar.username);
  }, [scene.sidebar.username]);

  function commitDisplayNameDraft(value: string) {
    if (!value.trim()) {
      setDisplayNameDraft(scene.sidebar.username);
      return;
    }

    onDisplayNameChange(value);
  }

  const updatePlaybackPrompt = useCallback(
    (
      nextPrompt: PlaybackPrompt,
      reason: string,
      details?: Record<string, unknown>,
    ) => {
      if (nextPrompt) {
        viewerPlayerLogger.info("Showing viewer playback prompt.", {
          prompt: nextPrompt,
          reason,
          ...details,
        });
      } else {
        viewerPlayerLogger.debug("Clearing viewer playback prompt.", {
          reason,
          ...details,
        });
      }

      setPlaybackPrompt(nextPrompt);
    },
    [],
  );

  const waitForPlaybackSettle = useCallback(async () => {
    await Promise.resolve();
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    });
  }, []);

  const clearPlayerVideo = useCallback((video: HTMLVideoElement) => {
    playbackAttemptRef.current += 1;
    resolutionCleanupRef.current?.();
    resolutionCleanupRef.current = null;
    boundStreamRef.current = null;
    viewerPlayerLogger.debug("Clearing viewer video element.", {
      hadStream: Boolean(video.srcObject),
      paused: video.paused,
    });
    video.pause?.();
    video.srcObject = null;
    video.removeAttribute("src");
    video.load?.();
    setVideoResolution(null);
    updatePlaybackPrompt(null, "player-cleared");
  }, [updatePlaybackPrompt]);

  const syncVideoResolution = useCallback(
    (
      video: HTMLVideoElement,
      nextStream: MediaStream | null,
      reason: string,
    ) => {
      const nextWidth = video.videoWidth;
      const nextHeight = video.videoHeight;
      const fallbackTrack = nextStream?.getVideoTracks?.()[0] ?? null;
      const fallbackSettings = fallbackTrack?.getSettings?.() ?? null;
      const fallbackWidth = typeof fallbackSettings?.width === "number" ? fallbackSettings.width : 0;
      const fallbackHeight = typeof fallbackSettings?.height === "number" ? fallbackSettings.height : 0;
      const width = nextWidth > 0 ? nextWidth : fallbackWidth;
      const height = nextHeight > 0 ? nextHeight : fallbackHeight;
      const nextResolution =
        width > 0 && height > 0 ? `${width}x${height}` : null;

      viewerPlayerLogger.debug("Synced viewer video resolution.", {
        reason,
        streamId: nextStream?.id ?? null,
        videoHeight: nextHeight,
        videoWidth: nextWidth,
        resolution: nextResolution,
      });
      setVideoResolution(nextResolution);
    },
    [],
  );

  const trackVideoResolution = useCallback(
    (video: HTMLVideoElement, nextStream: MediaStream | null) => {
      resolutionCleanupRef.current?.();
      resolutionCleanupRef.current = null;

      if (!nextStream) {
        setVideoResolution(null);
        return;
      }

      const handleResolutionChange = () => {
        syncVideoResolution(video, nextStream, "video-metadata");
      };

      video.addEventListener("loadedmetadata", handleResolutionChange);
      video.addEventListener("resize", handleResolutionChange);
      resolutionCleanupRef.current = () => {
        video.removeEventListener("loadedmetadata", handleResolutionChange);
        video.removeEventListener("resize", handleResolutionChange);
      };

      syncVideoResolution(video, nextStream, "stream-bound");
    },
    [syncVideoResolution],
  );

  const getAutoplayPolicy = useCallback((video: HTMLVideoElement) => {
    const policyReader = (
      navigator as Navigator & {
        getAutoplayPolicy?: (
          target: HTMLVideoElement,
        ) => "allowed" | "allowed-muted" | "disallowed";
      }
    ).getAutoplayPolicy;

    if (typeof policyReader !== "function") {
      return null;
    }

    try {
      return policyReader(video);
    } catch {
      return null;
    }
  }, []);

  const tryPlayVideo = useCallback(
    async (
      video: HTMLVideoElement,
      options: {
        muted: boolean;
        restoreAudioOnSuccess: boolean;
        successPrompt: PlaybackPrompt;
        promptAfterAudioRestorePause?: PlaybackPrompt;
      }
    ) => {
      const attemptId = ++playbackAttemptRef.current;
      viewerPlayerLogger.info("Attempting viewer playback.", {
        attemptId,
        muted: options.muted,
        restoreAudioOnSuccess: options.restoreAudioOnSuccess,
      });
      video.muted = options.muted;
      updatePlaybackPrompt(null, "playback-attempt-started", { attemptId });

      try {
        await video.play();

        if (playbackAttemptRef.current !== attemptId) {
          return;
        }

        viewerPlayerLogger.info("Viewer playback play() resolved.", {
          attemptId,
          muted: video.muted,
          paused: video.paused,
          readyState: video.readyState,
        });

        if (options.restoreAudioOnSuccess) {
          video.muted = false;
          viewerPlayerLogger.info("Tried to restore viewer audio after muted autoplay.", {
            attemptId,
            muted: video.muted,
            paused: video.paused,
          });
          await waitForPlaybackSettle();

          if (playbackAttemptRef.current !== attemptId) {
            return;
          }

          if (video.paused) {
            viewerPlayerLogger.warn("Viewer playback paused after audio restore.", {
              attemptId,
              readyState: video.readyState,
            });
            updatePlaybackPrompt(
              options.promptAfterAudioRestorePause ?? "play",
              "paused-after-audio-restore",
              { attemptId },
            );
            return;
          }
        }

        updatePlaybackPrompt(options.successPrompt, "playback-ready", {
          attemptId,
          muted: video.muted,
          paused: video.paused,
        });
      } catch (error) {
        if (playbackAttemptRef.current !== attemptId) {
          return;
        }

        viewerPlayerLogger.warn("Viewer playback play() was rejected.", {
          attemptId,
          error: error instanceof Error ? error.message : String(error),
          muted: video.muted,
        });
        updatePlaybackPrompt("play", "playback-rejected", { attemptId });
      }
    },
    [updatePlaybackPrompt, waitForPlaybackSettle],
  );

  const bindStreamToVideo = useCallback(
    (video: HTMLVideoElement, nextStream: MediaStream | null) => {
      if (video.srcObject === nextStream && boundStreamRef.current === nextStream) {
        return;
      }

      clearPlayerVideo(video);
      video.autoplay = false;
      video.playsInline = true;

      if (!nextStream) {
        viewerPlayerLogger.debug("Viewer stream cleared.");
        return;
      }

      video.srcObject = nextStream;
      boundStreamRef.current = nextStream;
      trackVideoResolution(video, nextStream);

      const autoplayPolicy = getAutoplayPolicy(video);
      viewerPlayerLogger.info("Binding stream to viewer player.", {
        autoplayPolicy,
        streamId: nextStream.id,
      });
      if (autoplayPolicy === "disallowed") {
        updatePlaybackPrompt("play", "autoplay-policy-disallowed", {
          streamId: nextStream.id,
        });
        return;
      }

      if (autoplayPolicy === "allowed") {
        void tryPlayVideo(video, {
          muted: false,
          restoreAudioOnSuccess: false,
          successPrompt: null,
        });
        return;
      }

      if (autoplayPolicy === "allowed-muted") {
        void tryPlayVideo(video, {
          muted: true,
          restoreAudioOnSuccess: false,
          successPrompt: "unmute",
        });
        return;
      }

      void tryPlayVideo(video, {
        muted: true,
        restoreAudioOnSuccess: true,
        successPrompt: null,
        promptAfterAudioRestorePause: "play",
      });
    },
    [clearPlayerVideo, getAutoplayPolicy, trackVideoResolution, tryPlayVideo, updatePlaybackPrompt],
  );

  const syncPlayerVideo = useCallback(
    (nextStream: MediaStream | null) => {
      const nextVideo =
        playerVideoRef.current ??
        playerContainerRef.current?.querySelector("video") ??
        null;

      if (!nextVideo) {
        return;
      }

      playerVideoRef.current = nextVideo;
      bindStreamToVideo(nextVideo, nextStream);
    },
    [bindStreamToVideo],
  );

  useEffect(() => {
    streamRef.current = stream;
    syncPlayerVideo(stream);
  }, [stream, syncPlayerVideo]);

  const retryPlayback = useCallback(() => {
    const video =
      playerVideoRef.current ??
      playerContainerRef.current?.querySelector("video") ??
      null;

    if (!video || !streamRef.current) {
      return;
    }

    viewerPlayerLogger.info("Viewer requested manual playback retry.");
    void tryPlayVideo(video, {
      muted: false,
      restoreAudioOnSuccess: false,
      successPrompt: null,
    });
  }, [tryPlayVideo]);

  const resumeAudio = useCallback(() => {
    const video =
      playerVideoRef.current ??
      playerContainerRef.current?.querySelector("video") ??
      null;

    if (!video) {
      return;
    }

    viewerPlayerLogger.info("Viewer requested manual audio resume.");
    void tryPlayVideo(video, {
      muted: false,
      restoreAudioOnSuccess: false,
      successPrompt: null,
    });
  }, [tryPlayVideo]);

  const attachPlayerVideo = useCallback(
    (video: HTMLVideoElement | null) => {
      if (!video) {
        return;
      }

      playerVideoRef.current = video;
      bindStreamToVideo(video, streamRef.current);
      viewerPlayerLogger.info("Attached viewer Video.js video element.", {
        hasInitialStream: Boolean(streamRef.current),
      });
    },
    [bindStreamToVideo],
  );

  useEffect(() => {
    const handleFullscreenChange = () => {
      const container = playerContainerRef.current;
      setIsWebFullscreen(
        Boolean(
          container &&
            document.fullscreenElement &&
            container.contains(document.fullscreenElement),
        ),
      );
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    return () => {
      const video =
        playerVideoRef.current ??
        playerContainerRef.current?.querySelector("video") ??
        null;

      if (video) {
        clearPlayerVideo(video);
      }

      viewerPlayerLogger.info("Unmounted viewer Video.js player.");
      playerVideoRef.current = null;
    };
  }, [clearPlayerVideo]);

  const handleThemeToggle = useCallback(() => {
    const nextTheme = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
    setTheme(nextTheme);
  }, [theme, setTheme]);

  return (
    <div className="w-full min-h-screen bg-zinc-100/50 dark:bg-black p-0 sm:p-4 lg:p-6 flex flex-col font-sans transition-colors">
      <div className="flex-1 flex flex-col bg-background dark:bg-zinc-900 text-foreground sm:rounded-xl overflow-hidden shadow-xl ring-1 ring-border/50 relative">
        {/* Header */}
        <header className="h-14 border-b border-border bg-zinc-50/80 dark:bg-zinc-900/80 backdrop-blur-md flex items-center justify-between gap-2 px-3 sm:px-4 lg:px-6 shrink-0 relative z-20">
          <div className="flex min-w-0 flex-1 items-center gap-2 lg:gap-4">
            <div className="flex items-center gap-2 shrink-0">
              <h1 className="text-lg font-bold tracking-tight hidden sm:block">{scene.header.title || 'ScreenMate'}</h1>
              <span className="px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 border border-red-200 dark:border-red-900/50 shadow-sm uppercase tracking-wider">{copy.liveBadge}</span>
            </div>

            {/* Connection Status Indicator in Header */}
            <div data-testid="viewer-connection-summary" className="flex flex-1 sm:flex-none min-w-0 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] items-center gap-2 sm:gap-3 px-2 sm:px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 border border-border rounded-full text-[10px] sm:text-xs font-medium ml-1 sm:ml-2 tracking-wide shadow-inner xl:gap-4 xl:px-4">
              <div className="flex items-center gap-1 sm:gap-1.5 text-muted-foreground shrink-0">
                <Radio className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-green-500" />
                <span className="hidden lg:inline">{copy.connectionLabel}: </span><span className="text-foreground">{scene.connection.typeLabel}</span>
              </div>
              <div className="w-px h-3 bg-border shrink-0" />
              <div className="flex items-center gap-1 sm:gap-1.5 text-muted-foreground shrink-0">
                <Activity className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-green-500" />
                <span className="hidden lg:inline">{copy.pingLabel}: </span><span className="text-green-600 dark:text-green-400">{scene.connection.pingLabel}</span>
              </div>
              {displayedResolution && (
                <>
                  <div className="hidden sm:block w-px h-3 bg-border shrink-0" />
                  <div className="hidden sm:flex items-center gap-1 sm:gap-1.5 text-muted-foreground shrink-0" data-testid="viewer-resolution">
                    <Monitor className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-blue-500" />
                    <span className="text-foreground">{displayedResolution}</span>
                    {scene.connection.videoCodecLabel && (
                      <span className="rounded bg-blue-100 px-1 sm:px-1.5 py-0.5 text-[8px] sm:text-[10px] font-bold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                        {scene.connection.videoCodecLabel}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 lg:gap-3 shrink-0">

            {/* Room Controls Group */}
            <div data-testid="viewer-room-controls" className="hidden md:flex items-center mr-1 border-r border-border pr-2 gap-1 lg:mr-2 lg:pr-3 lg:gap-2">
              <button onClick={onJoinOtherRoom} className="flex p-2 text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors border border-transparent hover:border-border text-xs font-medium items-center gap-1.5">
                <LogIn className="w-4 h-4" />
                <span className="hidden md:inline">{copy.joinOtherRoom}</span>
              </button>
              <button onClick={onLeaveRoom} className="flex p-2 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40 rounded-lg transition-colors border border-transparent hover:border-red-200 dark:hover:border-red-900/50 text-xs font-medium items-center gap-1.5">
                <LogOut className="w-4 h-4" />
                <span className="hidden md:inline">{copy.leaveRoom}</span>
              </button>
            </div>

            <HeaderControls
              language={locale}
              onLanguageChange={setLocale}
              themeMode={theme as "light" | "dark" | "system" || "system"}
              resolvedThemeMode={resolvedTheme as "light" | "dark" || "light"}
              onThemeToggle={handleThemeToggle}
            />
          </div>
        </header>

        {/* Main Content Floor */}
        <main className="flex-1 overflow-hidden flex flex-col lg:flex-row bg-zinc-50 dark:bg-zinc-900">

          {/* Left Side: Video Player */}
          <div className="w-full lg:flex-[3] aspect-video lg:aspect-auto flex flex-col relative shrink-0 z-10 bg-black lg:border-r border-border/10">
            <div className="absolute inset-0 w-full h-full flex items-center justify-center group overflow-hidden bg-black">
              <div
                data-testid="viewer-video"
                ref={playerContainerRef}
                className="absolute inset-0 h-full w-full outline-none [&_.vjs-root]:h-full [&_.vjs-root]:w-full [&_video]:h-full [&_video]:w-full [&_video]:object-contain"
              >
                <ViewerVideoProvider>
                  <LiveVideoSkin className="vjs-root h-full w-full bg-black">
                    <Video
                      ref={attachPlayerVideo}
                      playsInline
                      preload="auto"
                      className="h-full w-full bg-black object-contain"
                    />
                  </LiveVideoSkin>
                </ViewerVideoProvider>
              </div>

              {/* OSD Status (Host pausing) */}            {scene.player.showWaitingOverlay && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center transition-opacity backdrop-blur-sm pointer-events-none">
                  <div className="flex flex-col items-center gap-5 animate-in zoom-in duration-300">
                    <div className="w-20 h-20 rounded-full bg-white/10 backdrop-blur-xl flex items-center justify-center border border-white/20 shadow-2xl">
                      <Pause className="w-8 h-8 text-white ml-0.5" />
                    </div>
                    <div className="flex items-center gap-3 px-6 py-2.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 shadow-xl">
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                      <span className="text-white font-medium text-lg tracking-wider">
                        {scene.player.waitingText}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {playbackPrompt === "play" &&
                !scene.player.showJoinOverlay &&
                !scene.player.showWaitingOverlay && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/45 backdrop-blur-sm">
                    <button
                      data-testid="viewer-playback-retry"
                      type="button"
                      onClick={retryPlayback}
                      className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-5 py-3 text-sm font-medium text-white shadow-xl transition hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-white/40"
                    >
                      <Radio className="h-4 w-4" />
                      {copy.clickToPlay}
                    </button>
                  </div>
                )}

              {playbackPrompt === "unmute" &&
                !scene.player.showJoinOverlay &&
                !scene.player.showWaitingOverlay && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30 backdrop-blur-[2px]">
                    <button
                      data-testid="viewer-unmute-prompt"
                      type="button"
                      onClick={resumeAudio}
                      className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-5 py-3 text-sm font-medium text-white shadow-xl transition hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-white/40"
                    >
                      <Radio className="h-4 w-4" />
                      {copy.clickToUnmute}
                    </button>
                  </div>
                )}

              {/* Join Overlay */}
              <Dialog open={scene.player.showJoinOverlay}>
                <DialogContent
                  className="sm:max-w-md [&>button]:hidden overflow-hidden rounded-[24px] border-border/50 bg-background/95 dark:bg-zinc-900/95 backdrop-blur-xl shadow-2xl p-8"
                  onInteractOutside={(e) => e.preventDefault()}
                  onEscapeKeyDown={(e) => e.preventDefault()}
                >
                  <DialogHeader className="mb-2">
                    <DialogTitle className="text-xl font-bold tracking-tight">{copy.joinRoomTitle}</DialogTitle>
                    <DialogDescription className="text-sm text-muted-foreground mt-1.5">
                      {copy.joinRoomDescription}
                    </DialogDescription>
                  </DialogHeader>
                  {(scene.notices.error || scene.notices.endedReason) && (
                    <p
                      data-testid="viewer-room-error"
                      className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100"
                    >
                      {scene.notices.error || scene.notices.endedReason}
                    </p>
                  )}
                  <JoinForm
                    initialPassword={initialRoomPassword}
                    initialRoomCode={scene.header.roomId ?? ""}
                    isBusy={scene.player.joinBusy}
                    onJoin={onJoin}
                  />
                </DialogContent>
              </Dialog>

            </div>
          </div>

          {/* Resize Handle */}
          <div
            className={cn(
              "hidden lg:block w-1.5 -mx-1 z-30 cursor-col-resize transition-all hover:bg-blue-500/30 active:bg-blue-500/50",
              isResizing && "bg-blue-500/50 "
            )}
            onMouseDown={startResizing}
          />

          {/* Right Side: Real-time Sidebar */}
          <div
            style={isWebFullscreen ? { width: 0 } : { "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}
            className={cn(
              "flex-1 lg:flex-none bg-zinc-50 dark:bg-zinc-900 flex flex-col shrink-0 border-t lg:border-l lg:border-t-0 border-border relative z-20 w-full lg:w-[var(--sidebar-width)]",
              !isResizing && "transition-[width,transform,opacity] duration-300 ease-in-out",
              isWebFullscreen ? "translate-x-full opacity-0 pointer-events-none" : "translate-x-0 opacity-100"
            )}
          >
            {/* Sidebar Tabs */}
            <div className="flex shrink-0 px-4 pt-3 bg-white/50 dark:bg-zinc-800/50 backdrop-blur-sm border-b border-border gap-6">
              <button
                onClick={() => setActiveTab('chat')}
                className={cn(
                  "px-4 pb-2.5 pt-0 text-sm font-semibold transition-colors border-b-[3px] relative",
                  activeTab === 'chat' ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {copy.tabChat || "Chat"}
              </button>
              <button
                onClick={() => setActiveTab('viewers')}
                className={cn(
                  "px-4 pb-2.5 pt-0 text-sm font-semibold transition-colors border-b-[3px] relative flex items-center gap-2",
                  activeTab === 'viewers' ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {copy.tabRoom || "Viewers"}
                <span className="px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[10px] font-bold">
                  {scene.sidebar.viewerCount}
                </span>
              </button>
            </div>

            <div className="flex-1 overflow-hidden relative flex flex-col">
              {activeTab === 'chat' && (
                <div className="flex-1 flex flex-col min-h-0">
                  <ChatPanel
                    className="flex-1"
                    messages={scene.sidebar.messages.map(msg => ({
                      id: msg.id,
                      sender: msg.senderKind === "self" ? scene.sidebar.username : msg.sender,
                      text: msg.text,
                      time: msg.time
                    }))}
                    currentUsername={scene.sidebar.username}
                    placeholder={copy.messagePlaceholder}
                    systemName="System"
                    onSend={async (text) => {
                      const sent = onSendMessage(text);
                      return sent;
                    }}
                  />
                  <div data-testid="viewer-connection-state" data-status={scene.header.statusText} className="sr-only">
                    {scene.header.statusText}
                  </div>
                </div>
              )}

              {activeTab === 'viewers' && (
                <div className="flex-1 overflow-y-auto p-4 flex flex-col items-center justify-center text-center animate-in fade-in duration-500">
                  <div className="w-16 h-16 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mb-4">
                    <Users className="w-6 h-6 text-muted-foreground/30" />
                  </div>
                  <p className="text-sm font-medium text-muted-foreground">List hidden for privacy</p>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
