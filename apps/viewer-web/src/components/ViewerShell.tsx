import { useCallback, useEffect, useRef } from "react";
import { Activity, Globe, LogIn, LogOut, Maximize, MonitorPlay, Pause, Play, Radio, Send, Shuffle, Users, MonitorUp } from "lucide-react";
import { useTheme } from "next-themes";
import { JoinForm } from "./JoinForm";
import type { ViewerSceneModel } from "../viewer-scene-model";
import { cn } from "../lib/utils";

export function ViewerShell({
  scene,
  stream,
  language,
  onLanguageChange,
  onJoin,
  onLeaveRoom,
  onJoinOtherRoom,
  onRandomizeUsername,
  onSendMessage,
}: {
  scene: ViewerSceneModel;
  stream: MediaStream | null;
  language: string;
  onLanguageChange: (language: string) => void;
  onJoin: (roomCode: string) => Promise<void>;
  onLeaveRoom: () => void;
  onJoinOtherRoom: () => void;
  onRandomizeUsername: () => void;
  onSendMessage: (text: string) => void;
}) {
  const { resolvedTheme, setTheme } = useTheme();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    video.srcObject = stream;
    if (!stream) {
      return;
    }

    video.muted = true;
    void video.play().then(() => {
      video.muted = false;
    }).catch(() => {});
  }, [stream]);

  const handleThemeToggle = useCallback(() => {
    const nextTheme =
      resolvedTheme === "dark" ? "light" : resolvedTheme === "light" ? "system" : "dark";
    setTheme(nextTheme);
  }, [resolvedTheme, setTheme]);

  return (
    <div className="min-h-screen bg-zinc-200/50 dark:bg-[#000000] p-0 sm:p-4 lg:p-8 flex flex-col font-sans transition-colors">
      <div className="flex-1 flex flex-col bg-background text-foreground sm:rounded-[2rem] overflow-hidden shadow-2xl ring-1 ring-border/50 relative">
        <header className="h-[72px] border-b border-border bg-zinc-50/80 dark:bg-zinc-950/80 backdrop-blur-md flex items-center justify-between px-4 lg:px-8 shrink-0 relative z-20 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight hidden sm:block">{scene.header.title}</h1>
              <span className="ml-2 px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 border border-red-200 dark:border-red-900/50 shadow-sm uppercase tracking-wider">
                Live
              </span>
            </div>
            <div className="hidden md:flex items-center gap-4 px-4 py-1.5 bg-zinc-100 dark:bg-zinc-900 border border-border rounded-full text-xs font-medium ml-4 tracking-wide shadow-inner">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Radio className="w-3.5 h-3.5 text-green-500" />
                Method: <span className="text-foreground">{scene.connection.typeLabel}</span>
              </div>
              <div className="w-px h-3 bg-border" />
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Activity className="w-3.5 h-3.5 text-green-500" />
                Ping: <span className="text-green-600 dark:text-green-400">{scene.connection.pingLabel}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 lg:gap-3">
            <div className="flex items-center mr-2 border-r border-border pr-3">
              <button onClick={onJoinOtherRoom} className="hidden sm:flex p-2 text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors border border-transparent hover:border-border text-xs font-medium items-center gap-1.5" type="button">
                <LogIn className="w-4 h-4" />
                Join Other
              </button>
              <button onClick={onLeaveRoom} className="p-2 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40 rounded-lg transition-colors border border-transparent hover:border-red-200 dark:hover:border-red-900/50 text-xs font-medium flex items-center gap-1.5" type="button">
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">Leave Room</span>
              </button>
            </div>

            <div className="flex items-center gap-1.5 p-1 rounded-lg border border-border bg-white dark:bg-zinc-900 shadow-sm overflow-hidden">
              <Globe className="w-3.5 h-3.5 text-muted-foreground ml-1.5 shrink-0" />
              <select
                className="bg-transparent text-xs font-medium cursor-pointer focus:outline-none appearance-none text-muted-foreground hover:text-foreground w-[56px]"
                value={language}
                onChange={(event) => onLanguageChange(event.target.value)}
              >
                <option value="zh">中文</option>
                <option value="en">English</option>
                <option value="ja">日本語</option>
                <option value="es">Español</option>
              </select>
            </div>

            <button onClick={handleThemeToggle} className="p-2 text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors border border-transparent hover:border-border shadow-sm flex items-center justify-center" type="button">
              <MonitorUp className="w-4 h-4" />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-hidden flex flex-col lg:flex-row bg-[#080808]">
          <div className="w-full lg:flex-[3] aspect-video lg:aspect-auto flex flex-col relative shrink-0 z-10 bg-black lg:border-r border-border/10">
            <div className="absolute inset-0 w-full h-full flex items-center justify-center group overflow-hidden bg-black">
              <video
                ref={videoRef}
                className="absolute inset-0 w-full h-full object-contain outline-none"
                controls={false}
                playsInline
              />

              {scene.player.showWaitingOverlay && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center transition-opacity backdrop-blur-sm">
                  <div className="flex flex-col items-center gap-5">
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

              {scene.player.showJoinOverlay && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm p-6">
                  <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-black/60 p-6 shadow-2xl">
                    <h2 className="text-xl font-bold text-white mb-2">Join Room</h2>
                    <p className="text-sm text-zinc-300 mb-4">Enter the room code shared by the host.</p>
                    <JoinForm isBusy={scene.player.joinBusy} onJoin={onJoin} />
                  </div>
                </div>
              )}

              <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-3">
                <div className="w-full h-1.5 bg-white/20 rounded-full overflow-hidden backdrop-blur cursor-not-allowed">
                  <div className="h-full bg-blue-500 w-[30%] shadow-[0_0_10px_rgba(59,130,246,0.8)]" />
                </div>
                <div className="flex items-center justify-between text-white">
                  <div className="flex items-center gap-6">
                    <button className="hover:text-blue-400 transition cursor-not-allowed opacity-60 flex items-center gap-2" type="button">
                      {stream ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                    </button>
                    <span className="text-[10px] border border-white/30 text-white/90 bg-black/30 px-2 py-1 rounded backdrop-blur uppercase tracking-widest font-semibold flex items-center gap-1.5">
                      <MonitorPlay className="w-3 h-3" />
                      HOST CONTROLLED
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-xs font-mono opacity-80">14:23 / 1:30:10</span>
                    <button className="hover:text-blue-400 transition cursor-not-allowed opacity-80" type="button">
                      <Maximize className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex-1 lg:flex-none lg:w-[400px] bg-card flex flex-col shrink-0 shadow-[-10px_0_30px_rgba(0,0,0,0.05)] relative z-20">
            <div className="p-4 border-b border-border bg-zinc-50/80 dark:bg-zinc-900/80 flex flex-col gap-3 shrink-0">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-[15px]">Sync Status</h2>
                <div className="flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 font-medium bg-blue-50 dark:bg-blue-900/30 px-2 py-1 rounded-md border border-blue-100 dark:border-blue-800/50">
                  <Users className="w-4 h-4" />
                  {scene.sidebar.viewerCount} viewing
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 font-sans text-sm pb-10 xl:pb-4 relative bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] dark:bg-none">
              {scene.sidebar.messages.map((message) => (
                <div key={message.id} className="flex flex-col gap-1">
                  <div className="flex items-baseline gap-2">
                    <span className={cn("font-medium", message.sender === "System" ? "text-gray-500 text-xs" : message.sender === "Host" ? "text-red-500" : message.sender === "You" ? "text-blue-500 hidden" : "text-zinc-700 dark:text-zinc-300")}>
                      {message.sender === "You" ? "" : message.sender}
                    </span>
                    <span className={cn("text-[10px] text-muted-foreground", message.sender === "You" && "hidden")}>
                      {message.time}
                    </span>
                  </div>
                  <span className={cn("px-3 py-2 w-max max-w-[85%] leading-relaxed shadow-sm", message.sender === "System" ? "bg-transparent italic text-gray-500 px-0 py-0 shadow-none border-none" : message.sender === "Host" ? "bg-red-50 dark:bg-red-950/40 text-red-950 dark:text-red-200 border border-red-100 dark:border-red-900/50 rounded-2xl rounded-tl-sm" : message.sender === "You" ? "bg-blue-600 text-white rounded-2xl rounded-tr-sm self-end" : "bg-white dark:bg-zinc-800 border-border border rounded-2xl rounded-tl-sm")}>
                    {message.text}
                  </span>
                  {message.sender === "You" && (
                    <span className="text-[10px] text-muted-foreground self-end pr-1 mt-0.5">{message.time}</span>
                  )}
                </div>
              ))}
            </div>

            <div className="p-3 border-t border-border bg-card flex flex-col gap-2">
              <div className="flex items-center justify-between px-1">
                <div className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
                  ID: <span className="text-foreground">{scene.sidebar.username}</span>
                </div>
                <button onClick={onRandomizeUsername} className="text-[10px] text-blue-600 dark:text-blue-400 font-medium flex items-center gap-1 hover:text-blue-700 transition" type="button">
                  <Shuffle className="w-3 h-3" />
                  Randomize
                </button>
              </div>
              <form
                className="flex items-center gap-2 relative shadow-sm rounded-full bg-white dark:bg-zinc-900 border border-border focus-within:ring-2 focus-within:ring-blue-500/50 focus-within:border-blue-500 transition-all p-1 pl-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  const formData = new FormData(event.currentTarget);
                  const value = String(formData.get("message") ?? "").trim();
                  if (!value) {
                    return;
                  }
                  onSendMessage(value);
                  event.currentTarget.reset();
                }}
              >
                <input
                  name="message"
                  type="text"
                  placeholder="Send a message..."
                  className="w-full bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground"
                />
                <button type="submit" className="w-8 h-8 flex items-center justify-center rounded-full bg-blue-600 text-white transition-colors shrink-0">
                  <Send className="w-3.5 h-3.5 -ml-0.5" />
                </button>
              </form>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
