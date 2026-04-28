import type { RoomChatMessage, ViewerRosterEntry } from "@screenmate/shared";
import type { TabVideoSource } from "../background";
import type { HostRoomSnapshot } from "../background/host-room-snapshot";
import type { PreparedSourceState } from "../background";
import { getPopupViewModel } from "./view-model";
import type { ExtensionMockState } from "./mock-state";
import type {
  ExtensionChatMessage,
  ExtensionSceneModel,
  PopupFooterModel,
  SourceType,
  SniffTabSummary,
  ViewerConnectionRow,
} from "./scene-model";

const OFFSCREEN_ATTACHMENT_TAB_ID = -1;
const OFFSCREEN_ATTACHMENT_FRAME_ID = -1;

type BusyAction = "primary" | "stop" | null;

export function buildExtensionSceneModel(input: {
  snapshot: HostRoomSnapshot;
  sniffTabs?: SniffTabSummary[];
  videos: TabVideoSource[];
  selectedVideoId: string | null;
  isBusy: boolean;
  busyAction: BusyAction;
  viewerRoomUrl: string | null;
  followActiveTabVideo?: boolean;
  preparedSourceState?: PreparedSourceState;
  mock: ExtensionMockState;
}): ExtensionSceneModel {
  const viewModel = getPopupViewModel(input.snapshot);
  const hasOpenRoomSession =
    input.snapshot.roomId !== null && input.snapshot.roomLifecycle !== "closed";
  const hasAttachedSource = input.snapshot.sourceState === "attached";
  const canStopRoom = hasOpenRoomSession;
  const hasActiveRealRoom =
    input.snapshot.roomId !== null &&
    input.snapshot.roomLifecycle !== "idle" &&
    input.snapshot.roomLifecycle !== "closed";
  const sniffCards = input.videos.map((video, index) =>
    buildSniffCard(video, index, input.selectedVideoId),
  );
  const screenReady = input.preparedSourceState?.kind === "screen" &&
    input.preparedSourceState.ready;
  const uploadReady = input.preparedSourceState?.kind === "upload" &&
    input.preparedSourceState.ready;
  const localFile = input.preparedSourceState?.kind === "upload"
    ? input.preparedSourceState.metadata
    : null;
  const activeSourceIndicator = getActiveSourceIndicator({
    followActiveTabVideo: input.followActiveTabVideo === true,
    preparedSourceState: input.preparedSourceState,
    selectedVideoId: input.selectedVideoId,
    snapshot: input.snapshot,
  });
  const chatVisible = hasOpenRoomSession;
  const activeTab = chatVisible || input.mock.activeTab !== "chat"
    ? input.mock.activeTab
    : "source";

  return {
    header: {
      title: "ScreenMate",
      statusText: viewModel.statusText,
      playback: {
        label: getPlaybackLabel(input.snapshot.sourceLabel),
        mode: input.followActiveTabVideo === true ? "auto" : "manual",
        state: input.snapshot.sourceState === "attached" ? "active" : "waiting",
      },
    },
    tabs: {
      active: activeTab,
      hasOpenRoomSession,
      hasAttachedSource,
      canStopRoom,
      roomBadgeVisible: hasOpenRoomSession,
      chatVisible,
    },
    sourceTab: {
      activeSourceType: input.mock.activeSourceType,
      activeSourceIndicator,
      screenReady,
      uploadReady,
      localFile,
      isRefreshing: input.mock.isRefreshing,
      followActiveTabVideo: input.followActiveTabVideo === true,
      sectionKinds: ["auto", "sniff", "screen", "upload"],
      sniffCards,
      sniffGroups: groupSniffCards(input.sniffTabs ?? [], sniffCards),
    },
    roomTab: {
      state: hasOpenRoomSession ? "active" : "empty",
      roomId: input.snapshot.roomId,
      shareUrl: input.viewerRoomUrl,
      viewerCount: input.snapshot.viewerCount,
      viewerDetails: hasActiveRealRoom
        ? input.snapshot.viewerRoster.map(toViewerConnectionRow)
        : input.mock.viewerDetails,
      passwordDraft: input.mock.passwordDraft,
      passwordSaved: input.mock.passwordSaved,
    },
    chatTab: {
      messages: hasActiveRealRoom
        ? input.snapshot.chatMessages.map(toExtensionChatMessage)
        : input.mock.messages,
    },
    footer: deriveFooter({
      activePopupTab: activeTab,
      activeSourceType: input.mock.activeSourceType,
      busyAction: input.busyAction,
      canStopRoom,
      followActiveTabVideo: input.followActiveTabVideo === true,
      hasOpenRoomSession,
      hasSelectedVideo: input.selectedVideoId !== null,
      isBusy: input.isBusy,
      screenReady,
      uploadReady,
    }),
    meta: {
      hasSelectedSource: input.selectedVideoId !== null,
      isBusy: input.isBusy,
      busyAction: input.busyAction,
      message: input.snapshot.message,
    },
  };
}

function deriveFooter(input: {
  activePopupTab: "source" | "room" | "chat";
  activeSourceType: SourceType;
  busyAction: BusyAction;
  canStopRoom: boolean;
  followActiveTabVideo: boolean;
  hasOpenRoomSession: boolean;
  hasSelectedVideo: boolean;
  isBusy: boolean;
  screenReady: boolean;
  uploadReady: boolean;
}): PopupFooterModel {
  const canUseSelectedSource =
    input.activeSourceType === "auto"
      ? input.followActiveTabVideo
      : input.activeSourceType === "sniff"
        ? input.hasSelectedVideo || input.followActiveTabVideo
        : input.activeSourceType === "screen"
          ? input.screenReady
          : input.uploadReady;

  if (!input.hasOpenRoomSession) {
    if (input.activeSourceType === "auto" && !input.followActiveTabVideo) {
      return { variant: "hidden" };
    }

    return {
      variant: "start-room",
      disabled: input.isBusy || !canUseSelectedSource,
      busy: input.isBusy && input.busyAction === "primary",
    };
  }

  if (input.activePopupTab === "room" || input.followActiveTabVideo) {
    return {
      variant: "end-share",
      disabled: input.isBusy || !input.canStopRoom,
      busy: input.isBusy && input.busyAction === "stop",
    };
  }

  return {
    variant: "change-source",
    confirmDisabled: input.isBusy || !canUseSelectedSource,
    busy: input.isBusy && input.busyAction === "primary",
  };
}

function getActiveSourceIndicator(input: {
  followActiveTabVideo: boolean;
  preparedSourceState?: PreparedSourceState;
  selectedVideoId: string | null;
  snapshot: HostRoomSnapshot;
}): SourceType | null {
  if (
    input.snapshot.sourceState !== "attached" ||
    input.snapshot.activeTabId === null ||
    input.snapshot.activeFrameId === null
  ) {
    return null;
  }

  if (
    input.snapshot.activeTabId === OFFSCREEN_ATTACHMENT_TAB_ID &&
    input.snapshot.activeFrameId === OFFSCREEN_ATTACHMENT_FRAME_ID
  ) {
    return getActiveOffscreenSourceIndicator(
      input.snapshot.sourceLabel,
      input.preparedSourceState,
    );
  }

  if (input.followActiveTabVideo) {
    return "auto";
  }

  if (
    input.selectedVideoId?.startsWith(
      `${input.snapshot.activeTabId}:${input.snapshot.activeFrameId}:`,
    )
  ) {
    return "sniff";
  }

  return "sniff";
}

function getActiveOffscreenSourceIndicator(
  sourceLabel: string | null,
  preparedSourceState: PreparedSourceState | undefined,
): SourceType | null {
  if (isScreenShareSourceLabel(sourceLabel)) {
    return "screen";
  }

  if (sourceLabel) {
    if (
      preparedSourceState?.kind === "screen" &&
      preparedSourceState.ready &&
      preparedSourceState.label === sourceLabel
    ) {
      return "screen";
    }

    if (
      preparedSourceState?.kind === "upload" &&
      preparedSourceState.ready &&
      preparedSourceState.label === sourceLabel
    ) {
      return "upload";
    }

    return "upload";
  }

  if (preparedSourceState?.kind === "screen" && preparedSourceState.ready) {
    return "screen";
  }

  if (preparedSourceState?.kind === "upload" && preparedSourceState.ready) {
    return "upload";
  }

  return null;
}

function isScreenShareSourceLabel(sourceLabel: string | null) {
  return (
    sourceLabel === "Shared screen" ||
    sourceLabel === "Shared window" ||
    sourceLabel === "Shared browser tab"
  );
}

function getPlaybackLabel(sourceLabel: string | null) {
  if (!sourceLabel) {
    return "";
  }

  const trimmed = sourceLabel.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith("blob:")) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    const fileName = decodeURIComponent(
      url.pathname.split("/").filter(Boolean).pop() ?? "",
    );
    return fileName || url.hostname || trimmed;
  } catch {
    return trimmed;
  }
}

function toViewerConnectionRow(viewer: ViewerRosterEntry): ViewerConnectionRow {
  return {
    id: viewer.viewerSessionId,
    name: viewer.displayName,
    online: viewer.online,
    connType: viewer.online ? toConnectionLabel(viewer.connectionType) : "Offline",
    ping: viewer.online && typeof viewer.pingMs === "number" ? `${viewer.pingMs}ms` : "--",
    isGood: viewer.online && (viewer.pingMs === null || viewer.pingMs < 120),
  };
}

function toConnectionLabel(connectionType: ViewerRosterEntry["connectionType"]) {
  if (connectionType === "direct") {
    return "P2P";
  }

  if (connectionType === "relay") {
    return "Relay";
  }

  return "--";
}

function toExtensionChatMessage(message: RoomChatMessage): ExtensionChatMessage {
  return {
    id: message.messageId,
    sender: message.senderRole === "host" ? "Host" : message.senderName,
    text: message.text,
  };
}

function buildSniffCard(
  video: TabVideoSource,
  index: number,
  selectedVideoId: string | null,
) {
  const sourceId = `${video.tabId}:${video.frameId}:${video.id}`;
  const tabInfo = getTabInfo(video, index);
  const isBilibili = tabInfo.includes("bilibili");
  const tabTitle = video.tabTitle?.trim() || `Tab ${video.tabId}`;
  return {
    id: sourceId,
    tabId: video.tabId,
    tabInfo,
    tabBadge: isBilibili ? "B" : "YT",
    tabBadgeClassName: isBilibili ? "bg-[#fb7299]" : "bg-[#ff0000]",
    tabIdLabel: tabTitle,
    tabTitle,
    title: getCardTitle(video, index),
    thumb: getCardThumb(video),
    format: getCardFormat(video),
    rate: getCardMeta(video),
    selected: selectedVideoId === sourceId,
    label: video.label,
  };
}

function groupSniffCards(
  sniffTabs: SniffTabSummary[],
  cards: ReturnType<typeof buildSniffCard>[],
) {
  const groups = new Map<number, ReturnType<typeof buildSniffCard>[]>();
  for (const card of cards) {
    groups.set(card.tabId, [...(groups.get(card.tabId) ?? []), card]);
  }

  const tabOrder = new Map<number, string>();
  for (const tab of sniffTabs) {
    tabOrder.set(tab.tabId, tab.title?.trim() || `Tab ${tab.tabId}`);
  }

  for (const card of cards) {
    if (!tabOrder.has(card.tabId)) {
      tabOrder.set(card.tabId, card.tabTitle || `Tab ${card.tabId}`);
    }
  }

  return Array.from(tabOrder.entries()).map(([tabId, fallbackTitle], index) => {
    const groupCards = groups.get(tabId) ?? [];
    const tabTitle = fallbackTitle || groupCards[0]?.tabTitle || `Tab ${tabId}`;
    return {
      id: `tab-${tabId}`,
      tabId,
      title: `标签 ${index + 1} - ${tabTitle}`,
      cards: groupCards,
    };
  });
}

function getTabInfo(
  video: Pick<TabVideoSource, "primaryUrl" | "label" | "tabTitle">,
  index: number,
) {
  const normalized = `${video.primaryUrl ?? ""} ${video.label} ${video.tabTitle ?? ""}`.toLowerCase();
  if (normalized.includes("bunny") || normalized.includes("bilibili")) {
    return "bilibili.com";
  }

  if (normalized.includes("youtube") || normalized.includes("react")) {
    return "youtube.com";
  }

  return index % 2 === 0 ? "bilibili.com" : "youtube.com";
}

function getCardThumb(
  video: Pick<TabVideoSource, "posterUrl" | "thumbnailUrl">,
): string | null {
  return video.posterUrl?.trim() || video.thumbnailUrl?.trim() || null;
}

function getCardTitle(video: Pick<TabVideoSource, "label">, index: number): string {
  const cleanLabel = video.label.replace(/\s*\(not visible\)$/i, "").trim();
  if (!cleanLabel || cleanLabel.startsWith("blob:")) {
    return `视频 ${index + 1}`;
  }

  try {
    const url = new URL(cleanLabel);
    if (url.protocol === "blob:") {
      return `视频 ${index + 1}`;
    }

    const fileName = decodeURIComponent(
      url.pathname.split("/").filter(Boolean).pop() ?? "",
    );
    return fileName || url.hostname || `视频 ${index + 1}`;
  } catch {
    return cleanLabel;
  }
}

function getCardFormat(
  video: Pick<TabVideoSource, "format" | "width" | "height">,
): string {
  const format = (video.format ?? "media").toUpperCase();
  const resolution =
    typeof video.width === "number" && typeof video.height === "number"
      ? `${video.width}x${video.height}`
      : null;

  return resolution ? `${format} • ${resolution}` : format;
}

function getCardMeta(
  video: Pick<TabVideoSource, "duration" | "isVisible" | "primaryUrl">,
): string {
  const duration = formatDuration(video.duration);
  if (duration) {
    return duration;
  }

  if (!video.isVisible) {
    return "Hidden";
  }

  return video.primaryUrl ? "Detected" : "Media";
}

function formatDuration(duration: number | null | undefined): string | null {
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) {
    return null;
  }

  const totalSeconds = Math.round(duration);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
