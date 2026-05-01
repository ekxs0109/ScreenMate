import { MessageCircle, X } from "lucide-react";
import { cn } from "../../lib/utils";
import type { ExtensionSceneModel } from "./scene-model";
import { ChatPanel } from "../../components/chat-panel";

export function ChatPane({
  messages,
  onSend,
  placeholder,
}: {
  messages: ExtensionSceneModel["chatTab"]["messages"];
  onSend: (text: string) => boolean | Promise<boolean>;
  placeholder: string;
}) {
  return (
    <div className="flex flex-col h-full bg-zinc-50 dark:bg-zinc-950">
      <ChatPanel
        messages={messages}
        onSend={onSend}
        placeholder={placeholder}
        systemName="System"
        currentUsername="Host"
        className="flex-1"
      />
    </div>
  );
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
    <div
      className={cn(
        "fixed bottom-6 left-6 z-[2147483646] bg-card border border-border shadow-2xl rounded-xl overflow-hidden transition-[width,height,opacity,box-shadow] duration-300 flex flex-col font-sans hover:shadow-blue-500/10",
        minimized
          ? "w-48 h-12 cursor-pointer opacity-90 hover:opacity-100"
          : "w-[340px] h-[480px]",
      )}
    >
      <div
        className="p-3 border-b border-border bg-zinc-50 dark:bg-zinc-900/50 flex items-center justify-between shrink-0 cursor-pointer transition-colors"
        onClick={onToggleMinimized}
      >
        <div className="flex items-center gap-2.5 px-1">
          <MessageCircle className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <span className="font-bold text-sm tracking-tight">{title}</span>
        </div>
        {minimized ? (
          <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse mr-2" />
        ) : (
          <span className="w-7 h-7 hover:bg-zinc-200 dark:hover:bg-zinc-800 dark:hover:bg-zinc-700 rounded-md flex items-center justify-center transition-colors">
            <X className="w-4 h-4 text-muted-foreground stroke-[3]" />
          </span>
        )}
      </div>
      {!minimized && (
        <ChatPanel
          messages={messages}
          onSend={onSend}
          placeholder={placeholder}
          systemName="System"
          currentUsername="Host"
          className="flex-1"
        />
      )}
    </div>
  );
}
