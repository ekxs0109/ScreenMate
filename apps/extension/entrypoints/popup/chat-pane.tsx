import { MessageCircle, Send, X } from "lucide-react";
import { cn } from "../../lib/utils";
import type { ExtensionSceneModel } from "./scene-model";
import { PopupScrollArea } from "./presenter";

const cubesPattern = "/patterns/cubes.png";

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
    <ChatPaneInner
      messages={messages}
      onSend={onSend}
      placeholder={placeholder}
      roundedBottom
    />
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
        "fixed bottom-6 left-6 z-[2147483646] bg-card border border-border shadow-2xl rounded-2xl overflow-hidden transition-[width,height,opacity,box-shadow] duration-300 flex flex-col font-sans hover:shadow-blue-500/10",
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
        <ChatPaneInner
          messages={messages}
          onSend={onSend}
          placeholder={placeholder}
        />
      )}
    </div>
  );
}

function ChatPaneInner({
  messages,
  onSend,
  placeholder,
  roundedBottom = false,
}: {
  messages: ExtensionSceneModel["chatTab"]["messages"];
  onSend: (text: string) => boolean | Promise<boolean>;
  placeholder: string;
  roundedBottom?: boolean;
}) {
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
          <div
            key={message.id}
            data-testid={`popup-chat-message-${message.id}`}
            className="flex flex-col gap-1 animate-in fade-in slide-in-from-bottom-1 duration-200 relative z-10"
          >
            <span
              className={cn(
                "text-[10px] font-bold tracking-widest uppercase",
                message.sender === "System"
                  ? "text-gray-400"
                  : "text-blue-500",
              )}
            >
              {message.sender}
            </span>
            <p
              className={cn(
                "text-sm px-3.5 py-2 rounded-2xl w-max max-w-[90%] shadow-sm leading-relaxed transition-[background-color,color,border-color]",
                message.sender === "System"
                  ? "bg-transparent text-gray-500 italic px-0 shadow-none"
                  : "bg-white dark:bg-zinc-900 text-foreground border border-border",
              )}
            >
              {message.text}
            </p>
          </div>
        ))}
      </PopupScrollArea>
      <form
        className={cn(
          "p-3 border-t border-border bg-card flex gap-2 shrink-0",
          roundedBottom && "pb-6 rounded-b-2xl",
        )}
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
        <button
          data-testid="popup-chat-send"
          type="submit"
          className="w-12 bg-blue-600 text-white rounded-xl flex items-center justify-center transition-[background-color,transform] hover:bg-blue-700 active:scale-90 shadow-sm shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </>
  );
}
