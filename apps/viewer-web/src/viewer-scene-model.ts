export type ViewerChatMessage = {
  id: string;
  senderKind: "host" | "system" | "self" | "named";
  sender: string;
  text: string;
  time: string;
};

export type ViewerSceneModel = {
  header: {
    title: string;
    live: boolean;
    roomId: string | null;
    statusText: string;
  };
  connection: {
    typeLabel: string;
    pingLabel: string;
  };
  sidebar: {
    viewerCount: number;
    username: string;
    messages: ViewerChatMessage[];
  };
  player: {
    showWaitingOverlay: boolean;
    waitingText: string;
    showJoinOverlay: boolean;
    joinBusy: boolean;
    joined: boolean;
  };
  notices: {
    error: string | null;
    endedReason: string | null;
  };
};
