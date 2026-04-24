import type {
  ExtensionChatMessage,
  PopupTab,
  SourceType,
  ViewerConnectionRow,
} from "./scene-model";

export type ExtensionMockState = {
  activeTab: PopupTab;
  activeSourceType: SourceType;
  screenReady: boolean;
  uploadReady: boolean;
  passwordDraft: string;
  passwordSaved: boolean;
  copiedLink: boolean;
  copiedRoomId: boolean;
  isRefreshing: boolean;
  messages: ExtensionChatMessage[];
  viewerDetails: ViewerConnectionRow[];
};

export function createExtensionMockState(): ExtensionMockState {
  return {
    activeTab: "source",
    activeSourceType: "sniff",
    screenReady: false,
    uploadReady: false,
    passwordDraft: "",
    passwordSaved: false,
    copiedLink: false,
    copiedRoomId: false,
    isRefreshing: false,
    messages: [
      {
        id: "system-1",
        sender: "System",
        text: "Room created. Waiting for viewers to join.",
      },
    ],
    viewerDetails: [
      {
        id: "viewer-a",
        name: "User_4092",
        connType: "P2P",
        ping: "24ms",
        isGood: true,
      },
      {
        id: "viewer-b",
        name: "User_7188",
        connType: "Relay",
        ping: "142ms",
        isGood: false,
      },
      {
        id: "viewer-c",
        name: "User_9112",
        connType: "P2P",
        ping: "15ms",
        isGood: true,
      },
    ],
  };
}
