export type PopupTab = "source" | "room" | "chat";
export type SourceType = "sniff" | "screen" | "upload";
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
  connType: string;
  ping: string;
  isGood: boolean;
};

export type ExtensionSceneModel = {
  header: {
    title: string;
    statusText: string;
  };
  tabs: {
    active: PopupTab;
    hasShared: boolean;
  };
  sourceTab: {
    activeSourceType: SourceType;
    sniffCards: SniffVideoCard[];
    sniffGroups: SniffVideoGroup[];
    screenReady: boolean;
    uploadReady: boolean;
    isRefreshing: boolean;
    sectionKinds: SourceType[];
  };
  roomTab: {
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
  footer: {
    primaryLabel: string;
    primaryDisabled: boolean;
    secondaryLabel: string;
    secondaryDisabled: boolean;
  };
  meta: {
    hasSelectedSource: boolean;
    isBusy: boolean;
    busyAction: "primary" | "stop" | null;
    message: string | null;
  };
};
