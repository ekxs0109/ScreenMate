import {
  buildRandomViewerUsername,
  type ViewerLocale,
} from "./i18n";

export type ViewerMockState = {
  username: string;
  pingMs: number;
  connectionType: "direct-p2p";
  viewerCount: number;
  messages: ViewerMockChatMessage[];
};

export type ViewerMockChatMessage = {
  id: string;
  senderKind: "host" | "system" | "self" | "named";
  senderName?: string;
  text: string | null;
  textKey?: "hostStartedRoom";
  timestamp: number;
};

export function createViewerMockState(
  locale: ViewerLocale = "en",
): ViewerMockState {
  return {
    username: buildRandomViewerUsername(locale),
    pingMs: 22,
    connectionType: "direct-p2p",
    viewerCount: 3,
    messages: [
      {
        id: "system-1",
        senderKind: "host",
        text: null,
        textKey: "hostStartedRoom",
        timestamp: Date.now(),
      },
    ],
  };
}
