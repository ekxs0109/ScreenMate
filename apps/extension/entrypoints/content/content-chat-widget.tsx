import { browser } from "wxt/browser";
import { createShadowRootUi, type ShadowRootContentScriptUi } from "wxt/utils/content-script-ui/shadow-root";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider } from "../../components/theme-provider";
import { ContentChatWidget } from "../popup/chat-pane";
import type { ExtensionChatMessage } from "../popup/scene-model";
import "../popup/popup.css";

function getI18nMessage(key: string, fallback: string) {
  try {
    return browser.i18n?.getMessage(key as any) || fallback;
  } catch {
    return fallback;
  }
}

export function createContentChatWidgetController(ctx: any) {
  let ui: ShadowRootContentScriptUi<Root> | null = null;
  let minimized = false;
  let visible = false;
  let messages: ExtensionChatMessage[] = [
    {
      id: "system-1",
      sender: getI18nMessage("chatSystemSender", "System"),
      text: getI18nMessage(
        "chatRoomCreated",
        "Room created. Waiting for viewers to join.",
      ),
      timestamp: Date.now() - 60000,
    },
  ];

  async function initUi() {
    if (ui) return ui;
    ui = await createShadowRootUi(ctx, {
      name: "screenmate-content-chat",
      position: "inline",
      anchor: "body",
      append: "last",
      onMount: (container: any) => {
        const root = createRoot(container);
        root.render(<App />);
        return root;
      },
      onRemove: (root: any) => {
        root?.unmount();
      },
    });
    return ui;
  }

  function App() {
    return (
      <div style={{ position: "fixed", bottom: 24, left: 24, zIndex: 2147483646 }}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <ContentChatWidget
            title={getI18nMessage("roomChat", "Room Chat")}
            placeholder={getI18nMessage("chatPlaceholder", "Say something...")}
            messages={messages}
            onSend={handleSend}
            minimized={minimized}
            onToggleMinimized={() => {
              minimized = !minimized;
              render();
            }}
          />
        </ThemeProvider>
      </div>
    );
  }

  async function handleSend(text: string) {
    try {
      const response = await browser.runtime.sendMessage({
        type: "screenmate:send-chat-message",
        text,
      });
      if (typeof response === "object" && response !== null && (response as any).ok === true) {
        return true;
      }
      addMessage({
        id: `send-failed-${Date.now()}`,
        sender: getI18nMessage("chatSystemSender", "System"),
        text: getI18nMessage(
          "chatSendFailed",
          "Message could not be sent. Please try again.",
        ),
      });
      return false;
    } catch {
      addMessage({
        id: `send-failed-${Date.now()}`,
        sender: getI18nMessage("chatSystemSender", "System"),
        text: getI18nMessage(
          "chatSendFailed",
          "Message could not be sent. Please try again.",
        ),
      });
      return false;
    }
  }

  function render() {
    if (!visible) {
      if (ui) {
        ui.remove();
        ui = null;
      }
      return;
    }
    initUi().then(currentUi => {
      if (currentUi.mounted) {
        currentUi.mounted.render(<App />);
      } else {
        currentUi.mount();
      }
    });
  }

  function show() {
    visible = true;
    render();
  }

  function hide() {
    visible = false;
    render();
  }

  function addMessage(message: ExtensionChatMessage) {
    messages = [...messages, message];
    render();
  }

  function setMessages(nextMessages: ExtensionChatMessage[]) {
    messages = nextMessages;
    render();
  }

  return {
    addMessage,
    hide,
    setMessages,
    show,
  };
}
