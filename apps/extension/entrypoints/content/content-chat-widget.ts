import type { ExtensionChatMessage } from "../popup/scene-model";

const ATTR = "data-screenmate-content-chat";

export function createContentChatWidgetController() {
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

  function render() {
    destroy();
    if (!visible) {
      return;
    }

    const root = document.createElement("div");
    root.setAttribute(ATTR, "root");
    root.style.position = "fixed";
    root.style.left = "24px";
    root.style.bottom = "24px";
    root.style.zIndex = "2147483646";
    root.style.width = minimized ? "192px" : "340px";
    root.style.height = minimized ? "48px" : "480px";
    root.style.border = "1px solid rgba(228,228,231,0.8)";
    root.style.borderRadius = "18px";
    root.style.overflow = "hidden";
    root.style.background = "rgba(255,255,255,0.96)";
    root.style.boxShadow = "0 18px 50px rgba(15,23,42,0.24)";
    root.style.display = "flex";
    root.style.flexDirection = "column";
    root.style.fontFamily = "\"IBM Plex Sans\", \"Segoe UI\", sans-serif";
    root.style.color = "#09090b";

    const header = document.createElement("button");
    header.type = "button";
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.justifyContent = "space-between";
    header.style.padding = "12px";
    header.style.border = "0";
    header.style.borderBottom = "1px solid rgba(228,228,231,0.9)";
    header.style.background = "rgba(244,244,245,0.9)";
    header.style.cursor = "pointer";
    header.innerHTML = `<span style="font-weight:700;font-size:14px;">Room Chat</span><span style="width:10px;height:10px;border-radius:999px;background:#3b82f6;display:${minimized ? "block" : "none"};"></span>`;
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

      for (const message of messages) {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.flexDirection = "column";
        row.style.gap = "4px";
        row.innerHTML = `<span style="font-size:10px;font-weight:700;text-transform:uppercase;color:${message.sender === "System" ? "#9ca3af" : "#3b82f6"};">${escapeHtml(message.sender)}</span><p style="margin:0;max-width:90%;padding:${message.sender === "System" ? "0" : "8px 14px"};font-size:14px;line-height:1.5;border-radius:16px;background:${message.sender === "System" ? "transparent" : "#fff"};box-shadow:${message.sender === "System" ? "none" : "0 1px 2px rgba(15,23,42,0.08)"};font-style:${message.sender === "System" ? "italic" : "normal"};color:${message.sender === "System" ? "#6b7280" : "#09090b"};border:${message.sender === "System" ? "0" : "1px solid rgba(228,228,231,0.9)"};">${escapeHtml(message.text)}</p>`;
        body.appendChild(row);
      }

      const form = document.createElement("form");
      form.style.display = "flex";
      form.style.gap = "8px";
      form.style.padding = "12px";
      form.style.borderTop = "1px solid rgba(228,228,231,0.9)";
      const input = document.createElement("input");
      input.name = "message";
      input.placeholder = "Say something...";
      input.style.flex = "1";
      input.style.padding = "10px 16px";
      input.style.borderRadius = "12px";
      input.style.border = "1px solid rgba(228,228,231,0.9)";
      input.style.background = "#f4f4f5";
      const button = document.createElement("button");
      button.type = "submit";
      button.textContent = "Send";
      button.style.width = "72px";
      button.style.border = "0";
      button.style.borderRadius = "12px";
      button.style.background = "#2563eb";
      button.style.color = "#fff";
      button.style.fontWeight = "700";
      form.append(input, button);
      form.onsubmit = (event) => {
        event.preventDefault();
        const value = input.value.trim();
        if (!value) {
          return;
        }
        addMessage({
          id: `local-${Date.now()}`,
          sender: "You",
          text: value,
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
