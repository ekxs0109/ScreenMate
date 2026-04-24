import type { TabVideoSource } from "../background";
import type { HostRoomSnapshot } from "../background/host-room-snapshot";
import { getPopupViewModel } from "./view-model";
import type { ExtensionMockState } from "./mock-state";
import type { ExtensionSceneModel, SniffTabSummary } from "./scene-model";

type BusyAction = "primary" | "stop" | null;

export function buildExtensionSceneModel(input: {
  snapshot: HostRoomSnapshot;
  sniffTabs?: SniffTabSummary[];
  videos: TabVideoSource[];
  selectedVideoId: string | null;
  isBusy: boolean;
  busyAction: BusyAction;
  viewerRoomUrl: string | null;
  mock: ExtensionMockState;
}): ExtensionSceneModel {
  const viewModel = getPopupViewModel(input.snapshot);
  const hasShared =
    input.snapshot.roomId !== null && input.snapshot.roomLifecycle !== "closed";
  const sniffCards = input.videos.map((video, index) =>
    buildSniffCard(video, index, input.selectedVideoId),
  );

  return {
    header: {
      title: "ScreenMate",
      statusText: viewModel.statusText,
    },
    tabs: {
      active: hasShared || input.mock.activeTab !== "chat" ? input.mock.activeTab : "source",
      hasShared,
    },
    sourceTab: {
      activeSourceType: input.mock.activeSourceType,
      screenReady: input.mock.screenReady,
      uploadReady: input.mock.uploadReady,
      isRefreshing: input.mock.isRefreshing,
      sectionKinds: ["sniff", "screen", "upload"],
      sniffCards,
      sniffGroups: groupSniffCards(input.sniffTabs ?? [], sniffCards),
    },
    roomTab: {
      roomId: input.snapshot.roomId,
      shareUrl: input.viewerRoomUrl,
      viewerCount: input.snapshot.viewerCount,
      viewerDetails: input.mock.viewerDetails,
      passwordDraft: input.mock.passwordDraft,
      passwordSaved: input.mock.passwordSaved,
    },
    chatTab: {
      messages: input.mock.messages,
    },
    footer: {
      primaryLabel:
        input.isBusy && input.busyAction === "primary"
          ? "Working..."
          : viewModel.primaryActionLabel,
      primaryDisabled: input.isBusy || input.selectedVideoId === null,
      secondaryLabel:
        input.isBusy && input.busyAction === "stop" ? "Stopping room..." : "End Share",
      secondaryDisabled: input.isBusy || !viewModel.canStop,
    },
    meta: {
      hasSelectedSource: input.selectedVideoId !== null,
      isBusy: input.isBusy,
      busyAction: input.busyAction,
      message: input.snapshot.message,
    },
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
