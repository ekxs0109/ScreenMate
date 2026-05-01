import { useState, useMemo, useEffect, useRef, ChangeEvent } from "react";
import { useTheme } from "next-themes";
import { createPlayer } from "@videojs/react";
import {
  Video as VideoJsVideo,
  VideoSkin,
  videoFeatures,
} from "@videojs/react/video";
import "@videojs/react/video/skin.css";
import { browser } from "wxt/browser";
import {
  Video,
  Users,
  MessageCircle,
  Hash,
  ExternalLink,
  Copy,
  Trash2,
  Share2,
  ChevronRight,
  Monitor,
  Activity,
  Send,
  Upload,
  X,
  Radio,
  Shuffle,
  LogOut,
  Globe,
  UploadCloud,
  FileVideo,
  Moon,
  Sun,
  MonitorUp,
  MonitorPlay,
  Play,
  Pause,
  Maximize,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { HeaderControls } from "../../components/header-controls";
import { ToastViewport, useToastQueue } from "../../components/toast";
import { readLocalMediaFile, saveLocalMediaFile } from "../../lib/local-media-store";
import type { LocalPlaybackState } from "../background";
import { getExtensionDictionary } from "../popup/i18n";
import { usePopupUiStore } from "../popup/popup-ui-store";
import { usePopupSessionStore } from "../popup/popup-session-store";
import { buildExtensionSceneModel } from "../popup/scene-adapter";
import { useHostControls } from "../popup/useHostControls";
import { ChatPanel } from "../../components/chat-panel";
import { ViewerList } from "../../components/viewer-list";
const cubesPattern = "/patterns/cubes.png";
const RESTORED_PLAYBACK_SYNC_SUPPRESSION_MS = 750;
const LocalVideoJsPlayer = createPlayer({
  features: videoFeatures,
  displayName: "ScreenMateLocalVideoPlayer",
});

function releaseVideoSurface(video: HTMLVideoElement) {
  video.pause?.();
  video.srcObject = null;
  video.removeAttribute("src");
  video.load?.();
}

function getPlayerI18nMessage(key: string, fallback: string) {
  try {
    const message = browser.i18n.getMessage(key as never);
    return message && message !== key ? message : fallback;
  } catch {
    return fallback;
  }
}

function normalizeLocalPlaybackState(value: unknown): LocalPlaybackState | null {
  if (
    !value ||
    typeof value !== "object" ||
    !("status" in value) ||
    value.status !== "local-playback-state" ||
    !("active" in value) ||
    typeof value.active !== "boolean"
  ) {
    return null;
  }

  const candidate = value as Partial<LocalPlaybackState>;
  return {
    status: "local-playback-state",
    active: candidate.active === true,
    currentTime:
      typeof candidate.currentTime === "number" &&
        Number.isFinite(candidate.currentTime)
        ? candidate.currentTime
        : null,
    duration:
      typeof candidate.duration === "number" && Number.isFinite(candidate.duration)
        ? candidate.duration
        : null,
    paused: typeof candidate.paused === "boolean" ? candidate.paused : null,
    playbackRate:
      typeof candidate.playbackRate === "number" &&
        Number.isFinite(candidate.playbackRate)
        ? candidate.playbackRate
        : null,
    sourceLabel:
      typeof candidate.sourceLabel === "string" ? candidate.sourceLabel : null,
  };
}

export default function PlayerApp() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [isHoveringDrop, setIsHoveringDrop] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [activeTab, setActiveTab] = useState<'chat' | 'viewers'>('chat');
  const [language, setLanguage] = useState("en");
  const [isWebFullscreen, setIsWebFullscreen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(360);
  const [isResizing, setIsResizing] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const fileUrlRef = useRef<string | null>(null);
  const lastToastMessageRef = useRef<string | null>(null);
  const attemptedPreparedUploadRestoreRef = useRef<string | null>(null);
  const pendingPlaybackRestoreRef = useRef<LocalPlaybackState | null>(null);
  const playbackSyncSuppressedRef = useRef(false);
  const playbackSyncReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const { dismissToast, pushToast, toasts } = useToastQueue();

  // Removed random username generator and editing
  // const [username, setUsername] = useState("Host");
  // const [isEditingName, setIsEditingName] = useState(false);

  const startResizing = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

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

  const localFile = usePopupUiStore((state) => state.localFile);
  const clearLocalFile = usePopupUiStore((state) => state.clearLocalFile);
  const setLocalFile = usePopupUiStore((state) => state.setLocalFile);
  const setActiveSourceType = usePopupSessionStore((state) => state.setActiveSourceType);
  const messages = usePopupUiStore((state) => state.messages);
  const appendLocalMessage = usePopupUiStore((state) => state.appendLocalMessage);

  const {
    snapshot,
    isBusy,
    busyAction,
    preparedSourceState,
    prepareLocalFileSource,
    sendChatMessage,
    startSharing,
  } = useHostControls();
  const copy = getExtensionDictionary();

  const scene = useMemo(() =>
    buildExtensionSceneModel({
      snapshot,
      videos: [],
      selectedVideoId: null,
      isBusy,
      busyAction,
      viewerRoomUrl: snapshot.roomId ? `${window.location.origin}/viewer?roomId=${snapshot.roomId}` : null,
      mock: {
        ...usePopupUiStore.getState(),
        ...usePopupSessionStore.getState(),
        isRefreshing: false,
      }
    }), [snapshot, isBusy, busyAction, messages]
  );

  const clearPlayerSurface = () => {
    const video = localVideoRef.current;
    if (!video) {
      return;
    }

    releaseVideoSurface(video);
  };

  const releasePlaybackSyncSuppression = () => {
    if (playbackSyncReleaseTimerRef.current) {
      clearTimeout(playbackSyncReleaseTimerRef.current);
      playbackSyncReleaseTimerRef.current = null;
    }
    playbackSyncSuppressedRef.current = false;
  };

  const suppressPlaybackSyncDuringRestore = () => {
    releasePlaybackSyncSuppression();
    playbackSyncSuppressedRef.current = true;
    playbackSyncReleaseTimerRef.current = setTimeout(() => {
      playbackSyncSuppressedRef.current = false;
      playbackSyncReleaseTimerRef.current = null;
    }, RESTORED_PLAYBACK_SYNC_SUPPRESSION_MS);
  };

  const readLocalPlaybackState = async () => {
    try {
      return normalizeLocalPlaybackState(
        await browser.runtime.sendMessage({
          type: "screenmate:get-local-playback-state",
        }),
      );
    } catch {
      return null;
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('video/')) {
      void handleLoadFile(file);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsHoveringDrop(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('video/')) {
      void handleLoadFile(file);
    }
  };

  const handleLoadFile = async (file: File) => {
    pendingPlaybackRestoreRef.current = null;
    releasePlaybackSyncSuppression();
    if (fileUrlRef.current) {
      URL.revokeObjectURL(fileUrlRef.current);
    }
    const url = URL.createObjectURL(file);
    fileUrlRef.current = url;
    setFileUrl(url);
    setActiveSourceType("upload");
    setLocalFile({ name: file.name, size: file.size, type: file.type });
    appendLocalMessage(`已加载本地视频: ${file.name} (Loaded local video)`);

    try {
      const metadata = await saveLocalMediaFile(file);
      setLocalFile({
        name: metadata.name,
        size: metadata.size,
        type: metadata.type,
      });
      const prepared = await prepareLocalFileSource({
        fileId: metadata.id,
        metadata,
      });
      if (prepared.kind === "upload" && prepared.ready) {
        await startSharing("upload", {
          preparedSourceState: prepared,
        });
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Could not prepare the local video.";
      pushToast(message, "error");
    }
  };

  const handleClearFile = () => {
    attemptedPreparedUploadRestoreRef.current =
      preparedSourceState.kind === "upload" && preparedSourceState.ready
        ? preparedSourceState.fileId
        : attemptedPreparedUploadRestoreRef.current;
    pendingPlaybackRestoreRef.current = null;
    releasePlaybackSyncSuppression();
    if (fileUrlRef.current) {
      URL.revokeObjectURL(fileUrlRef.current);
      fileUrlRef.current = null;
    }
    setFileUrl(null);
    clearLocalFile();
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text) return;
    setChatInput("");
    if (snapshot.roomId && snapshot.roomLifecycle !== "closed") {
      void sendChatMessage(text);
      return;
    }

    appendLocalMessage(text);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const toggleTheme = () => {
    const nextTheme = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
    setTheme(nextTheme);
  };

  useEffect(() => {
    const message = snapshot.message;
    if (!message || message === lastToastMessageRef.current) {
      return;
    }

    lastToastMessageRef.current = message;
    pushToast(message, "error");
  }, [pushToast, snapshot.message]);

  useEffect(() => {
    return () => {
      releasePlaybackSyncSuppression();
      clearPlayerSurface();
      if (fileUrlRef.current) {
        URL.revokeObjectURL(fileUrlRef.current);
        fileUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (
      preparedSourceState.kind !== "upload" ||
      !preparedSourceState.ready ||
      fileUrlRef.current ||
      attemptedPreparedUploadRestoreRef.current === preparedSourceState.fileId
    ) {
      return;
    }

    attemptedPreparedUploadRestoreRef.current = preparedSourceState.fileId;
    let isCancelled = false;

    void (async () => {
      const record = await readLocalMediaFile(preparedSourceState.fileId);
      if (!record) {
        return;
      }

      const playbackState = await readLocalPlaybackState();
      const url = URL.createObjectURL(record.blob);
      if (isCancelled || fileUrlRef.current) {
        URL.revokeObjectURL(url);
        return;
      }

      suppressPlaybackSyncDuringRestore();
      pendingPlaybackRestoreRef.current = playbackState;
      fileUrlRef.current = url;
      setFileUrl(url);
      setActiveSourceType("upload");
      setLocalFile({
        name: preparedSourceState.metadata.name,
        size: preparedSourceState.metadata.size,
        type: preparedSourceState.metadata.type,
      });
    })().catch((error) => {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Could not restore the local video preview.";
      pushToast(message, "error");
    });

    return () => {
      isCancelled = true;
    };
  }, [preparedSourceState, pushToast, setActiveSourceType, setLocalFile]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const video = localVideoRef.current;
      setIsWebFullscreen(
        Boolean(video && document.fullscreenElement?.contains(video)),
      );
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    const video = localVideoRef.current;
    if (!fileUrl || !video) {
      return;
    }

    const syncPlayback = (action: "play" | "pause" | "seek") => {
      if (playbackSyncSuppressedRef.current) {
        return;
      }

      void browser.runtime.sendMessage({
        type: "screenmate:sync-local-playback",
        action,
        currentTime: video?.currentTime ?? 0,
      });
    };
    const syncPlaybackRate = () => {
      if (playbackSyncSuppressedRef.current) {
        return;
      }

      void browser.runtime.sendMessage({
        type: "screenmate:sync-local-playback",
        action: "ratechange",
        currentTime: video?.currentTime ?? 0,
        playbackRate: video?.playbackRate ?? 1,
      });
    };
    const handlePlay = () => syncPlayback("play");
    const handlePause = () => syncPlayback("pause");
    const handleSeeked = () => syncPlayback("seek");
    video?.addEventListener("play", handlePlay);
    video?.addEventListener("pause", handlePause);
    video?.addEventListener("seeked", handleSeeked);
    video?.addEventListener("ratechange", syncPlaybackRate);

    const restoredPlaybackState = pendingPlaybackRestoreRef.current;
    pendingPlaybackRestoreRef.current = null;
    if (video && restoredPlaybackState?.active) {
      let didApplyPlaybackIntent = false;
      const applyRestoredPlaybackState = () => {
        if (typeof restoredPlaybackState.currentTime === "number") {
          try {
            video.currentTime = restoredPlaybackState.currentTime;
          } catch {
            // Some media elements reject seeks until metadata is available.
          }
        }

        if (typeof restoredPlaybackState.playbackRate === "number") {
          video.playbackRate = restoredPlaybackState.playbackRate;
        }

        if (didApplyPlaybackIntent) {
          return;
        }
        didApplyPlaybackIntent = true;
        if (restoredPlaybackState.paused === false) {
          void video.play?.().catch(() => undefined);
        } else if (restoredPlaybackState.paused === true) {
          video.pause?.();
        }
      };

      applyRestoredPlaybackState();
      if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
        video.addEventListener("loadedmetadata", applyRestoredPlaybackState, {
          once: true,
        });
      }
    }

    return () => {
      video?.removeEventListener("play", handlePlay);
      video?.removeEventListener("pause", handlePause);
      video?.removeEventListener("seeked", handleSeeked);
      video?.removeEventListener("ratechange", syncPlaybackRate);
      releaseVideoSurface(video);
    };
  }, [fileUrl]);

  return (
    <div className="w-full min-h-screen bg-zinc-100/50 dark:bg-black p-0 sm:p-4 lg:p-6 flex flex-col font-sans transition-colors">
      <div className="flex-1 flex flex-col bg-background dark:bg-zinc-900 text-foreground sm:rounded-xl overflow-hidden shadow-xl ring-1 ring-border/50 relative">
        {/* Header */}
        <header className="h-14 border-b border-border bg-zinc-50/80 dark:bg-zinc-900/80 backdrop-blur-md flex items-center justify-between px-4 lg:px-6 shrink-0 relative z-20 ">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight hidden sm:block">
                {getPlayerI18nMessage("playerTitle", "ScreenMate")}
                <span className="font-normal text-muted-foreground ml-1">
                  {getPlayerI18nMessage("playerSubtitle", "Local Host")}
                </span>
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 lg:gap-3">
            {snapshot.roomId && (
              <div className="hidden sm:flex items-center mr-2 border-r border-border pr-3 gap-2">
                <div className="flex items-center gap-1.5 px-2 py-1 bg-zinc-100 dark:bg-zinc-800/50 rounded-md">
                  <Hash className="w-3.5 h-3.5 text-blue-500" />
                  <span className="text-xs font-mono font-bold tracking-tight text-foreground">{snapshot.roomId}</span>
                </div>
                <button onClick={() => navigator.clipboard.writeText(snapshot.roomId!)} className="p-1.5 text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors border border-transparent hover:border-border flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-tight" title="Copy Room ID">
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <HeaderControls
              language={language}
              onLanguageChange={setLanguage}
              themeMode={theme as "light" | "dark" | "system" || "system"}
              resolvedThemeMode={resolvedTheme as "light" | "dark" || "light"}
              onThemeToggle={toggleTheme}
            />
          </div>
        </header>

        {/* Main Content Floor */}
        <main className="flex-1 overflow-hidden flex flex-col lg:flex-row bg-zinc-50 dark:bg-zinc-900">

          {/* Left Side: Video Player or Upload Zone */}
          <div
            className="flex-1 lg:flex-[2] flex flex-col relative shrink-0 z-10 bg-zinc-100 dark:bg-zinc-800/50 min-h-[40vh] lg:min-h-0"
            onDragOver={(e) => { e.preventDefault(); setIsHoveringDrop(true); }}
            onDragLeave={(e) => { e.preventDefault(); setIsHoveringDrop(false); }}
            onDrop={handleDrop}
          >
            {fileUrl ? (
              <div className="absolute inset-0 w-full h-full flex items-center justify-center group overflow-hidden bg-black">
                <LocalVideoJsPlayer.Provider>
                  <div
                    data-testid="extension-player-video"
                    className="absolute inset-0 h-full w-full outline-none [&_video]:h-full [&_video]:w-full [&_video]:object-contain"
                  >
                    <VideoSkin className="h-full w-full !rounded-none">
                      <VideoJsVideo
                        ref={localVideoRef}
                        key={fileUrl}
                        id="screenmate-player-local-video"
                        src={fileUrl}
                        autoPlay
                        playsInline
                        preload="metadata"
                        className="h-full w-full object-contain"
                      />
                    </VideoSkin>
                  </div>
                </LocalVideoJsPlayer.Provider>

                {/* Custom floating title overlay on hover */}
                <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-600 rounded-lg shadow-lg">
                      <FileVideo className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h2 className="text-white font-medium text-base text-shadow-sm">{localFile?.name}</h2>
                      <p className="text-white/70 text-[10px] mt-0.5">{localFile && formatFileSize(localFile.size)} • {getPlayerI18nMessage("localFileLabel", "Local File")}</p>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleClearFile();
                    }}
                    className="px-3 py-1.5 bg-black/50 hover:bg-black/80 text-white rounded-lg backdrop-blur border border-white/10 text-xs font-medium transition-colors pointer-events-auto"
                  >
                    {getPlayerI18nMessage("changeFile", "Change File")}
                  </button>
                </div>
              </div>
            ) : (
              <div className={`absolute inset-0 flex items-center justify-center transition-colors duration-300 ${isHoveringDrop ? 'bg-blue-50/50 dark:bg-zinc-800/80 border-blue-500' : 'bg-transparent border-zinc-300 dark:border-zinc-700'} border-2 border-dashed m-4 lg:m-6 rounded-2xl`}>
                <div className="flex flex-col items-center max-w-md text-center p-6">
                  <div className={`w-20 h-20 rounded-full flex items-center justify-center mb-6 transition-all duration-300 shadow-sm ${isHoveringDrop ? 'bg-blue-600 scale-110 text-white' : 'bg-white dark:bg-zinc-800 text-zinc-400 border border-border'}`}>
                    <UploadCloud className={`w-10 h-10 ${isHoveringDrop ? 'text-white' : 'text-zinc-500'}`} />
                  </div>
                  <h2 className="text-xl font-bold text-foreground mb-2">{getPlayerI18nMessage("loadLocalVideo", "Load Local Video")}</h2>
                  <p className="text-muted-foreground mb-6 leading-relaxed text-xs">
                    {getPlayerI18nMessage("dropzoneDesc", "Drag and drop your local video file here, or click to browse. The video stays on your browser and is not uploaded to any server.")}
                  </p>

                  <input
                    type="file"
                    accept="video/*"
                    className="hidden"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold shadow-md hover:shadow-blue-600/10 active:scale-95 transition-all text-xs flex items-center gap-2"
                  >
                    <FileVideo className="w-3.5 h-3.5" />
                    {getPlayerI18nMessage("selectVideoFile", "Select Video File")}
                  </button>
                </div>
              </div>
            )}
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
                {getPlayerI18nMessage("chatTab", "Chat")}
              </button>
              <button
                onClick={() => setActiveTab('viewers')}
                className={cn(
                  "px-4 pb-2.5 pt-0 text-sm font-semibold transition-colors border-b-[3px] relative flex items-center gap-2",
                  activeTab === 'viewers' ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {getPlayerI18nMessage("viewersTab", "Viewers")}
                <span className="px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-700 text-[10px] font-bold">
                  {scene.roomTab.viewerDetails.length}
                </span>
              </button>
            </div>

            <div className="flex-1 overflow-hidden relative flex flex-col">
              {activeTab === 'chat' && (
                <ChatPanel
                  messages={scene.chatTab.messages}
                  onSend={async (text) => {
                    if (snapshot.roomId && snapshot.roomLifecycle !== "closed") {
                      await sendChatMessage(text);
                      return true;
                    }
                    appendLocalMessage(text);
                    return true;
                  }}
                  currentUsername="Host"
                  placeholder={getPlayerI18nMessage("chatPlaceholder", "Send a message...")}
                  systemName={getPlayerI18nMessage("chatSystemSender", "System")}
                  className="flex-1"
                />
              )}

              {activeTab === 'viewers' && (
                <ViewerList
                  viewers={scene.roomTab.viewerDetails}
                  className="flex-1"
                />
              )}
            </div>
          </div>
        </main>
      </div>
      <ToastViewport onDismiss={dismissToast} toasts={toasts} />
    </div>
  );
}
