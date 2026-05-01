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
  localFile: {
    name: string;
    size: number;
    type: string;
  } | null;
  passwordDraft: string;
  passwordSaved: boolean;
  copiedLink: boolean;
  copiedRoomId: boolean;
  isRefreshing: boolean;
  // Used only before real room activity arrives.
  messages: ExtensionChatMessage[];
  // Used only before real room activity arrives.
  viewerDetails: ViewerConnectionRow[];
};

export function createExtensionMockState(): ExtensionMockState {
  return {
    activeTab: "source",
    activeSourceType: "auto",
    screenReady: false,
    uploadReady: false,
    localFile: null,
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
        timestamp: Date.now() - 60000,
      },
    ],
    viewerDetails: [
      {
        id: "viewer-a",
        name: "User_4092",
        online: true,
        connType: "P2P",
        ping: "24ms",
        isGood: true,
      },
      {
        id: "viewer-b",
        name: "User_7188",
        online: true,
        connType: "Relay",
        ping: "142ms",
        isGood: false,
      },
      {
        id: "viewer-c",
        name: "User_9112",
        online: true,
        connType: "P2P",
        ping: "15ms",
        isGood: true,
      },
    ],
  };
}
