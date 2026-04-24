import type { ViewerChatMessage } from "./viewer-scene-model";

export type ViewerMockState = {
  language: string;
  username: string;
  pingLabel: string;
  connectionType: string;
  viewerCount: number;
  messages: ViewerChatMessage[];
};

export function createViewerMockState(): ViewerMockState {
  return {
    language: "en",
    username: `User_${Math.floor(Math.random() * 10000)}`,
    pingLabel: "22ms",
    connectionType: "Direct (P2P)",
    viewerCount: 3,
    messages: [
      {
        id: "system-1",
        sender: "Host",
        text: "Host started the room",
        time: nowTime(),
      },
    ],
  };
}

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
