import { browser } from "wxt/browser";
import { storage } from "wxt/utils/storage";
import { useEffect, useRef, useState } from "react";
import type { RoomChatMessage, ViewerRosterEntry } from "@screenmate/shared";
import type { HostMessage, TabVideoSource } from "../background";
import {
  createHostRoomSnapshot,
  type HostRoomLifecycle,
  type HostRoomSnapshot,
  type HostSourceState,
} from "../background/host-room-snapshot";
import {
  createEmptyVideoSniffState,
  type VideoSniffState,
} from "../background/video-source-cache";
import { createLogger } from "../../lib/logger";

const popupLogger = createLogger("popup");
const MANUAL_REFRESH_SPINNER_MIN_MS = 650;

type BusyAction = "primary" | "stop" | null;
type SniffTabSummary = {
  tabId: number;
  title?: string;
};
type SyncOptions = {
  minimumRefreshingMs?: number;
};

const ROOM_LIFECYCLES = new Set<HostRoomLifecycle>([
  "idle",
  "opening",
  "open",
  "degraded",
  "closed",
]);

const SOURCE_STATES = new Set<HostSourceState>([
  "unattached",
  "attaching",
  "attached",
  "recovering",
  "missing",
]);

export type PopupLogger = Pick<
  ReturnType<typeof createLogger>,
  "error" | "info" | "warn"
>;

export function buildSnapshotRequest(): Extract<
  HostMessage,
  { type: "screenmate:get-room-session" }
> {
  return { type: "screenmate:get-room-session" };
}

export function buildStartSharingRequests(
  snapshot: HostRoomSnapshot,
  selectedVideo: Pick<TabVideoSource, "tabId" | "frameId" | "id">,
): Array<
  | Extract<HostMessage, { type: "screenmate:start-room" }>
  | Extract<HostMessage, { type: "screenmate:attach-source" }>
> {
  const attachRequest: Extract<HostMessage, { type: "screenmate:attach-source" }> = {
    type: "screenmate:attach-source",
    tabId: selectedVideo.tabId,
    frameId: selectedVideo.frameId,
    videoId: selectedVideo.id,
  };

  if (snapshot.roomId && snapshot.roomLifecycle !== "closed") {
    return [attachRequest];
  }

  return [
    {
      type: "screenmate:start-room",
      tabId: selectedVideo.tabId,
      frameId: selectedVideo.frameId,
    },
    attachRequest,
  ];
}

export function buildStopSharingRequest(): Extract<
  HostMessage,
  { type: "screenmate:stop-room" }
> {
  return { type: "screenmate:stop-room" };
}

export function buildSendChatMessageRequest(
  text: string,
): Extract<HostMessage, { type: "screenmate:send-chat-message" }> {
  return { type: "screenmate:send-chat-message", text };
}

export function useHostControls({
  persistedSelectedVideoId,
  onSelectedVideoChange,
}: {
  persistedSelectedVideoId?: string | null;
  onSelectedVideoChange?: (selectedVideoId: string | null) => void;
} = {}) {
  const [snapshot, setSnapshot] = useState<HostRoomSnapshot>(
    createHostRoomSnapshot(),
  );
  const [videos, setVideos] = useState<TabVideoSource[]>([]);
  const [sniffTabs, setSniffTabs] = useState<SniffTabSummary[]>([]);
  const [selectedVideoKey, setSelectedVideoKeyState] = useState<string | null>(
    persistedSelectedVideoId ?? null,
  );
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [isSniffRefreshing, setIsSniffRefreshing] = useState(false);
  const [isManualRefreshPending, setIsManualRefreshPending] = useState(false);
  const refreshVideosRef = useRef<
    (options?: SyncOptions) => Promise<void>
  >(
    async () => {},
  );
  const selectedVideoKeyRef = useRef<string | null>(
    persistedSelectedVideoId ?? null,
  );
  const desiredSelectedVideoKeyRef = useRef<string | null>(
    persistedSelectedVideoId ?? null,
  );

  const setSelectedVideoKey = (
    nextSelectedVideoKey: string | null,
    options: { persist?: boolean } = {},
  ) => {
    selectedVideoKeyRef.current = nextSelectedVideoKey;
    setSelectedVideoKeyState(nextSelectedVideoKey);
    if (options.persist !== false) {
      desiredSelectedVideoKeyRef.current = nextSelectedVideoKey;
      onSelectedVideoChange?.(nextSelectedVideoKey);
    }
  };

  useEffect(() => {
    if (typeof persistedSelectedVideoId === "undefined") {
      return;
    }

    desiredSelectedVideoKeyRef.current = persistedSelectedVideoId;
    if (videos.length === 0) {
      return;
    }

    const nextSelectedVideoKey = resolvePopupSelectedVideoKey({
      currentSelectedVideoKey: selectedVideoKeyRef.current,
      desiredSelectedVideoKey: persistedSelectedVideoId,
      videos,
    });

    if (nextSelectedVideoKey !== selectedVideoKeyRef.current) {
      setSelectedVideoKey(nextSelectedVideoKey, { persist: false });
    }
  }, [persistedSelectedVideoId, videos]);

  useEffect(() => {
    let isCancelled = false;
    const videoSniffStateStorage = createVideoSniffStateStorage();

    const syncSnapshot = () =>
      browser.runtime
        .sendMessage(buildSnapshotRequest())
        .then((nextSnapshot) => {
          if (!isCancelled) {
            const normalizedSnapshot = normalizeSnapshot(nextSnapshot);
            popupLogger.debug("Synced host room snapshot.", normalizedSnapshot);
            setSnapshot(normalizedSnapshot);
          }
        })
        .catch(() => {
          if (!isCancelled) {
            setSnapshot((current) =>
              createHostRoomSnapshot({
                ...current,
                message: "Could not load popup state.",
              }),
            );
          }
        });

    const applyVideoSniffState = (nextState: unknown) => {
      if (isCancelled) {
        return;
      }

      const normalizedState = normalizeVideoSniffState(nextState);
      const normalizedVideos = normalizeVideos(normalizedState.videos);
      const normalizedTabs = normalizeSniffTabs(normalizedState.tabs);
      popupLogger.debug("Synced video sniff state.", {
        selectedVideoId: selectedVideoKeyRef.current,
        status: normalizedState.status,
        tabCount: normalizedTabs.length,
        totalVideos: normalizedVideos.length,
        updatedAt: normalizedState.updatedAt,
      });

      setSniffTabs(normalizedTabs);
      setVideos(normalizedVideos);
      setIsSniffRefreshing(
        normalizedState.status === "refreshing" || normalizedState.isScanning,
      );

      const desiredSelectedVideoKey = desiredSelectedVideoKeyRef.current;
      const currentSelectedVideoKey =
        desiredSelectedVideoKey ?? selectedVideoKeyRef.current;
      const nextSelectedVideoKey = resolvePopupSelectedVideoKey({
        currentSelectedVideoKey,
        desiredSelectedVideoKey,
        videos: normalizedVideos,
      });
      const shouldPersistResolvedSelection =
        nextSelectedVideoKey === desiredSelectedVideoKey;

      setSelectedVideoKey(nextSelectedVideoKey, {
        persist: shouldPersistResolvedSelection,
      });
    };

    const syncCachedVideoSniffState = () =>
      videoSniffStateStorage
        .getValue()
        .then(applyVideoSniffState)
        .catch((error) => {
          popupLogger.warn("Could not read cached video sniff state.", {
            error: error instanceof Error ? error.message : String(error),
          });
        });

    const ensureVideoSniffState = () =>
      browser.runtime
        .sendMessage({ type: "screenmate:ensure-video-sniff-state" })
        .then(applyVideoSniffState)
        .catch((error) => {
          popupLogger.warn("Could not ensure video sniff state.", {
            error: error instanceof Error ? error.message : String(error),
          });
        });

    const refreshVideos = async (options: SyncOptions = {}) => {
      const startedAt = Date.now();
      setIsManualRefreshPending(true);
      try {
        const nextState = await browser.runtime.sendMessage({
          type: "screenmate:refresh-video-sniff-state",
        });
        applyVideoSniffState(nextState);
      } catch (error) {
        popupLogger.warn("Could not refresh video sniff state.", {
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        await waitForMinimumRefreshDuration({
          elapsedMs: Date.now() - startedAt,
          minimumMs: options.minimumRefreshingMs ?? 0,
        });
        if (!isCancelled) {
          setIsManualRefreshPending(false);
        }
      }
    };
    refreshVideosRef.current = refreshVideos;

    const handleTabActivated = () => {
      popupLogger.info("Active tab changed. Ensuring popup state.");
      void syncSnapshot();
      void ensureVideoSniffState();
    };

    const handleTabUpdated = (
      _tabId: number,
      changeInfo: { status?: string },
      tab: { active?: boolean },
    ) => {
      if (!tab.active || changeInfo.status !== "complete") {
        return;
      }

      popupLogger.info("Tab updated. Ensuring popup state.");
      void syncSnapshot();
      void ensureVideoSniffState();
    };

    const handleMessage = (message: unknown) => {
      if (!isRecord(message)) {
        return;
      }

      if (message.type === "screenmate:content-ready") {
        popupLogger.debug("Received content notification. Waiting for sniff state storage update.", {
          type: message.type,
        });
        return;
      }

      if (message.type === "screenmate:source-detached") {
        popupLogger.info("Received source detach notification. Refreshing room snapshot.", {
          type: message.type,
        });
        void syncSnapshot();
      }

      if (message.type === "screenmate:room-snapshot-updated") {
        popupLogger.debug("Received room activity notification. Refreshing room snapshot.", {
          type: message.type,
        });
        void syncSnapshot();
      }
    };

    const unwatchVideoSniffState = videoSniffStateStorage.watch((nextState) => {
      applyVideoSniffState(nextState);
    });

    void syncSnapshot();
    void syncCachedVideoSniffState().then(() => {
      void ensureVideoSniffState();
    });
    browser.tabs.onActivated.addListener(handleTabActivated);
    browser.tabs.onUpdated.addListener(handleTabUpdated);
    browser.runtime.onMessage.addListener(handleMessage);

    return () => {
      isCancelled = true;
      unwatchVideoSniffState();
      browser.tabs.onActivated.removeListener(handleTabActivated);
      browser.tabs.onUpdated.removeListener(handleTabUpdated);
      browser.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  useEffect(() => {
    return () => {
      void browser.runtime
        .sendMessage({ type: "screenmate:clear-preview" })
        .catch(() => {
          popupLogger.warn("Could not clear page preview on popup cleanup.");
        });
    };
  }, []);

  const startOrAttach = async () => {
    const selectedVideo = videos.find(
      (video) => getVideoSelectionKey(video) === selectedVideoKey,
    );
    const requests = selectedVideo
      ? buildStartSharingRequests(snapshot, selectedVideo)
      : [];

    popupLogger.info("Room action requested.", {
      selectedVideoKey,
    });

    if (!selectedVideo) {
      setSnapshot((current) =>
        createHostRoomSnapshot({
          ...current,
          message: "No video elements found on this page.",
        }),
      );
      return;
    }

    setBusyAction("primary");
    setSnapshot((current) =>
      createHostRoomSnapshot({
        ...current,
        roomLifecycle:
          current.roomId !== null && current.roomLifecycle !== "closed"
            ? current.roomLifecycle
            : "opening",
        sourceState:
          current.roomId !== null && current.roomLifecycle !== "closed"
            ? "attaching"
            : current.sourceState,
        activeFrameId: selectedVideo.frameId,
        message: null,
      }),
    );

    try {
      for (const request of requests) {
        const response = await browser.runtime.sendMessage(request);
        const nextSnapshot = normalizeSnapshot(response);

        reportRoomActionResult(popupLogger, nextSnapshot, response);
        setSnapshot(nextSnapshot);

        if (
          request.type === "screenmate:start-room" &&
          (nextSnapshot.roomId === null ||
            nextSnapshot.roomLifecycle === "closed")
        ) {
          return;
        }
      }
    } catch (error) {
      popupLogger.error("Room action runtime request failed.", {
        error: error instanceof Error ? error.message : String(error),
      });
      setSnapshot((current) =>
        createHostRoomSnapshot({
          ...current,
          message:
            error instanceof Error && error.message
              ? error.message
              : "Could not update the room in the active tab.",
        }),
      );
    } finally {
      setBusyAction(null);
    }
  };

  const previewVideo = (videoKey: string) => {
    const previewVideo = videos.find(
      (video) => getVideoSelectionKey(video) === videoKey,
    );

    if (!previewVideo) {
      return;
    }

    void browser.runtime
      .sendMessage({
        type: "screenmate:preview-video",
        tabId: previewVideo.tabId,
        frameId: previewVideo.frameId,
        label: previewVideo.label,
        videoId: previewVideo.id,
      } satisfies Extract<HostMessage, { type: "screenmate:preview-video" }>)
      .catch(() => {
        popupLogger.warn("Could not update page preview selection.");
      });
  };

  const clearVideoPreview = () => {
    void browser.runtime
      .sendMessage({ type: "screenmate:clear-preview" })
      .catch(() => {
        popupLogger.warn("Could not clear page preview.");
      });
  };

  const stopRoom = async () => {
    setBusyAction("stop");

    try {
      const nextSnapshot = normalizeSnapshot(
        await browser.runtime.sendMessage(buildStopSharingRequest()),
      );
      popupLogger.info("Stop room returned a snapshot.", {
        message: nextSnapshot.message,
        roomId: nextSnapshot.roomId,
        roomLifecycle: nextSnapshot.roomLifecycle,
        sourceState: nextSnapshot.sourceState,
      });
      setSnapshot(nextSnapshot);
    } catch {
      setSnapshot((current) =>
        createHostRoomSnapshot({
          ...current,
          message: "Could not stop the room in the active tab.",
        }),
      );
    } finally {
      setBusyAction(null);
    }
  };

  const sendChatMessage = async (text: string) => {
    try {
      const response = await browser.runtime.sendMessage(
        buildSendChatMessageRequest(text),
      );

      if (isRecord(response) && "snapshot" in response) {
        setSnapshot(normalizeSnapshot(response.snapshot));
      }

      return isRecord(response) && response.ok === true;
    } catch (error) {
      popupLogger.warn("Could not send room chat message.", {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  };

  return {
    snapshot,
    sniffTabs,
    videos,
    selectedVideoId: selectedVideoKey,
    setSelectedVideoId: (nextSelectedVideoKey: string | null) => {
      setSelectedVideoKey(nextSelectedVideoKey, { persist: true });
    },
    refreshVideos: () =>
      refreshVideosRef.current({
        minimumRefreshingMs: MANUAL_REFRESH_SPINNER_MIN_MS,
      }),
    previewVideo,
    clearVideoPreview,
    startOrAttach,
    stopRoom,
    sendChatMessage,
    isBusy: busyAction !== null,
    busyAction,
    isRefreshing: isSniffRefreshing || isManualRefreshPending,
  };
}

function createVideoSniffStateStorage() {
  return storage.defineItem<VideoSniffState>(
    "session:screenmate-video-sniff-state",
    {
      fallback: createEmptyVideoSniffState(),
    },
  );
}

export function normalizeSnapshot(value: unknown): HostRoomSnapshot {
  if (!value || typeof value !== "object") {
    return createHostRoomSnapshot();
  }

  const candidate = value as Partial<HostRoomSnapshot>;

  return createHostRoomSnapshot({
    roomLifecycle: ROOM_LIFECYCLES.has(candidate.roomLifecycle as HostRoomLifecycle)
      ? (candidate.roomLifecycle as HostRoomLifecycle)
      : "idle",
    sourceState: SOURCE_STATES.has(candidate.sourceState as HostSourceState)
      ? (candidate.sourceState as HostSourceState)
      : "unattached",
    roomId: typeof candidate.roomId === "string" ? candidate.roomId : null,
    viewerCount:
      typeof candidate.viewerCount === "number" ? candidate.viewerCount : 0,
    viewerRoster: Array.isArray(candidate.viewerRoster)
      ? candidate.viewerRoster.filter(isViewerRosterEntry)
      : [],
    chatMessages: Array.isArray(candidate.chatMessages)
      ? candidate.chatMessages.filter(isRoomChatMessage)
      : [],
    sourceLabel:
      typeof candidate.sourceLabel === "string" ? candidate.sourceLabel : null,
    activeTabId:
      typeof candidate.activeTabId === "number" ? candidate.activeTabId : null,
    activeFrameId:
      typeof candidate.activeFrameId === "number"
        ? candidate.activeFrameId
        : null,
    recoverByTimestamp:
      typeof candidate.recoverByTimestamp === "number"
        ? candidate.recoverByTimestamp
        : null,
    message: typeof candidate.message === "string" ? candidate.message : null,
  });
}

function isViewerRosterEntry(value: unknown): value is ViewerRosterEntry {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.viewerSessionId === "string" &&
    value.viewerSessionId.length > 0 &&
    typeof value.displayName === "string" &&
    value.displayName.length > 0 &&
    typeof value.online === "boolean" &&
    (value.connectionType === "direct" ||
      value.connectionType === "relay" ||
      value.connectionType === "unknown") &&
    (typeof value.pingMs === "number" || value.pingMs === null) &&
    typeof value.joinedAt === "number" &&
    (typeof value.profileUpdatedAt === "number" ||
      value.profileUpdatedAt === null) &&
    (typeof value.metricsUpdatedAt === "number" ||
      value.metricsUpdatedAt === null)
  );
}

function isRoomChatMessage(value: unknown): value is RoomChatMessage {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.messageId === "string" &&
    value.messageId.length > 0 &&
    typeof value.senderSessionId === "string" &&
    value.senderSessionId.length > 0 &&
    (value.senderRole === "host" || value.senderRole === "viewer") &&
    typeof value.senderName === "string" &&
    value.senderName.length > 0 &&
    typeof value.text === "string" &&
    value.text.length > 0 &&
    typeof value.sentAt === "number"
  );
}

function normalizeVideos(value: unknown): TabVideoSource[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (item): item is TabVideoSource =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as TabVideoSource).id === "string" &&
        typeof (item as TabVideoSource).label === "string" &&
        typeof (item as TabVideoSource).tabId === "number" &&
        typeof (item as TabVideoSource).frameId === "number",
    )
    .map((item) => ({
      id: item.id,
      label: item.label,
      primaryUrl: typeof item.primaryUrl === "string" ? item.primaryUrl : null,
      posterUrl: typeof item.posterUrl === "string" ? item.posterUrl : null,
      thumbnailUrl:
        typeof item.thumbnailUrl === "string" ? item.thumbnailUrl : null,
      width: typeof item.width === "number" ? item.width : null,
      height: typeof item.height === "number" ? item.height : null,
      duration: typeof item.duration === "number" ? item.duration : null,
      format: typeof item.format === "string" ? item.format : null,
      isVisible: item.isVisible !== false,
      tabId: item.tabId,
      tabTitle: typeof item.tabTitle === "string" ? item.tabTitle : undefined,
      frameId: item.frameId,
    }));
}

function normalizeVideoSniffState(value: unknown): VideoSniffState {
  const fallback = createEmptyVideoSniffState();
  if (!isRecord(value)) {
    return fallback;
  }

  const status =
    value.status === "idle" ||
    value.status === "refreshing" ||
    value.status === "success" ||
    value.status === "error"
      ? value.status
      : value.isScanning === true
        ? "refreshing"
        : fallback.status;

  return {
    tabs: Array.isArray(value.tabs) ? normalizeSniffTabs(value.tabs) : [],
    videos: Array.isArray(value.videos) ? normalizeVideos(value.videos) : [],
    status,
    isScanning: value.isScanning === true || status === "refreshing",
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : null,
    startedAt: typeof value.startedAt === "number" ? value.startedAt : null,
    refreshId: typeof value.refreshId === "string" ? value.refreshId : null,
    error: typeof value.error === "string" ? value.error : null,
  };
}

function normalizeSniffTabs(value: unknown): SniffTabSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (item): item is SniffTabSummary =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as SniffTabSummary).tabId === "number",
    )
    .map((tab) => ({
      tabId: tab.tabId,
      title: typeof tab.title === "string" ? tab.title : undefined,
    }));
}

export function resolveSelectedVideoKey(
  selectedVideoKey: string | null | undefined,
  videos: Array<Pick<TabVideoSource, "id" | "tabId" | "frameId">>,
) {
  if (
    selectedVideoKey &&
    videos.some((video) => getVideoSelectionKey(video) === selectedVideoKey)
  ) {
    return selectedVideoKey;
  }

  return videos[0] ? getVideoSelectionKey(videos[0]) : null;
}

export function resolvePopupSelectedVideoKey({
  currentSelectedVideoKey,
  desiredSelectedVideoKey,
  videos,
}: {
  currentSelectedVideoKey: string | null | undefined;
  desiredSelectedVideoKey: string | null | undefined;
  videos: Array<Pick<TabVideoSource, "id" | "tabId" | "frameId">>;
}) {
  if (
    desiredSelectedVideoKey &&
    !videos.some((video) => getVideoSelectionKey(video) === desiredSelectedVideoKey)
  ) {
    return desiredSelectedVideoKey;
  }

  return resolveSelectedVideoKey(
    desiredSelectedVideoKey ?? currentSelectedVideoKey,
    videos,
  );
}

export async function waitForMinimumRefreshDuration({
  elapsedMs,
  minimumMs,
  sleep = sleepMs,
}: {
  elapsedMs: number;
  minimumMs: number;
  sleep?: (durationMs: number) => Promise<void>;
}) {
  const remainingMs = minimumMs - elapsedMs;
  if (remainingMs <= 0) {
    return;
  }

  await sleep(remainingMs);
}

function sleepMs(durationMs: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
}

export function shouldRetryEmptyVideoList({
  retryCount,
  retryLimit,
  scannableTabCount,
}: {
  retryCount: number;
  retryLimit: number;
  scannableTabCount: number;
}) {
  return scannableTabCount > 0 && retryCount < retryLimit;
}

export function shouldRunQueuedSync({
  currentForceRefresh,
  hasQueuedSync,
  queuedForceRefresh,
}: {
  currentForceRefresh: boolean;
  hasQueuedSync: boolean;
  queuedForceRefresh: boolean;
}) {
  if (!hasQueuedSync) {
    return false;
  }

  if (currentForceRefresh) {
    return false;
  }

  return queuedForceRefresh;
}

function getVideoSelectionKey(
  video: Pick<TabVideoSource, "id" | "tabId" | "frameId">,
): string {
  return `${video.tabId}:${video.frameId}:${video.id}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function reportRoomActionResult(
  logger: PopupLogger,
  normalizedSnapshot: HostRoomSnapshot,
  rawSnapshot: unknown,
) {
  const details = {
    message: normalizedSnapshot.message,
    normalizedSnapshot,
    rawSnapshot,
    roomId: normalizedSnapshot.roomId,
    roomLifecycle: normalizedSnapshot.roomLifecycle,
    sourceLabel: normalizedSnapshot.sourceLabel,
    sourceState: normalizedSnapshot.sourceState,
  };

  if (normalizedSnapshot.message && normalizedSnapshot.sourceState !== "attached") {
    logger.error("Room action returned an error snapshot.", details);
    return;
  }

  logger.info("Room action returned a snapshot.", details);
}
