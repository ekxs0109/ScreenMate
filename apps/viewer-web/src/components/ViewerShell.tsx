import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, LogIn, LogOut, Pause, Radio, Send, Shuffle, Users } from "lucide-react";
import { useTheme } from "next-themes";
import DPlayer from "dplayer";
import { JoinForm } from "./JoinForm";
import type { ViewerSceneModel } from "../viewer-scene-model";
import { cn } from "../lib/utils";
import { HeaderControls } from "./header-controls";
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
}: {
  scene: ViewerSceneModel;
  stream: MediaStream | null;
  onJoin: (roomCode: string, password: string) => Promise<void>;
  onLeaveRoom: () => void;
  onJoinOtherRoom: () => void;
  onRandomizeUsername: () => void;
  onDisplayNameChange: (displayName: string) => void;
  onSendMessage: (text: string) => boolean;
}) {
  const { resolvedTheme, setTheme, theme } = useTheme();
  const { copy, locale, setLocale } = useViewerI18n();
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<DPlayer | null>(null);
  const playerVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(stream);
  const resolutionCleanupRef = useRef<(() => void) | null>(null);
  const playbackAttemptRef = useRef(0);
  const [playbackPrompt, setPlaybackPrompt] = useState<PlaybackPrompt>(null);
  const [videoResolution, setVideoResolution] = useState<string | null>(null);
  const [displayNameDraft, setDisplayNameDraft] = useState(
    scene.sidebar.username,
  );
  const fallbackStreamResolution = getStreamResolution(stream);

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
      clearPlayerVideo(video);
      video.autoplay = true;
      video.playsInline = true;

      if (!nextStream) {
        viewerPlayerLogger.debug("Viewer stream cleared.");
        return;
      }

      video.srcObject = nextStream;
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
        playerRef.current?.video ??
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
      playerRef.current?.video ??
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
      playerRef.current?.video ??
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

  useEffect(() => {
    const container = playerContainerRef.current;
    if (!container || playerRef.current) {
      return;
    }

    const nextPlayer = new DPlayer({
      autoplay: true,
      container,
      live: true,
      mutex: false,
      video: {
        url: "about:blank",
        type: "webrtc-stream",
        customType: {
          "webrtc-stream": (video) => {
            playerVideoRef.current = video;
            bindStreamToVideo(video, streamRef.current);
          },
        },
      },
    });

    viewerPlayerLogger.info("Created viewer DPlayer instance.", {
      hasInitialStream: Boolean(streamRef.current),
    });
    playerRef.current = nextPlayer;
    if (nextPlayer.video) {
      playerVideoRef.current = nextPlayer.video;
      bindStreamToVideo(nextPlayer.video, streamRef.current);
    }

    return () => {
      const video =
        playerVideoRef.current ??
        nextPlayer.video ??
        container.querySelector("video") ??
        null;

      if (video) {
        clearPlayerVideo(video);
      }

      nextPlayer.destroy();
      viewerPlayerLogger.info("Destroyed viewer DPlayer instance.");
      if (playerRef.current === nextPlayer) {
        playerRef.current = null;
      }
      playerVideoRef.current = null;
    };
  }, [bindStreamToVideo, clearPlayerVideo]);

  const handleThemeToggle = useCallback(() => {
    const nextTheme = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
    setTheme(nextTheme);
  }, [theme, setTheme]);

  return (
    <div className="w-full min-h-screen bg-zinc-200/50 dark:bg-zinc-950 p-0 sm:p-4 lg:p-8 flex flex-col font-sans transition-colors">
      <div className="flex-1 flex flex-col bg-background text-foreground sm:rounded-[2rem] overflow-hidden shadow-2xl ring-1 ring-border/50 relative">
      {/* Header */}
      <header className="h-[72px] border-b border-border bg-zinc-50/80 dark:bg-zinc-950/80 backdrop-blur-md flex items-center justify-between px-4 lg:px-8 shrink-0 relative z-20 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight hidden sm:block">{scene.header.title || 'ScreenMate'}</h1>
            <span className="ml-2 px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 border border-red-200 dark:border-red-900/50 shadow-sm uppercase tracking-wider">{copy.liveBadge}</span>
          </div>
          
          {/* Connection Status Indicator in Header */}
          <div className="hidden md:flex items-center gap-4 px-4 py-1.5 bg-zinc-100 dark:bg-zinc-900 border border-border rounded-full text-xs font-medium ml-4 tracking-wide shadow-inner">
             <div className="flex items-center gap-1.5 text-muted-foreground">
                <Radio className="w-3.5 h-3.5 text-green-500" />
                {copy.connectionLabel}: <span className="text-foreground">{scene.connection.typeLabel}</span>
             </div>
             <div className="w-px h-3 bg-border" />
             <div className="flex items-center gap-1.5 text-muted-foreground">
                <Activity className="w-3.5 h-3.5 text-green-500" />
                {copy.pingLabel}: <span className="text-green-600 dark:text-green-400">{scene.connection.pingLabel}</span>
             </div>
          </div>
        </div>

        <div className="flex items-center gap-2 lg:gap-3">
          
          {/* Room Controls Group */}
          <div className="flex items-center mr-2 border-r border-border pr-3 gap-2">
             <button onClick={onJoinOtherRoom} className="hidden sm:flex p-2 text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors border border-transparent hover:border-border text-xs font-medium items-center gap-1.5">
               <LogIn className="w-4 h-4" />
               <span className="hidden sm:inline">{copy.joinOtherRoom}</span>
             </button>
             <button onClick={onLeaveRoom} className="hidden sm:flex p-2 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40 rounded-lg transition-colors border border-transparent hover:border-red-200 dark:hover:border-red-900/50 text-xs font-medium items-center gap-1.5">
               <LogOut className="w-4 h-4" />
               <span className="hidden sm:inline">{copy.leaveRoom}</span>
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
      <main className="flex-1 overflow-hidden flex flex-col lg:flex-row bg-zinc-50 dark:bg-zinc-950">
        
        {/* Left Side: Video Player */}
        <div className="w-full lg:flex-[3] aspect-video lg:aspect-auto flex flex-col relative shrink-0 z-10 bg-black lg:border-r border-border/10">
          <div className="absolute inset-0 w-full h-full flex items-center justify-center group overflow-hidden bg-black">
            <div
              data-testid="viewer-video"
              ref={playerContainerRef}
              className="absolute inset-0 h-full w-full outline-none [&_.dplayer]:h-full [&_.dplayer]:w-full [&_.dplayer-video-wrap]:h-full [&_video]:h-full [&_video]:w-full [&_video]:object-contain"
            />

            {(videoResolution ?? fallbackStreamResolution) && !scene.player.showJoinOverlay && (
              <div
                data-testid="viewer-resolution"
                className="absolute right-4 top-4 z-10 rounded-full border border-white/10 bg-black/55 px-3 py-1 text-xs font-medium text-white shadow-lg backdrop-blur-md"
              >
                {videoResolution ?? fallbackStreamResolution}
              </div>
            )}
            
            {/* OSD Status (Host pausing) */}
            {scene.player.showWaitingOverlay && (
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
            <Dialog open={scene.player.showJoinOverlay} modal={false}>
              <DialogContent 
                className="sm:max-w-md [&>button]:hidden" 
                onInteractOutside={(e) => e.preventDefault()} 
                onEscapeKeyDown={(e) => e.preventDefault()}
              >
                <DialogHeader>
                  <DialogTitle>{copy.joinRoomTitle}</DialogTitle>
                  <DialogDescription>
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
                  initialRoomCode={scene.header.roomId ?? ""}
                  isBusy={scene.player.joinBusy}
                  onJoin={onJoin}
                />
              </DialogContent>
            </Dialog>

          </div>
        </div>

        {/* Right Side: Real-time Sidebar */}
        <div className="flex-1 lg:flex-none lg:w-[400px] bg-card flex flex-col shrink-0 shadow-[-10px_0_30px_rgba(0,0,0,0.05)] relative z-20">
          <div className="p-4 border-b border-border bg-zinc-50/80 dark:bg-zinc-900/80 flex flex-col gap-3 shrink-0">
             <div className="flex items-center justify-between">
               <h2 className="font-semibold text-[15px]">{copy.syncStatus}</h2>
             <div data-testid="viewer-viewer-count" className="flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 font-medium bg-blue-50 dark:bg-blue-900/30 px-2 py-1 rounded-md border border-blue-100 dark:border-blue-800/50">
                 <Users className="w-4 h-4" />
                 {copy.viewingCount(scene.sidebar.viewerCount)}
               </div>
             </div>

             {/* Mobile Connection info fallback */}
             <div className="flex md:hidden items-center justify-between gap-4 px-3 py-2 bg-white dark:bg-zinc-950 border border-border rounded-lg text-xs font-medium">
               <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Radio className="w-3.5 h-3.5 text-green-500" />
                  {copy.connectionLabel}: <span className="text-foreground">{scene.connection.typeLabel}</span>
               </div>
               <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Activity className="w-3.5 h-3.5 text-green-500" />
                  {copy.pingLabel}: <span className="text-green-600 dark:text-green-400">{scene.connection.pingLabel}</span>
               </div>
             </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 font-sans text-sm pb-10 xl:pb-4 relative bg-[url('/patterns/cubes.png')] dark:bg-zinc-950/50">
            {scene.sidebar.messages.map(msg => (
              <div key={msg.id} data-testid={`viewer-chat-message-${msg.id}`} className="flex flex-col gap-1">
                <div className="flex items-baseline gap-2">
                  <span className={cn(
                    "font-medium", 
                    msg.senderKind === "system" ? "text-gray-500 text-xs" : 
                    msg.senderKind === "host" ? "text-red-500" : 
                    msg.senderKind === "self" ? "text-blue-500 hidden" : "text-zinc-700 dark:text-zinc-300"
                  )}>
                    {msg.senderKind === "self" ? "" : msg.sender}
                  </span>
                  <span className={cn("text-[10px] text-muted-foreground", msg.senderKind === "self" && "hidden")}>{msg.time}</span>
                </div>
                <span className={cn(
                  "px-3 py-2 w-max max-w-[85%] leading-relaxed shadow-sm",
                  msg.senderKind === "system" ? "bg-transparent italic text-gray-500 px-0 py-0 shadow-none border-none" :
                  msg.senderKind === "host" ? "bg-red-50 dark:bg-red-950/40 text-red-950 dark:text-red-200 border border-red-100 dark:border-red-900/50 rounded-2xl rounded-tl-sm" :
                  msg.senderKind === "self" ? "bg-blue-600 text-white rounded-2xl rounded-tr-sm self-end" : "bg-white dark:bg-zinc-800 border-border border rounded-2xl rounded-tl-sm"
                )}>
                  {msg.text}
                </span>
                {msg.senderKind === "self" && <span className="text-[10px] text-muted-foreground self-end pr-1 mt-0.5">{msg.time}</span>}
              </div>
            ))}
          </div>

          {/* Chat Input & Identity Area */}
          <div className="p-3 border-t border-border bg-card flex flex-col gap-2">
            <div className="flex items-center justify-between px-1">
               <div className="flex min-w-0 flex-1 items-center gap-1.5 pr-2">
                 <input
                   data-testid="viewer-display-name-input"
                   aria-label={copy.nameLabel}
                   maxLength={80}
                   value={displayNameDraft}
                   onBlur={(event) => commitDisplayNameDraft(event.currentTarget.value)}
                   onChange={(event) => setDisplayNameDraft(event.currentTarget.value)}
                   onKeyDown={(event) => {
                     if (event.key === "Enter") {
                       event.preventDefault();
                       event.currentTarget.blur();
                     }
                   }}
                   className="h-7 min-w-0 max-w-[190px] rounded-md border border-border bg-white px-2 text-xs font-medium text-foreground shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 dark:bg-zinc-950"
                 />
               </div>
               <button onClick={onRandomizeUsername} className="text-[10px] text-blue-600 dark:text-blue-400 font-medium flex items-center gap-1 hover:text-blue-700 transition">
                  <Shuffle className="w-3 h-3" />
                  {copy.randomizeName}
               </button>
            </div>
            <form onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                const text = String(fd.get("message") || "").trim();
                if (text) {
                  const sent = onSendMessage(text);
                  if (sent) {
                    e.currentTarget.reset();
                  }
                }
              }} 
              className="flex items-center gap-2 relative shadow-sm rounded-full bg-white dark:bg-zinc-900 border border-border focus-within:ring-2 focus-within:ring-blue-500/50 focus-within:border-blue-500 transition-all p-1 pl-4"
            >
              <input 
                data-testid="viewer-chat-input"
                name="message"
                maxLength={500}
                type="text" 
                placeholder={copy.messagePlaceholder}
                className="w-full bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground"
              />
              <button 
                data-testid="viewer-chat-send"
                type="submit"
                className="w-8 h-8 flex items-center justify-center rounded-full bg-blue-600 text-white transition-colors shrink-0"
              >
                <Send className="w-3.5 h-3.5 -ml-0.5" />
              </button>
            </form>
            <div data-testid="viewer-connection-state" data-status={scene.header.statusText} className="sr-only">
              {scene.header.statusText}
            </div>
          </div>
        </div>
      </main>
      </div>
    </div>
  );
}
