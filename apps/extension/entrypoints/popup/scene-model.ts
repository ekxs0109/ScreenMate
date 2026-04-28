export type PopupTab = "source" | "room" | "chat";
export type SourceType = "auto" | "sniff" | "screen" | "upload";
export type SectionProvenance = "real" | "mock" | "mixed";

export type ExtensionChatMessage = {
  id: string;
  sender: string;
  text: string;
};

export type SniffTabSummary = {
  tabId: number;
  title?: string;
};

export type SniffVideoCard = {
  id: string;
  tabId: number;
  tabInfo: string;
  tabBadge: string;
  tabBadgeClassName: string;
  tabIdLabel: string;
  tabTitle: string;
  title: string;
  thumb: string | null;
  format: string;
  rate: string;
  selected: boolean;
  label: string;
};

export type SniffVideoGroup = {
  id: string;
  tabId: number;
  title: string;
  cards: SniffVideoCard[];
};

export type ViewerConnectionRow = {
  id: string;
  name: string;
  online: boolean;
  connType: string;
  ping: string;
  isGood: boolean;
};

export type PopupFooterModel =
  | { variant: "hidden" }
  | { variant: "start-room"; disabled: boolean; busy: boolean }
  | { variant: "end-share"; disabled: boolean; busy: boolean }
  | { variant: "change-source"; confirmDisabled: boolean; busy: boolean };

export type ExtensionSceneModel = {
  header: {
    title: string;
    statusText: string;
    playback: {
      label: string;
      mode: "auto" | "manual";
      state: "active" | "waiting";
    };
  };
  tabs: {
    active: PopupTab;
    hasOpenRoomSession: boolean;
    hasAttachedSource: boolean;
    canStopRoom: boolean;
    roomBadgeVisible: boolean;
    chatVisible: boolean;
  };
  sourceTab: {
    activeSourceType: SourceType;
    activeSourceIndicator: SourceType | null;
    sniffCards: SniffVideoCard[];
    sniffGroups: SniffVideoGroup[];
    screenReady: boolean;
    uploadReady: boolean;
    localFile: {
      name: string;
      size: number;
      type: string;
    } | null;
    isRefreshing: boolean;
    followActiveTabVideo: boolean;
    sectionKinds: SourceType[];
  };
  roomTab: {
    state: "empty" | "active";
    roomId: string | null;
    shareUrl: string | null;
    viewerCount: number;
    viewerDetails: ViewerConnectionRow[];
    passwordDraft: string;
    passwordSaved: boolean;
  };
  chatTab: {
    messages: ExtensionChatMessage[];
  };
  footer: PopupFooterModel;
  meta: {
    hasSelectedSource: boolean;
    isBusy: boolean;
    busyAction: "primary" | "stop" | null;
    message: string | null;
  };
};
