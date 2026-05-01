import { useRef, useEffect, useState, FormEvent } from "react";
import { Send } from "lucide-react";
import { cn } from "../lib/utils";

export interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  timestamp?: number;
  time?: string;
}

interface ChatPanelProps {
  messages: ChatMessage[];
  onSend: (text: string) => boolean | Promise<boolean>;
  placeholder?: string;
  systemName?: string;
  currentUsername?: string;
  className?: string;
}

export function ChatPanel({
  messages,
  onSend,
  placeholder = "Type a message...",
  systemName = "System",
  currentUsername = "You",
  className,
}: ChatPanelProps) {
  const [inputValue, setInputValue] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const text = inputValue.trim();
    if (!text) return;

    void Promise.resolve(onSend(text)).then((sent) => {
      if (sent) {
        setInputValue("");
      }
    });
  };

  return (
    <div className={cn("flex flex-col h-full bg-zinc-50 dark:bg-zinc-950/40 relative overflow-hidden", className)}>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-5 scroll-smooth pb-20"
      >
        {messages.map((msg, i) => {
          const isMe = msg.sender === currentUsername || msg.sender === "You";
          const isSystem = msg.sender === "System" || msg.sender === systemName;
          const prevMsg = messages[i - 1];
          const showSender = !isMe && !isSystem && (!prevMsg || prevMsg.sender !== msg.sender);

          // WeChat style timestamp logic
          let showTimestamp = false;
          let timeDisplay = "";

          if (msg.timestamp) {
            if (!prevMsg || !prevMsg.timestamp || msg.timestamp - prevMsg.timestamp > 5 * 60 * 1000) {
              showTimestamp = true;
              timeDisplay = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12: false }).format(new Date(msg.timestamp));
            }
          } else if (msg.time) {
            if (!prevMsg || prevMsg.time !== msg.time) {
              showTimestamp = true;
              timeDisplay = msg.time;
            }
          }

          return (
            <div key={msg.id} className="flex flex-col gap-2">
              {showTimestamp && (
                <div className="flex justify-center mt-2 mb-1">
                  <span className="text-[10px] font-medium text-muted-foreground/80 bg-zinc-200/50 dark:bg-zinc-800/50 px-2 py-0.5 rounded-md tracking-wide">
                    {timeDisplay}
                  </span>
                </div>
              )}
              {isSystem ? (
                <div className="flex justify-center my-1">
                  <span className="text-[10px] font-semibold text-muted-foreground bg-zinc-200/60 dark:bg-zinc-800/60 px-3 py-1 rounded-full tracking-wide">
                    {msg.text}
                  </span>
                </div>
              ) : (
                <div className={cn("flex flex-col gap-1 w-full", isMe ? "items-end" : "items-start")}>
                  {showSender && (
                    <span className="text-[11px] font-bold text-muted-foreground ml-2 mb-0.5 tracking-wide">
                      {msg.sender}
                    </span>
                  )}
                  <div className={cn("flex w-full drop-shadow-sm", isMe ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "px-3.5 py-2.5 max-w-[85%] flex flex-col relative",
                        isMe
                          ? "bg-[#95ec69] dark:bg-[#26b553] text-[#000] dark:text-[#fff] rounded-xl "
                          : "bg-white dark:bg-zinc-900  text-foreground rounded-xl "
                      )}
                      style={{ wordBreak: 'break-word' }}
                    >
                      {/* WeChat style small arrow */}
                      <div className={cn(
                        "absolute top-[14px] w-2.5 h-2.5 rotate-45 -z-10",
                        isMe
                          ? "right-[-4px] bg-[#95ec69] dark:bg-[#26b553]"
                          : "left-[-4px] bg-white dark:bg-zinc-900 "
                      )} />
                      <span className="text-[14px] leading-relaxed relative z-10">{msg.text}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="absolute bottom-4 left-4 right-4 z-10">
        <form onSubmit={handleSubmit} className="flex items-center gap-2 relative bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md shadow-lg border border-border rounded-full p-1.5">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={placeholder}
            className="flex-1 bg-transparent border-none px-4 text-sm outline-none placeholder:text-muted-foreground/60 text-foreground"
          />
          <button
            type="submit"
            disabled={!inputValue.trim()}
            className="w-10 h-10 shrink-0 bg-blue-600 hover:bg-blue-700 active:scale-95 disabled:opacity-40 disabled:active:scale-100 text-white rounded-full flex items-center justify-center transition-all shadow-sm"
          >
            <Send className="w-4 h-4 ml-0.5" />
          </button>
        </form>
      </div>
    </div>
  );
}
