import { browser } from "wxt/browser";
import type { ExtensionChatMessage } from "../popup/scene-model";

const ATTR = "data-screenmate-content-chat";

export function createContentChatWidgetController() {
  const cubesPattern = browser.runtime.getURL("/patterns/cubes.png");
  let minimized = false;
  let visible = false;
  let messages: ExtensionChatMessage[] = [
    {
      id: "system-1",
      sender: "System",
      text: "Room created. Waiting for viewers to join.",
    },
  ];

  function show() {
    visible = true;
    render();
  }

  function hide() {
    visible = false;
    destroy();
  }

  function addMessage(message: ExtensionChatMessage) {
    messages = [...messages, message];
    render();
  }

  function setMessages(nextMessages: ExtensionChatMessage[]) {
    messages = nextMessages;
    render();
  }

  function render() {
    destroy();
    if (!visible) {
      return;
    }

    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

    const root = document.createElement("div");
    root.setAttribute(ATTR, "root");
    root.style.position = "fixed";
    root.style.left = "24px";
    root.style.bottom = "24px";
    root.style.zIndex = "2147483646";
    root.style.width = minimized ? "192px" : "340px";
    root.style.height = minimized ? "48px" : "480px";
    root.style.border = isDark ? "1px solid rgba(63, 63, 70, 0.8)" : "1px solid rgba(228, 228, 231, 0.8)";
    root.style.borderRadius = "18px";
    root.style.overflow = "hidden";
    root.style.background = isDark ? "rgba(24, 24, 27, 0.96)" : "rgba(255, 255, 255, 0.96)";
    root.style.boxShadow = isDark ? "0 18px 50px rgba(0, 0, 0, 0.4)" : "0 18px 50px rgba(15, 23, 42, 0.24)";
    root.style.display = "flex";
    root.style.flexDirection = "column";
    root.style.fontFamily = "\"IBM Plex Sans\", \"Segoe UI\", sans-serif";
    root.style.color = isDark ? "#fafafa" : "#09090b";
    root.style.transition = "all 0.3s ease";

    const header = document.createElement("button");
    header.type = "button";
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.justifyContent = "space-between";
    header.style.padding = "12px";
    header.style.border = "0";
    header.style.borderBottom = isDark ? "1px solid rgba(63, 63, 70, 0.9)" : "1px solid rgba(228, 228, 231, 0.9)";
    header.style.background = isDark ? "rgba(39, 39, 42, 0.9)" : "rgba(244, 244, 245, 0.9)";
    header.style.cursor = "pointer";
    header.style.color = "inherit";
    
    const titleSpan = `<span style="font-weight:700;font-size:14px;padding: 0 4px;">Room Chat</span>`;
    const xIcon = `<span style="width:28px;height:28px;display:flex;items-center;justify-content:center;border-radius:6px;transition:background-color 0.2s;" onmouseover="this.style.backgroundColor='${isDark ? "rgba(63,63,70,0.5)" : "rgba(228,228,231,0.5)"}'" onmouseout="this.style.backgroundColor='transparent'"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="color:${isDark ? "#a1a1aa" : "#71717a"};margin-top:6px;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></span>`;
    const pulsingDot = `<div style="width:10px;height:10px;border-radius:999px;background:#3b82f6;margin-right:8px;box-shadow: 0 0 8px rgba(59,130,246,0.6);animation: screenmate-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;"></div><style>@keyframes screenmate-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .5; } }</style>`;
    
    header.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#2563eb;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
        ${titleSpan}
      </div>
      ${minimized ? pulsingDot : xIcon}
    `;
    header.onclick = () => {
      minimized = !minimized;
      render();
    };
    root.appendChild(header);

    if (!minimized) {
      const body = document.createElement("div");
      body.style.flex = "1";
      body.style.overflowY = "auto";
      body.style.padding = "16px";
      body.style.display = "flex";
      body.style.flexDirection = "column";
      body.style.gap = "14px";
      body.style.position = "relative";

      if (!isDark) {
        const bg = document.createElement("div");
        bg.style.position = "absolute";
        bg.style.inset = "0";
        bg.style.backgroundImage = `url("${cubesPattern}")`;
        bg.style.opacity = "1";
        bg.style.pointerEvents = "none";
        bg.style.zIndex = "0";
        body.appendChild(bg);
      }

      for (const message of messages) {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.flexDirection = "column";
        row.style.gap = "4px";
        row.style.position = "relative";
        row.style.zIndex = "1";
        const senderColor = message.sender === "System" ? "#9ca3af" : "#3b82f6";
        const bubbleBg = message.sender === "System" ? "transparent" : (isDark ? "#27272a" : "#fff");
        const bubbleColor = message.sender === "System" ? "#6b7280" : (isDark ? "#fafafa" : "#09090b");
        const bubbleBorder = message.sender === "System" ? "0" : (isDark ? "1px solid rgba(63, 63, 70, 0.9)" : "1px solid rgba(228, 228, 231, 0.9)");
        const bubbleShadow = message.sender === "System" ? "none" : (isDark ? "none" : "0 1px 2px rgba(15,23,42,0.08)");
        
        row.innerHTML = `<span style="font-size:10px;font-weight:700;text-transform:uppercase;color:${senderColor};">${escapeHtml(message.sender)}</span><p style="margin:0;max-width:90%;padding:${message.sender === "System" ? "0" : "8px 14px"};font-size:14px;line-height:1.5;border-radius:16px;background:${bubbleBg};box-shadow:${bubbleShadow};font-style:${message.sender === "System" ? "italic" : "normal"};color:${bubbleColor};border:${bubbleBorder};">${escapeHtml(message.text)}</p>`;
        body.appendChild(row);
      }

      const form = document.createElement("form");
      form.style.display = "flex";
      form.style.gap = "8px";
      form.style.padding = "12px";
      form.style.borderTop = isDark ? "1px solid rgba(63, 63, 70, 0.9)" : "1px solid rgba(228, 228, 231, 0.9)";
      form.style.background = isDark ? "rgba(24, 24, 27, 0.96)" : "rgba(255, 255, 255, 0.96)";
      
      const input = document.createElement("input");
      input.name = "message";
      input.placeholder = "Say something...";
      input.style.flex = "1";
      input.style.padding = "10px 16px";
      input.style.borderRadius = "12px";
      input.style.border = isDark ? "1px solid rgba(63, 63, 70, 0.9)" : "1px solid rgba(228, 228, 231, 0.9)";
      input.style.background = isDark ? "#18181b" : "#f4f4f5";
      input.style.color = "inherit";
      input.style.fontSize = "14px";
      input.style.outline = "none";
      
      const button = document.createElement("button");
      button.type = "submit";
      button.textContent = "Send";
      button.style.width = "72px";
      button.style.border = "0";
      button.style.borderRadius = "12px";
      button.style.background = "#2563eb";
      button.style.color = "#fff";
      button.style.fontWeight = "700";
      button.style.cursor = "pointer";
      
      form.append(input, button);
      form.onsubmit = (event) => {
        event.preventDefault();
        const value = input.value.trim();
        if (!value) {
          return;
        }
        input.value = "";
        void browser.runtime
          .sendMessage({
            type: "screenmate:send-chat-message",
            text: value,
          })
          .then((response) => {
            if (!isRecord(response) || response.ok !== true) {
              addMessage({
                id: `send-failed-${Date.now()}`,
                sender: "System",
                text: "Message could not be sent. Please try again.",
              });
            }
          })
          .catch(() => {
            addMessage({
              id: `send-failed-${Date.now()}`,
              sender: "System",
              text: "Message could not be sent. Please try again.",
            });
          });
      };

      root.append(body, form);
    }

    document.documentElement.appendChild(root);
  }

  function destroy() {
    document.querySelectorAll(`[${ATTR}]`).forEach((node) => node.remove());
    document.querySelectorAll(`[${ATTR}="root"]`).forEach((node) => node.remove());
  }

  return {
    addMessage,
    hide,
    setMessages,
    show,
  };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
