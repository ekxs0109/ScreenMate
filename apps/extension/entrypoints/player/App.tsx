import { useState, useMemo, useEffect, useRef, ChangeEvent } from "react";
import { useTheme } from "next-themes";
import DPlayer from "dplayer";
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
import { getExtensionDictionary } from "../popup/i18n";
import { usePopupUiStore } from "../popup/popup-ui-store";
import { buildExtensionSceneModel } from "../popup/scene-adapter";
import { useHostControls } from "../popup/useHostControls";

const cubesPattern = "/patterns/cubes.png";

export default function PlayerApp() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [isHoveringDrop, setIsHoveringDrop] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [activeTab, setActiveTab] = useState<'chat' | 'viewers'>('chat');
  const [language, setLanguage] = useState("en");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<DPlayer | null>(null);
  const fileUrlRef = useRef<string | null>(null);
  
  // Random username generator 
  const [username, setUsername] = useState("Host");
  const [isEditingName, setIsEditingName] = useState(false);

  const localFile = usePopupUiStore((state) => state.localFile);
  const clearLocalFile = usePopupUiStore((state) => state.clearLocalFile);
  const setLocalFile = usePopupUiStore((state) => state.setLocalFile);
  const messages = usePopupUiStore((state) => state.messages);
  const appendLocalMessage = usePopupUiStore((state) => state.appendLocalMessage);

  const { snapshot, isBusy, busyAction } = useHostControls();
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
        isRefreshing: false,
      }
    }), [snapshot, isBusy, busyAction]
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

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('video/')) {
      handleLoadFile(file);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsHoveringDrop(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('video/')) {
      handleLoadFile(file);
    }
  };

  const handleLoadFile = (file: File) => {
    if (fileUrlRef.current) {
      URL.revokeObjectURL(fileUrlRef.current);
    }
    const url = URL.createObjectURL(file);
    fileUrlRef.current = url;
    setFileUrl(url);
    setLocalFile({ name: file.name, size: file.size, type: file.type });
    appendLocalMessage(`已加载本地视频: ${file.name} (Loaded local video)`);
  };

  const handleClearFile = () => {
    if (fileUrlRef.current) {
      URL.revokeObjectURL(fileUrlRef.current);
      fileUrlRef.current = null;
    }
    setFileUrl(null);
    clearLocalFile();
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    appendLocalMessage(chatInput.trim());
    setChatInput("");
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
    return () => {
      clearPlayerSurface();
      if (fileUrlRef.current) {
        URL.revokeObjectURL(fileUrlRef.current);
        fileUrlRef.current = null;
      }
    };
  }, []);

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

    return () => {
      if (playerRef.current === nextPlayer) {
        clearPlayerSurface();
      }
    };
  }, [fileUrl]);

  return (
    <div className="w-full min-h-screen bg-zinc-200/50 dark:bg-zinc-950 p-0 sm:p-4 lg:p-8 flex flex-col font-sans transition-colors">
      <div className="flex-1 flex flex-col bg-background text-foreground sm:rounded-[2rem] overflow-hidden shadow-2xl ring-1 ring-border/50 relative">
      {/* Header */}
      <header className="h-[72px] border-b border-border bg-zinc-50/80 dark:bg-zinc-950/80 backdrop-blur-md flex items-center justify-between px-4 lg:px-8 shrink-0 relative z-20 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight hidden sm:block">ScreenMate <span className="font-normal text-muted-foreground ml-1">Local Host</span></h1>
            <span className="ml-2 px-2 py-0.5 rounded text-xs font-bold bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400 border border-green-200 dark:border-green-900/50 shadow-sm uppercase tracking-wider">Host</span>
          </div>
        </div>

        <div className="flex items-center gap-2 lg:gap-3">
          {snapshot.roomId && (
            <div className="hidden sm:flex items-center mr-2 border-r border-border pr-3 gap-2">
              <button onClick={() => navigator.clipboard.writeText(snapshot.roomId!)} className="p-2 text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors border border-transparent hover:border-border flex items-center gap-1.5 text-xs font-bold uppercase tracking-tight">
                <Copy className="w-4 h-4" />
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
          className="w-full lg:flex-[3] flex flex-col relative shrink-0 z-10 bg-zinc-100 dark:bg-zinc-900/50 lg:border-r border-border"
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
              <div className="absolute top-0 left-0 right-0 p-6 bg-gradient-to-b from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-600 rounded-lg shadow-lg">
                    <FileVideo className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-white font-medium text-lg text-shadow-sm">{localFile?.name}</h2>
                    <p className="text-white/70 text-xs mt-0.5">{localFile && formatFileSize(localFile.size)} • Local File</p>
                  </div>
                </div>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClearFile();
                  }}
                  className="px-4 py-2 bg-black/50 hover:bg-black/80 text-white rounded-lg backdrop-blur border border-white/10 text-sm font-medium transition-colors pointer-events-auto"
                >
                  Change File
                </button>
              </div>
            </div>
          ) : (
            <div className={`absolute inset-0 flex items-center justify-center transition-colors duration-300 ${isHoveringDrop ? 'bg-blue-50/50 dark:bg-zinc-800/80 border-blue-500' : 'bg-transparent border-zinc-300 dark:border-zinc-800'} border-2 border-dashed m-4 lg:m-8 rounded-3xl`}>
               <div className="flex flex-col items-center max-w-md text-center p-8">
                 <div className={`w-24 h-24 rounded-full flex items-center justify-center mb-6 transition-all duration-300 shadow-sm ${isHoveringDrop ? 'bg-blue-600 scale-110 text-white' : 'bg-white dark:bg-zinc-800 text-zinc-400 border border-border'}`}>
                   <UploadCloud className={`w-12 h-12 ${isHoveringDrop ? 'text-white' : 'text-zinc-500'}`} />
                 </div>
                 <h2 className="text-2xl font-bold text-foreground mb-3">Load Local Video</h2>
                 <p className="text-muted-foreground mb-8 leading-relaxed text-sm">
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
                   className="px-8 py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold shadow-lg hover:shadow-blue-600/20 active:scale-95 transition-all text-sm flex items-center gap-2"
                 >
                   <FileVideo className="w-4 h-4" />
                   Select Video File
                 </button>
               </div>
            </div>
          )}
        </div>

        {/* Right Side: Real-time Sidebar */}
        <div className="flex-1 lg:flex-none lg:w-[400px] bg-card flex flex-col shrink-0 shadow-[-10px_0_30px_rgba(0,0,0,0.05)] relative z-20">
          <div className="flex shrink-0 px-3 pt-3 bg-zinc-50/80 dark:bg-zinc-950/80 border-b border-border gap-3">
             <button 
               onClick={() => setActiveTab('chat')}
               className={cn(
                 "px-4 pb-2.5 text-sm font-semibold border-b-[3px] transition-all",
                 activeTab === 'chat' ? "border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400" : "border-transparent text-muted-foreground hover:text-foreground"
               )}
             >
               Chat
             </button>
             <button 
               onClick={() => setActiveTab('viewers')}
               className={cn(
                 "px-4 pb-2.5 text-sm font-semibold border-b-[3px] transition-all flex items-center gap-2",
                 activeTab === 'viewers' ? "border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400" : "border-transparent text-muted-foreground hover:text-foreground"
               )}
             >
               Viewers
               <span className="px-2 py-0.5 rounded-full bg-blue-100/80 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-[10px] font-bold border border-blue-200 dark:border-blue-800/30">
                 {scene.roomTab.viewerDetails.length + 1}
               </span>
             </button>
          </div>

          <div className="flex-1 overflow-hidden relative flex flex-col">
            {activeTab === 'chat' && (
              <>
                <div className="flex-1 overflow-y-auto p-4 space-y-4 font-sans text-sm pb-10 xl:pb-4 relative bg-[url('/patterns/cubes.png')] dark:bg-zinc-950/50">
                  {messages.map(msg => {
                    const isYou = msg.sender === 'You' || msg.sender === username;
                    const isSystem = msg.sender === 'System';
                    
                    return (
                    <div key={msg.id} className="flex flex-col gap-1">
                      <div className="flex items-baseline gap-2">
                        <span className={cn(
                          "font-medium", 
                          isSystem ? "text-gray-500 text-xs" : 
                          isYou ? "text-blue-500 hidden" : "text-zinc-700 dark:text-zinc-300"
                        )}>
                          {isYou ? "" : msg.sender}
                        </span>
                        <span className={cn("text-[10px] text-muted-foreground", isYou && "hidden")}>{new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                      </div>
                      <span className={cn(
                        "px-3 py-2 w-max max-w-[85%] leading-relaxed shadow-sm",
                        isSystem ? "bg-transparent italic text-gray-500 px-0 py-0 shadow-none border-none" :
                        isYou ? "bg-blue-600 text-white rounded-2xl rounded-tr-sm self-end" : "bg-white dark:bg-zinc-800 border-border border rounded-2xl rounded-tl-sm"
                      )}>
                        {msg.text}
                      </span>
                      {isYou && <span className="text-[10px] text-muted-foreground self-end pr-1 mt-0.5">{new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>}
                    </div>
                  )})}
                </div>

                {/* Chat Input & Identity Area */}
                <div className="p-3 border-t border-border bg-card flex flex-col gap-2 shrink-0">
                  <div className="flex items-center justify-between px-1">
                     <div className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
                       Name:
                       {isEditingName ? (
                         <input 
                           autoFocus 
                           className="bg-transparent text-foreground border-b border-blue-500 focus:outline-none px-1" 
                           value={username} 
                           onChange={e => setUsername(e.target.value)}
                           onBlur={() => setIsEditingName(false)}
                           onKeyDown={e => e.key === 'Enter' && setIsEditingName(false)}
                         />
                       ) : (
                         <span className="text-foreground">{username}</span>
                       )}
                     </div>
                     {!isEditingName && (
                       <button onClick={() => setIsEditingName(true)} className="text-[10px] text-blue-600 dark:text-blue-400 font-medium flex items-center gap-1 hover:text-blue-700 transition">
                          Edit
                       </button>
                     )}
                  </div>
                  <form onSubmit={handleSendMessage} className="flex items-center gap-2 relative shadow-sm rounded-full bg-white dark:bg-zinc-900 border border-border focus-within:ring-2 focus-within:ring-blue-500/50 focus-within:border-blue-500 transition-all p-1 pl-4">
                    <input 
                      type="text" 
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Send a message..."
                      className="w-full bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground"
                    />
                    <button 
                      type="submit"
                      disabled={!chatInput.trim()}
                      className="w-8 h-8 flex items-center justify-center rounded-full bg-blue-600 text-white disabled:bg-zinc-100 disabled:text-zinc-400 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-600 transition-colors shrink-0"
                    >
                      <Send className="w-3.5 h-3.5 -ml-0.5" />
                    </button>
                  </form>
                </div>
              </>
            )}

            {activeTab === 'viewers' && (
              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 bg-zinc-50/30 dark:bg-zinc-950/30">
                 <div className="bg-white dark:bg-zinc-900 border border-border rounded-xl shadow-sm text-sm overflow-hidden flex flex-col">
                   <div className="flex flex-col">
                     {/* Header Row for Viewers */}
                     <div className="grid grid-cols-[1fr_70px_50px] gap-2 px-3 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider items-center border-b border-border/50 bg-zinc-50 dark:bg-zinc-900/30">
                       <span>Name</span>
                       <span className="text-center">Conn</span>
                       <span className="text-right flex items-center justify-end gap-1"><Activity className="w-2.5 h-2.5"/> Ping</span>
                     </div>
                     
                     {/* Rows */}
                     <div className="divide-y divide-border/50">
                       <div className="grid grid-cols-[1fr_70px_50px] gap-2 px-3 py-2.5 items-center hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                         <div className="font-bold text-xs flex items-center gap-2 min-w-0 pr-1">
                           <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                           <span className="truncate">{username} (You)</span>
                         </div>
                         <div className="flex justify-center">
                           <span className="text-[9px] font-bold text-muted-foreground bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded-md border border-border whitespace-nowrap">
                             Local
                           </span>
                         </div>
                         <div className="font-mono font-bold text-[11px] text-right text-green-600 dark:text-green-400">
                           0ms
                         </div>
                       </div>

                       {scene.roomTab.viewerDetails.map(v => (
                         <div key={v.id} className="grid grid-cols-[1fr_70px_50px] gap-2 px-3 py-2.5 items-center hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                           <div className="font-bold text-xs flex items-center gap-2 min-w-0 pr-1">
                             <div className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                             <span className="truncate">{v.name}</span>
                           </div>
                           <div className="flex justify-center">
                             <span className="text-[9px] font-bold text-muted-foreground bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded-md border border-border whitespace-nowrap">
                               {v.connType}
                             </span>
                           </div>
                           <div className={cn("font-mono font-bold text-[11px] text-right", v.isGood ? "text-green-600 dark:text-green-400" : "text-amber-500")}>
                             {v.ping}
                           </div>
                         </div>
                       ))}
                     </div>
                   </div>
                 </div>
              </div>
            )}
          </div>
        </div>
      </main>
      </div>
    </div>
  );
}
