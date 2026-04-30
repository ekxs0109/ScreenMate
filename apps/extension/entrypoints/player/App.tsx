import { useState, useMemo, useEffect, useRef, ChangeEvent } from "react";
import { useTheme } from "next-themes";
import DPlayer from "dplayer";
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
  Maximize
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

const cubesPattern = "/patterns/cubes.png";
const RESTORED_PLAYBACK_SYNC_SUPPRESSION_MS = 750;

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
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<DPlayer | null>(null);
  const fileUrlRef = useRef<string | null>(null);
  const lastToastMessageRef = useRef<string | null>(null);
  const attemptedPreparedUploadRestoreRef = useRef<string | null>(null);
  const pendingPlaybackRestoreRef = useRef<LocalPlaybackState | null>(null);
  const playbackSyncSuppressedRef = useRef(false);
  const playbackSyncReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const { dismissToast, pushToast, toasts } = useToastQueue();

  // Random username generator 
  const [username, setUsername] = useState("Host");
  const [isEditingName, setIsEditingName] = useState(false);

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
    const player = playerRef.current;
    if (!player) {
      return;
    }

    const video =
      player.video ??
      playerContainerRef.current?.querySelector("video") ??
      null;

    if (video) {
      video.pause?.();
      video.srcObject = null;
      video.removeAttribute("src");
      video.load?.();
    }

    player.destroy();
    playerRef.current = null;
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
    clearPlayerSurface();

    const container = playerContainerRef.current;
    if (!fileUrl || !container) {
      return;
    }

    const nextPlayer = new DPlayer({
      autoplay: true,
      container,
      mutex: false,
      video: {
        url: fileUrl,
      },
    });

    playerRef.current = nextPlayer;

    const handleWebFullscreen = () => setIsWebFullscreen(true);
    const handleWebFullscreenCancel = () => setIsWebFullscreen(false);

    nextPlayer.on("webfullscreen", handleWebFullscreen);
    nextPlayer.on("webfullscreen_cancel", handleWebFullscreenCancel);

    const video = nextPlayer.video ?? container.querySelector("video");
    if (video) {
      video.id ||= "screenmate-player-local-video";
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
      if (playerRef.current === nextPlayer) {
        clearPlayerSurface();
      }
    };
  }, [fileUrl]);

  return (
    <div className="w-full min-h-screen bg-zinc-100/50 dark:bg-zinc-950 p-0 sm:p-4 lg:p-6 flex flex-col font-sans transition-colors">
      <div className="flex-1 flex flex-col bg-background text-foreground sm:rounded-xl overflow-hidden shadow-xl ring-1 ring-border/50 relative">
        {/* Header */}
        <header className="h-14 border-b border-border bg-zinc-50/80 dark:bg-zinc-950/80 backdrop-blur-md flex items-center justify-between px-4 lg:px-6 shrink-0 relative z-20 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight hidden sm:block">ScreenMate <span className="font-normal text-muted-foreground ml-1">Local Host</span></h1>
            </div>
          </div>

          <div className="flex items-center gap-2 lg:gap-3">
            {snapshot.roomId && (
              <div className="hidden sm:flex items-center mr-2 border-r border-border pr-3 gap-2">
                <button onClick={() => navigator.clipboard.writeText(snapshot.roomId!)} className="p-1.5 text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors border border-transparent hover:border-border flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-tight">
                  <Copy className="w-3.5 h-3.5" />
                  Copy ID
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
        <main className="flex-1 overflow-hidden flex flex-col lg:flex-row bg-zinc-50 dark:bg-zinc-950">

          {/* Left Side: Video Player or Upload Zone */}
          <div
            className="flex-1 flex flex-col relative shrink-0 z-10 bg-zinc-100 dark:bg-zinc-900/50"
            onDragOver={(e) => { e.preventDefault(); setIsHoveringDrop(true); }}
            onDragLeave={(e) => { e.preventDefault(); setIsHoveringDrop(false); }}
            onDrop={handleDrop}
          >
            {fileUrl ? (
              <div className="absolute inset-0 w-full h-full flex items-center justify-center group overflow-hidden bg-black">
                <div
                  ref={playerContainerRef}
                  data-testid="extension-player-video"
                  className="absolute inset-0 h-full w-full outline-none [&_.dplayer]:h-full [&_.dplayer]:w-full [&_.dplayer-video-wrap]:h-full [&_video]:h-full [&_video]:w-full [&_video]:object-contain"
                />

                {/* Custom floating title overlay on hover */}
                <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-600 rounded-lg shadow-lg">
                      <FileVideo className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h2 className="text-white font-medium text-base text-shadow-sm">{localFile?.name}</h2>
                      <p className="text-white/70 text-[10px] mt-0.5">{localFile && formatFileSize(localFile.size)} • Local File</p>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleClearFile();
                    }}
                    className="px-3 py-1.5 bg-black/50 hover:bg-black/80 text-white rounded-lg backdrop-blur border border-white/10 text-xs font-medium transition-colors pointer-events-auto"
                  >
                    Change File
                  </button>
                </div>
              </div>
            ) : (
              <div className={`absolute inset-0 flex items-center justify-center transition-colors duration-300 ${isHoveringDrop ? 'bg-blue-50/50 dark:bg-zinc-800/80 border-blue-500' : 'bg-transparent border-zinc-300 dark:border-zinc-800'} border-2 border-dashed m-4 lg:m-6 rounded-2xl`}>
                <div className="flex flex-col items-center max-w-md text-center p-6">
                  <div className={`w-20 h-20 rounded-full flex items-center justify-center mb-6 transition-all duration-300 shadow-sm ${isHoveringDrop ? 'bg-blue-600 scale-110 text-white' : 'bg-white dark:bg-zinc-800 text-zinc-400 border border-border'}`}>
                    <UploadCloud className={`w-10 h-10 ${isHoveringDrop ? 'text-white' : 'text-zinc-500'}`} />
                  </div>
                  <h2 className="text-xl font-bold text-foreground mb-2">Load Local Video</h2>
                  <p className="text-muted-foreground mb-6 leading-relaxed text-xs">
                    Drag and drop your local video file here, or click to browse. The video stays on your browser and is not uploaded to any server.
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
                    Select Video File
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Resize Handle */}
          <div
            className={cn(
              "hidden lg:block w-1.5 hover:w-2 -mx-1 z-30 cursor-col-resize transition-all hover:bg-blue-500/30 active:bg-blue-500/50",
              isResizing && "bg-blue-500/50 w-2"
            )}
            onMouseDown={startResizing}
          />

          {/* Right Side: Real-time Sidebar */}
          <div 
            style={{ width: isWebFullscreen ? 0 : sidebarWidth }}
            className={cn(
              "flex-1 lg:flex-none bg-zinc-50 dark:bg-zinc-950 flex flex-col shrink-0 border-l border-border relative z-20", 
              !isResizing && "transition-[width,transform,opacity] duration-300 ease-in-out",
              isWebFullscreen ? "translate-x-full opacity-0 pointer-events-none" : "translate-x-0 opacity-100"
            )}
          >
            {/* Sidebar Tabs */}
            <div className="flex shrink-0 px-4 pt-3 bg-white/50 dark:bg-zinc-900/50 backdrop-blur-sm border-b border-border gap-6">
               <button 
                 onClick={() => setActiveTab('chat')}
                 className={cn(
                   "pb-3 text-xs font-black uppercase tracking-[0.2em] transition-all relative",
                   activeTab === 'chat' ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground hover:text-foreground"
                 )}
               >
                 Chat
                 {activeTab === 'chat' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-current rounded-full" />}
               </button>
               <button 
                 onClick={() => setActiveTab('viewers')}
                 className={cn(
                   "pb-3 text-xs font-black uppercase tracking-[0.2em] transition-all relative flex items-center gap-2",
                   activeTab === 'viewers' ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground hover:text-foreground"
                 )}
               >
                 Viewers
                 <span className="px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[9px] font-bold">
                   {scene.roomTab.viewerDetails.length}
                 </span>
                 {activeTab === 'viewers' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-current rounded-full" />}
               </button>
            </div>

            <div className="flex-1 overflow-hidden relative flex flex-col">
              {activeTab === 'chat' && (
                <>
                  <div className="flex-1 overflow-y-auto p-4 space-y-6 font-sans text-sm pb-10 relative bg-zinc-50 dark:bg-zinc-950 scroll-smooth">
                    {/* Immersive high-end background */}
                    <div className="absolute inset-0 bg-gradient-to-b from-white via-zinc-50/50 to-zinc-100 dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-900 pointer-events-none" />
                    <div className="absolute inset-0 opacity-[0.03] dark:opacity-[0.05] pointer-events-none" style={{ backgroundImage: 'radial-gradient(#000 1px, transparent 0)', backgroundSize: '24px 24px' }} />
                    
                    {scene.chatTab.messages.map((msg, i) => {
                      const isYou = msg.sender === 'You' || msg.sender === username;
                      const isSystem = msg.sender === 'System';
                      const nextMsg = scene.chatTab.messages[i + 1];
                      const isLastInGroup = !nextMsg || nextMsg.sender !== msg.sender;
                      
                      if (isSystem) {
                        return (
                          <div key={msg.id} className="flex justify-center py-2 animate-in fade-in zoom-in-95 duration-500">
                             <span className="text-[10px] font-black text-muted-foreground/40 bg-zinc-200/30 dark:bg-zinc-800/30 px-4 py-1.5 rounded-full uppercase tracking-[0.2em] border border-border/20 backdrop-blur-sm">
                               {msg.text}
                             </span>
                          </div>
                        );
                      }

                      return (
                      <div key={msg.id} className={cn("flex flex-col gap-1 relative z-10 animate-in fade-in slide-in-from-bottom-2 duration-300", isYou ? "items-end" : "items-start")}>
                        {!isYou && (!scene.chatTab.messages[i-1] || scene.chatTab.messages[i-1].sender !== msg.sender) && (
                          <div className="flex items-center gap-2 px-1 mb-1">
                            <span className="text-[10px] font-black text-blue-600/60 dark:text-blue-400/60 uppercase tracking-[0.15em]">
                              {msg.sender}
                            </span>
                          </div>
                        )}
                        
                        <div className={cn(
                          "group relative px-4 py-2.5 max-w-[82%] text-[13px] leading-relaxed transition-all duration-300",
                          isYou 
                            ? "bg-blue-600 text-white rounded-[1.25rem] rounded-tr-none shadow-[0_4px_15px_-3px_rgba(37,99,235,0.4)] hover:shadow-[0_12px_25px_-5px_rgba(37,99,235,0.5)]" 
                            : "bg-white dark:bg-zinc-900 border border-border/40 text-foreground rounded-[1.25rem] rounded-tl-none shadow-[0_4px_15px_-3px_rgba(0,0,0,0.04)] hover:shadow-[0_12px_25px_-5px_rgba(0,0,0,0.08)]"
                        )}>
                          {msg.text}
                          
                          {/* Time tag on hover */}
                          <div className={cn(
                            "absolute bottom-0 opacity-0 group-hover:opacity-100 transition-all duration-300 whitespace-nowrap text-[9px] font-black text-muted-foreground/40 py-1",
                            isYou ? "-left-12 translate-x-2 group-hover:translate-x-0" : "-right-12 -translate-x-2 group-hover:translate-x-0"
                          )}>
                            {new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                          </div>
                        </div>
                        
                        {isLastInGroup && isYou && (
                          <span className="text-[9px] font-black text-blue-600/30 dark:text-blue-400/20 pr-1 mt-1 tracking-widest uppercase italic">
                            Delivered
                          </span>
                        )}
                      </div>
                    )})}
                  </div>

                  {/* Chat Input Area */}
                  <div className="p-4 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md border-t border-border shrink-0">
                    <form onSubmit={handleSendMessage} className="flex flex-col gap-3">
                      <div className="flex items-center justify-between px-1">
                         <div className="text-[9px] font-black text-muted-foreground/40 uppercase tracking-[0.25em] flex items-center gap-2">
                           <div className="size-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                           Session Owner: 
                           <button 
                             type="button"
                             onClick={() => setIsEditingName(true)}
                             className="text-foreground hover:text-blue-600 transition-colors"
                           >
                             {username}
                           </button>
                         </div>
                      </div>
                      
                      {isEditingName && (
                        <div className="absolute inset-x-0 bottom-[90px] p-6 bg-white dark:bg-zinc-900 border-t border-border animate-in slide-in-from-bottom-4 z-30 shadow-2xl">
                           <div className="flex items-center justify-between mb-4">
                             <label className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground">Identity Settings</label>
                             <button onClick={() => setIsEditingName(false)} className="text-muted-foreground hover:text-foreground transition-colors">
                               <X className="size-4" />
                             </button>
                           </div>
                           <input 
                             autoFocus 
                             className="w-full bg-zinc-100 dark:bg-zinc-800 border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all" 
                             value={username} 
                             onChange={e => setUsername(e.target.value)}
                             onBlur={() => setIsEditingName(false)}
                             onKeyDown={e => e.key === 'Enter' && setIsEditingName(false)}
                           />
                        </div>
                      )}
                      
                      <div className="relative group flex items-center gap-2">
                        <input 
                          type="text" 
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          placeholder="Compose your message..."
                          className="flex-1 bg-zinc-100 dark:bg-zinc-800 border-2 border-transparent focus:border-blue-500/20 focus:bg-white dark:focus:bg-zinc-900 rounded-[1.25rem] px-5 py-3 text-[13px] focus:outline-none transition-all font-medium placeholder:text-muted-foreground/40 shadow-inner"
                        />
                        <button 
                          type="submit"
                          disabled={!chatInput.trim()}
                          className="size-12 bg-blue-600 text-white rounded-2xl flex items-center justify-center transition-all hover:bg-blue-700 active:scale-95 shadow-[0_8px_20px_-6px_rgba(37,99,235,0.5)] disabled:opacity-20 disabled:shadow-none shrink-0"
                        >
                          <Send className="size-5" />
                        </button>
                      </div>
                    </form>
                  </div>
                </>
              )}

              {activeTab === 'viewers' && (
                <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4 bg-zinc-50 dark:bg-zinc-950 relative">
                   <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.05),transparent)] pointer-events-none" />
                   
                   <div className="flex items-center justify-between mb-4 relative z-10 px-1">
                     <div className="flex flex-col gap-1">
                       <h3 className="text-[11px] font-black uppercase tracking-[0.25em] text-foreground">Synchronized</h3>
                       <p className="text-[9px] font-bold text-muted-foreground/60 tracking-widest uppercase">Other participants in this room</p>
                     </div>
                     <span className="size-8 flex items-center justify-center rounded-xl bg-blue-600 text-white font-black text-xs shadow-lg shadow-blue-600/20">
                       {scene.roomTab.viewerDetails.length}
                     </span>
                   </div>

                   <div className="flex flex-col gap-3 relative z-10">
                     {scene.roomTab.viewerDetails.map(v => (
                       <div key={v.id} className="group bg-white dark:bg-zinc-900 border border-border/50 rounded-[1.5rem] p-4 shadow-sm flex items-center justify-between transition-all hover:border-blue-500/40 hover:shadow-[0_12px_40px_rgba(0,0,0,0.06)] animate-in fade-in slide-in-from-right-8 duration-700">
                         <div className="flex items-center gap-4">
                           <div className="size-14 rounded-[1.25rem] bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-800 dark:to-zinc-900 border border-border/40 flex items-center justify-center shadow-inner transition-all group-hover:scale-105 group-hover:shadow-lg">
                             <span className="text-lg font-black text-zinc-300 group-hover:text-blue-500 transition-colors">
                               {v.name.charAt(0).toUpperCase()}
                             </span>
                           </div>
                           <div className="flex flex-col gap-1">
                             <span className="text-[15px] font-bold text-foreground group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">{v.name}</span>
                             <div className="flex items-center gap-2">
                               <div className="size-1.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" />
                               <span className="text-[10px] text-muted-foreground/80 font-black uppercase tracking-[0.15em]">{v.connType}</span>
                             </div>
                           </div>
                         </div>
                         <div className="flex flex-col items-end gap-2">
                            <div className={cn(
                              "px-3 py-1 rounded-full border text-[10px] font-black tabular-nums transition-all shadow-sm",
                              v.isGood 
                                ? "bg-green-50 dark:bg-green-900/10 text-green-600 dark:text-green-400 border-green-200 dark:border-green-900/30" 
                                : "bg-amber-50 dark:bg-amber-900/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-900/30"
                            )}>
                              {v.ping}
                            </div>
                            <Activity className="size-3.5 text-blue-500/20 group-hover:text-blue-500/40 transition-colors" />
                         </div>
                       </div>
                     ))}

                     {scene.roomTab.viewerDetails.length === 0 && (
                       <div className="flex flex-col items-center justify-center py-24 text-center animate-in fade-in duration-1000">
                         <div className="size-24 rounded-[2.5rem] bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center mb-8 shadow-inner border border-border/20 group">
                           <Users className="size-10 text-muted-foreground/10 group-hover:text-blue-500/20 transition-all duration-700" />
                         </div>
                         <h4 className="text-base font-black text-foreground uppercase tracking-widest mb-2">No Spectators</h4>
                         <p className="text-xs text-muted-foreground/50 max-w-[200px] leading-relaxed font-medium">
                           You are watching solo. Share your Room ID to invite friends for a shared experience.
                         </p>
                       </div>
                     )}
                   </div>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
      <ToastViewport onDismiss={dismissToast} toasts={toasts} />
    </div>
  );
}
