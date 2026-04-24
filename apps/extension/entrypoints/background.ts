import { browser, type Browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { storage } from "wxt/utils/storage";
import { getScreenMateApiBaseUrl } from "../lib/config";
import { createLogger } from "../lib/logger";
import {
  requestRoomCreation,
  type RoomCreateResponse,
} from "../lib/room-api";
import {
  createHostRoomRuntime,
  type HostRoomRuntime,
  type SignalEnvelope,
} from "./background/host-room-runtime";
import {
  createHostRoomSnapshot,
  type HostRoomSnapshot,
  type SourceFingerprint,
} from "./background/host-room-snapshot";
import {
  createEmptyVideoSniffState,
  VideoSourceCache,
  type SniffTabSummary,
  type VideoSniffState,
} from "./background/video-source-cache";
import type { VideoSource as LocalVideoSource } from "./content/video-detector";

type SourceFingerprintMatch = Omit<SourceFingerprint, "frameId" | "tabId">;

export type HostMessage =
  | { type: "screenmate:get-room-session" }
  | { type: "screenmate:list-videos"; refresh?: boolean }
  | { type: "screenmate:get-video-sniff-state" }
  | { type: "screenmate:ensure-video-sniff-state" }
  | { type: "screenmate:refresh-video-sniff-state" }
  | { type: "screenmate:start-room"; frameId: number; tabId?: number }
  | {
      type: "screenmate:attach-source";
      videoId: string;
      frameId: number;
      tabId?: number;
    }
  | { type: "screenmate:stop-room" }
  | {
      type: "screenmate:content-ready";
      frameId: number;
      tabId?: number | null;
      videos: TabVideoSource[];
    }
  | {
      type: "screenmate:source-detached";
      frameId: number;
      tabId?: number | null;
      reason: "track-ended" | "content-invalidated" | "manual-detach";
    }
  | {
      type: "screenmate:signal-outbound";
      envelope: Record<string, unknown>;
      frameId?: number | null;
      tabId?: number | null;
    }
  | {
      type: "screenmate:signal-inbound";
      envelope: Record<string, unknown>;
      frameId: number;
    }
  | {
      type: "screenmate:preview-video";
      videoId: string;
      frameId: number;
      tabId?: number;
      label: string;
      active?: boolean;
    }
  | { type: "screenmate:clear-preview"; tabId?: number };

export type TabVideoSource = LocalVideoSource & {
  tabId: number;
  frameId: number;
  tabTitle?: string;
  fingerprint?: SourceFingerprintMatch;
};

export type PreviewAck = { ok: true };
export type InternalHostNetworkMessage = {
  type: "screenmate:create-room";
  apiBaseUrl: string;
};
export type InternalHostNetworkErrorResponse = {
  error: string;
};

type AttachSourceResponse = {
  sourceLabel: string;
  fingerprint: SourceFingerprintMatch;
};

type TabContentMessage =
  | Extract<HostMessage, { type: "screenmate:list-videos" }>
  | Extract<HostMessage, { type: "screenmate:preview-video" }>
  | Extract<HostMessage, { type: "screenmate:clear-preview" }>
  | { type: "screenmate:detach-source" }
  | {
      type: "screenmate:attach-source";
      videoId: string;
      roomSession: NonNullable<ReturnType<HostRoomRuntime["getAttachSession"]>>;
    }
  | {
      type: "screenmate:update-ice-servers";
      iceServers: RTCIceServer[];
    }
  | {
      type: "screenmate:signal-inbound";
      envelope: SignalEnvelope;
    };

type HandlerResponse =
  | HostRoomSnapshot
  | TabVideoSource[]
  | VideoSniffState
  | PreviewAck;
type TabMessageResponse =
  | LocalVideoSource[]
  | AttachSourceResponse
  | PreviewAck
  | undefined;
type InternalHostNetworkResponse =
  | RoomCreateResponse
  | InternalHostNetworkErrorResponse;

const backgroundLogger = createLogger("background");
const VIDEO_SNIFF_AUTO_REFRESH_TTL_MS = 30_000;
const VIDEO_SNIFF_STUCK_REFRESH_MS = 60_000;
type HostMessageHandlerDependencies = {
  apiBaseUrl?: string;
  createRoom: (apiBaseUrl: string) => Promise<InternalHostNetworkResponse>;
  queryActiveTabId: () => Promise<number | null>;
  queryCurrentWindowTabs?: () => Promise<
    Array<{ id: number; title?: string; url?: string }>
  >;
  queryFrameIds: (tabId: number) => Promise<number[]>;
  runtime: HostRoomRuntime;
  videoCache?: VideoSourceCache;
  videoListScanPromise?: Promise<TabVideoSource[]> | null;
  sendTabMessage: (
    tabId: number,
    message: TabContentMessage,
    options?: { frameId?: number },
  ) => Promise<TabMessageResponse>;
  forwardInboundSignal: (envelope: SignalEnvelope) => void;
};

type InternalHostNetworkHandlerDependencies = {
  fetchImpl: typeof fetch;
};

export function createHostMessageHandler(
  dependencies: HostMessageHandlerDependencies,
) {
  const apiBaseUrl = dependencies.apiBaseUrl ?? getScreenMateApiBaseUrl();

  return async (message: unknown): Promise<HandlerResponse | undefined> => {
    if (!isHostMessage(message)) {
      return undefined;
    }

    if (message.type === "screenmate:get-room-session") {
      return dependencies.runtime.getSnapshot();
    }

    if (message.type === "screenmate:stop-room") {
      await detachCurrentAttachmentOwner(dependencies);
      return dependencies.runtime.close("Room closed.");
    }

    if (message.type === "screenmate:source-detached") {
      const snapshot = dependencies.runtime.getSnapshot();
      if (!isCurrentAttachmentOwner(snapshot, message)) {
        return snapshot;
      }

      return dependencies.runtime.markRecovering(message.reason);
    }

    if (message.type === "screenmate:signal-outbound") {
      const snapshot = dependencies.runtime.getSnapshot();
      if (!isCurrentAttachmentOwner(snapshot, message)) {
        return { ok: true };
      }

      dependencies.runtime.sendSignal(message.envelope);
      return { ok: true };
    }

    const requestedTabId =
      "tabId" in message && typeof message.tabId === "number"
        ? message.tabId
        : null;
    if (message.type === "screenmate:get-video-sniff-state") {
      return getVideoSniffState(dependencies);
    }

    if (message.type === "screenmate:ensure-video-sniff-state") {
      const fallbackTabId = requestedTabId ?? await dependencies.queryActiveTabId();
      return ensureVideoSniffState(dependencies, fallbackTabId);
    }

    if (message.type === "screenmate:refresh-video-sniff-state") {
      const fallbackTabId = requestedTabId ?? await dependencies.queryActiveTabId();
      return refreshVideoSniffState(dependencies, fallbackTabId);
    }

    if (message.type === "screenmate:list-videos") {
      const fallbackTabId = requestedTabId ?? await dependencies.queryActiveTabId();
      return listVideosAcrossTabs(
        dependencies,
        fallbackTabId,
        message.refresh === true,
      );
    }

    const tabId =
      message.type === "screenmate:content-ready"
        ? requestedTabId ?? dependencies.runtime.getSnapshot().activeTabId
        : requestedTabId ?? await dependencies.queryActiveTabId();
    if (tabId === null) {
      if (
        message.type === "screenmate:preview-video" ||
        message.type === "screenmate:clear-preview" ||
        message.type === "screenmate:signal-inbound"
      ) {
        return { ok: true };
      }

      return createHostRoomSnapshot({
        message: "Could not find an active tab to continue.",
      });
    }

    if (message.type === "screenmate:preview-video") {
      return broadcastPreviewToTab(dependencies, tabId, message);
    }

    if (message.type === "screenmate:clear-preview") {
      return broadcastMessageToTab(dependencies, tabId, message);
    }

    if (message.type === "screenmate:start-room") {
      const roomResponse = await dependencies.createRoom(apiBaseUrl);
      if (!isRoomCreateResponse(roomResponse)) {
        return createHostRoomSnapshot({
          message: roomResponse.error,
        });
      }

      const snapshot = await dependencies.runtime.startRoom({
        roomId: roomResponse.roomId,
        hostSessionId: roomResponse.hostSessionId ?? "host",
        hostToken: roomResponse.hostToken,
        signalingUrl: roomResponse.signalingUrl,
        iceServers: roomResponse.iceServers ?? [],
        turnCredentialExpiresAt: roomResponse.turnCredentialExpiresAt ?? null,
        activeTabId: tabId,
        activeFrameId: message.frameId,
        viewerSessionIds: [],
        viewerCount: 0,
        sourceFingerprint: null,
        recoverByTimestamp: null,
      });
      await dependencies.runtime.connectSignaling(dependencies.forwardInboundSignal);
      return snapshot;
    }

    if (message.type === "screenmate:attach-source") {
      return attachSourceInFrame(dependencies, tabId, message);
    }

    if (message.type === "screenmate:content-ready") {
      if (typeof message.tabId === "number") {
        await getVideoCache(dependencies).setForFrame(
          message.tabId,
          message.frameId,
          message.videos.map((video) => ({
            ...video,
            frameId: message.frameId,
            tabId: message.tabId as number,
          })),
        );
      }
      return maybeReattachSource(dependencies, tabId, message);
    }

    if (message.type === "screenmate:signal-inbound") {
      await dependencies.sendTabMessage(
        tabId,
        {
          type: "screenmate:signal-inbound",
          envelope: message.envelope as SignalEnvelope,
        },
        { frameId: message.frameId },
      );
      return { ok: true };
    }

    return undefined;
  };
}

export function createHostRuntimeMessageListener(
  handler: ReturnType<typeof createHostMessageHandler>,
  internalHandler: ReturnType<typeof createInternalHostNetworkHandler>,
) {
  return (
    message: unknown,
    sender: Browser.runtime.MessageSender,
    sendResponse: (
      response?:
        | HandlerResponse
        | InternalHostNetworkResponse
        | HostRoomSnapshot,
    ) => void,
  ) => {
    const internalResult = internalHandler(message);

    if (internalResult !== undefined) {
      void Promise.resolve(internalResult)
        .then((response) => {
          sendResponse(response);
        })
        .catch((error) => {
          backgroundLogger.error("Internal network handler failed.", {
            error: toErrorMessage(error),
            message,
          });
          sendResponse({
            error: `Background network handler failed: ${toErrorMessage(error)}`,
          });
        });

      return true;
    }

    const normalizedMessage = normalizeIncomingFrameMessage(message, sender);
    const result = handler(normalizedMessage);

    if (result === undefined) {
      return undefined;
    }

    void Promise.resolve(result)
      .then((response) => {
        sendResponse(response);
      })
      .catch((error) => {
        backgroundLogger.error("Runtime message handler failed.", {
          error: toErrorMessage(error),
          message: normalizedMessage,
        });
        sendResponse(
          createHostRoomSnapshot({
            message: `Background handler failed: ${toErrorMessage(error)}`,
          }),
        );
      });

    return true;
  };
}

export default defineBackground(() => {
  const apiBaseUrl = getScreenMateApiBaseUrl();
  const runtime = createHostRoomRuntime({
    apiBaseUrl,
    storage: browser.storage.session,
  });
  const videoSniffStateStorage = storage.defineItem<VideoSniffState>(
    "session:screenmate-video-sniff-state",
    {
      fallback: createEmptyVideoSniffState(),
    },
  );
  const videoCache = new VideoSourceCache(videoSniffStateStorage);
  const internalHandler = createInternalHostNetworkHandler({
    fetchImpl: fetch,
  });
  const forwardInboundSignal = createForwardInboundSignalHandler({
    runtime,
    sendTabMessage(tabId, message, options) {
      return browser.tabs.sendMessage(
        tabId,
        message,
        options,
      ) as Promise<TabMessageResponse>;
    },
  });
  const handler = createHostMessageHandler({
    apiBaseUrl,
    createRoom: async (requestedApiBaseUrl) => {
      return (
        (await internalHandler({
          type: "screenmate:create-room",
          apiBaseUrl: requestedApiBaseUrl,
        })) ?? {
          error: "Background room creation handler was unavailable.",
        }
      );
    },
    queryActiveTabId: async () => {
      const [tab] = await browser.tabs.query({
        active: true,
        lastFocusedWindow: true,
        windowType: "normal",
      });

      return tab?.id ?? null;
    },
    queryCurrentWindowTabs: async () => {
      const tabs = await browser.tabs.query({
        windowType: "normal",
      });

      return tabs
        .filter((tab): tab is Browser.tabs.Tab & { id: number } => typeof tab.id === "number")
        .map((tab) => ({
          id: tab.id,
          title: tab.title,
          url: tab.url,
        }));
    },
    queryFrameIds: async (tabId) => {
      const frames = (await browser.webNavigation.getAllFrames({ tabId })) ?? [];
      const frameIds = frames
        .map((frame) => frame.frameId)
        .filter((frameId): frameId is number => typeof frameId === "number");

      return frameIds.length > 0 ? frameIds : [0];
    },
    runtime,
    videoCache,
    sendTabMessage(tabId, message, options) {
      return browser.tabs.sendMessage(
        tabId,
        message,
        options,
      ) as Promise<TabMessageResponse>;
    },
    forwardInboundSignal,
  });

  void runtime
    .restoreFromStorage()
    .then(() => {
      if (!runtime.getAttachSession()) {
        return;
      }

      return runtime.connectSignaling(forwardInboundSignal);
    })
    .catch((error) => {
      backgroundLogger.error("Could not restore persisted room session.", {
        error: toErrorMessage(error),
      });
    });

  browser.runtime.onMessage.addListener(
    createHostRuntimeMessageListener(handler, internalHandler),
  );

  browser.tabs.onRemoved.addListener((tabId) => {
    void videoCache.removeTab(tabId);
  });
});

export function createInternalHostNetworkHandler(
  dependencies: InternalHostNetworkHandlerDependencies,
) {
  return (
    message: unknown,
  ): Promise<InternalHostNetworkResponse> | undefined => {
    if (!isInternalHostNetworkMessage(message)) {
      return undefined;
    }

    return (async () => {
      backgroundLogger.info("Creating room via extension background.", {
        endpoint: `${message.apiBaseUrl}/rooms`,
      });

      try {
        const response = await requestRoomCreation(
          dependencies.fetchImpl,
          message.apiBaseUrl,
        );
        backgroundLogger.info("Background room creation succeeded.", {
          roomId: response.roomId,
          signalingUrl: response.signalingUrl,
        });
        return response;
      } catch (error) {
        const formattedError = toErrorMessage(error);
        backgroundLogger.error("Background room creation failed.", {
          endpoint: `${message.apiBaseUrl}/rooms`,
          error: formattedError,
        });
        return { error: formattedError };
      }
    })();
  };
}

export function createForwardInboundSignalHandler(dependencies: {
  runtime: Pick<
    HostRoomRuntime,
    "getSnapshot" | "shouldRefreshHostIce" | "refreshHostIce"
  >;
  sendTabMessage: (
    tabId: number,
    message: TabContentMessage,
    options?: { frameId?: number },
  ) => Promise<TabMessageResponse>;
}) {
  function getActiveAttachmentTarget() {
    const snapshot = dependencies.runtime.getSnapshot();

    if (
      snapshot.sourceState !== "attached" ||
      snapshot.activeTabId === null ||
      snapshot.activeFrameId === null
    ) {
      return null;
    }

    return {
      tabId: snapshot.activeTabId,
      frameId: snapshot.activeFrameId,
    };
  }

  return async (envelope: SignalEnvelope) => {
    const initialTarget = getActiveAttachmentTarget();
    if (!initialTarget) {
      return;
    }

    if (!shouldForwardSignalToContentRuntime(envelope)) {
      return;
    }

    if (
      envelope.messageType === "viewer-joined" &&
      dependencies.runtime.shouldRefreshHostIce()
    ) {
      try {
        const refreshed = await dependencies.runtime.refreshHostIce();
        if (refreshed === null) {
          return;
        }
        const refreshedTarget = getActiveAttachmentTarget();
        if (refreshedTarget) {
          await dependencies.sendTabMessage(
            refreshedTarget.tabId,
            {
              type: "screenmate:update-ice-servers",
              iceServers: refreshed.iceServers,
            },
            { frameId: refreshedTarget.frameId },
          );
        }
      } catch (error) {
        backgroundLogger.warn("Could not refresh host ICE before forwarding.", {
          activeFrameId: initialTarget.frameId,
          activeTabId: initialTarget.tabId,
          error: toErrorMessage(error),
          messageType: envelope.messageType,
        });
      }
    }

    const target = getActiveAttachmentTarget();
    if (!target) {
      return;
    }

    try {
      await dependencies.sendTabMessage(
        target.tabId,
        {
          type: "screenmate:signal-inbound",
          envelope,
        },
        { frameId: target.frameId },
      );
    } catch (error) {
      backgroundLogger.warn("Could not forward inbound signal to content.", {
        activeFrameId: target.frameId,
        activeTabId: target.tabId,
        error: toErrorMessage(error),
        messageType: envelope.messageType,
      });
    }
  };
}

async function listVideosForTab(
  dependencies: HostMessageHandlerDependencies,
  tabId: number,
  tabTitle?: string,
): Promise<TabVideoSource[]> {
  const frameIds = await resolveFrameIds(dependencies, tabId);
  backgroundLogger.info("Scanning active tab for videos.", {
    frameIds,
    tabId,
  });
  const results = await Promise.allSettled(
    frameIds.map((frameId) =>
      dependencies.sendTabMessage(
        tabId,
        { type: "screenmate:list-videos" },
        { frameId },
      ),
    ),
  );

  const videos: TabVideoSource[] = [];
  for (const [index, result] of results.entries()) {
    if (!isFulfilledVideoList(result)) {
      backgroundLogger.warn("Could not list videos in frame.", {
        error:
          result.status === "rejected" ? toErrorMessage(result.reason) : "Invalid response",
        frameId: frameIds[index] ?? 0,
        tabId,
      });
      continue;
    }

    const frameId = frameIds[index] ?? 0;
    for (const video of result.value) {
      videos.push({
        ...video,
        label: formatFrameScopedLabel(video.label, frameId),
        tabId,
        ...(tabTitle !== undefined && { tabTitle }),
        frameId,
      });
    }
  }

  backgroundLogger.info("Finished scanning tab for videos.", {
    frameCount: frameIds.length,
    tabId,
    videoCount: videos.length,
  });

  return videos;
}

async function listVideosAcrossTabs(
  dependencies: HostMessageHandlerDependencies,
  activeTabId: number | null,
  forceRefresh: boolean,
): Promise<TabVideoSource[]> {
  const videoCache = getVideoCache(dependencies);
  await videoCache.restore();
  const cachedVideos = videoCache.getAll();
  if (!forceRefresh && cachedVideos.length > 0) {
    backgroundLogger.info("Returning cached videos.", { count: cachedVideos.length });
    return cachedVideos;
  }

  if (dependencies.videoListScanPromise) {
    backgroundLogger.info("Joining in-flight video scan.", { activeTabId });
    return dependencies.videoListScanPromise;
  }

  dependencies.videoListScanPromise = scanVideosAcrossTabs(
    dependencies,
    activeTabId,
    videoCache,
  ).finally(() => {
    dependencies.videoListScanPromise = null;
  });

  return dependencies.videoListScanPromise;
}

async function getVideoSniffState(
  dependencies: HostMessageHandlerDependencies,
): Promise<VideoSniffState> {
  const videoCache = getVideoCache(dependencies);
  await videoCache.restore();
  const state = videoCache.getState();
  backgroundLogger.info("Returning video sniff state.", {
    status: state.status,
    tabCount: state.tabs.length,
    videoCount: state.videos.length,
  });
  return state;
}

async function ensureVideoSniffState(
  dependencies: HostMessageHandlerDependencies,
  activeTabId: number | null,
): Promise<VideoSniffState> {
  const videoCache = getVideoCache(dependencies);
  await videoCache.restore();
  const state = videoCache.getState();
  const currentTabs = await querySniffTabs(dependencies, activeTabId);
  if (currentTabs.length > 0 && !hasSameTabIds(state.tabs, currentTabs)) {
    backgroundLogger.info("Refreshing video sniff state because browser tabs changed.", {
      cachedTabCount: state.tabs.length,
      currentTabCount: currentTabs.length,
    });
    return refreshVideoSniffState(dependencies, activeTabId);
  }

  if (shouldRefreshVideoSniffState(state)) {
    return refreshVideoSniffState(dependencies, activeTabId);
  }

  if (currentTabs.length > 0 && hasMissingTabMetadata(state.tabs, currentTabs)) {
    await videoCache.setTabs(mergeTabMetadata(state.tabs, currentTabs));
    return videoCache.getState();
  }

  backgroundLogger.info("Returning fresh video sniff state.", {
    status: state.status,
    tabCount: state.tabs.length,
    videoCount: state.videos.length,
  });
  return state;
}

async function refreshVideoSniffState(
  dependencies: HostMessageHandlerDependencies,
  activeTabId: number | null,
): Promise<VideoSniffState> {
  await listVideosAcrossTabs(dependencies, activeTabId, true);
  const videoCache = getVideoCache(dependencies);
  await videoCache.restore();
  return videoCache.getState();
}

async function scanVideosAcrossTabs(
  dependencies: HostMessageHandlerDependencies,
  activeTabId: number | null,
  videoCache: VideoSourceCache,
): Promise<TabVideoSource[]> {
  backgroundLogger.info("Cache empty, performing live scan.", { activeTabId });
  const windowTabs = await queryWindowTabs(dependencies, activeTabId);
  const sniffTabs = windowTabs.map(toSniffTabSummary);
  await videoCache.markScanning(sniffTabs);
  const scannableTabs = windowTabs.filter(isScannableTab);

  backgroundLogger.info("Scanning normal browser tabs for videos.", {
    scannableTabCount: scannableTabs.length,
    skippedTabCount: windowTabs.length - scannableTabs.length,
    tabCount: windowTabs.length,
  });

  let settled: Array<PromiseSettledResult<TabVideoSource[]>>;
  try {
    settled = await Promise.allSettled(
      scannableTabs.map((tab) => listVideosForTab(dependencies, tab.id, tab.title)),
    );
  } catch (error) {
    await videoCache.markScanError(toErrorMessage(error));
    return videoCache.getAll();
  }

  const videosByTab = new Map<number, TabVideoSource[]>();
  for (const [i, result] of settled.entries()) {
    const tab = scannableTabs[i];
    if (result.status === "fulfilled" && tab) {
      videosByTab.set(tab.id, result.value);
    }
  }

  await videoCache.replaceScanResults(sniffTabs, videosByTab);

  return videoCache.getAll();
}

function shouldRefreshVideoSniffState(state: VideoSniffState) {
  const now = Date.now();
  if (
    state.status === "refreshing" &&
    typeof state.startedAt === "number" &&
    now - state.startedAt <= VIDEO_SNIFF_STUCK_REFRESH_MS
  ) {
    return false;
  }

  if (typeof state.updatedAt !== "number") {
    return true;
  }

  return now - state.updatedAt > VIDEO_SNIFF_AUTO_REFRESH_TTL_MS;
}

async function querySniffTabs(
  dependencies: HostMessageHandlerDependencies,
  activeTabId: number | null,
): Promise<SniffTabSummary[]> {
  const tabs = await queryWindowTabs(dependencies, activeTabId);
  return tabs.map(toSniffTabSummary);
}

async function queryWindowTabs(
  dependencies: HostMessageHandlerDependencies,
  activeTabId: number | null,
) {
  return dependencies.queryCurrentWindowTabs
    ? dependencies.queryCurrentWindowTabs()
    : activeTabId === null
      ? []
      : [{ id: activeTabId, title: undefined as string | undefined }];
}

function hasSameTabIds(left: SniffTabSummary[], right: SniffTabSummary[]) {
  return (
    left.length === right.length &&
    left.every((tab, index) => tab.tabId === right[index]?.tabId)
  );
}

function hasMissingTabMetadata(
  cachedTabs: SniffTabSummary[],
  currentTabs: SniffTabSummary[],
) {
  return cachedTabs.some((tab, index) => {
    const current = currentTabs[index];
    if (!current || tab.tabId !== current.tabId) {
      return false;
    }

    return (
      (!tab.title && typeof current.title === "string") ||
      (!tab.url && typeof current.url === "string")
    );
  });
}

function mergeTabMetadata(
  cachedTabs: SniffTabSummary[],
  currentTabs: SniffTabSummary[],
) {
  return cachedTabs.map((tab, index) => {
    const current = currentTabs[index];
    if (!current || tab.tabId !== current.tabId) {
      return tab;
    }

    return {
      ...tab,
      title: tab.title ?? current.title,
      url: tab.url ?? current.url,
    };
  });
}

function toSniffTabSummary(tab: { id: number; title?: string; url?: string }): SniffTabSummary {
  return {
    tabId: tab.id,
    ...(tab.title !== undefined && { title: tab.title }),
    ...(tab.url !== undefined && { url: tab.url }),
  };
}

function isScannableTab(tab: { id: number; url?: string }) {
  if (!tab.url) {
    return true;
  }

  return tab.url.startsWith("http://") || tab.url.startsWith("https://");
}

function getVideoCache(dependencies: HostMessageHandlerDependencies) {
  dependencies.videoCache ??= new VideoSourceCache();
  return dependencies.videoCache;
}

async function attachSourceInFrame(
  dependencies: HostMessageHandlerDependencies,
  tabId: number,
  message: Extract<HostMessage, { type: "screenmate:attach-source" }>,
) {
  const roomSession = await getAttachSessionForNegotiation(dependencies);
  if (!roomSession) {
    return dependencies.runtime.getSnapshot();
  }

  const snapshot = dependencies.runtime.getSnapshot();
  if (
    snapshot.activeTabId !== tabId ||
    snapshot.activeFrameId !== message.frameId
  ) {
    await detachCurrentAttachmentOwner(dependencies, snapshot);
  }

  try {
    const response = await dependencies.sendTabMessage(
      tabId,
      {
        type: "screenmate:attach-source",
        roomSession,
        videoId: message.videoId,
      },
      { frameId: message.frameId },
    );

    if (!isAttachSourceResponse(response)) {
      return dependencies.runtime.markMissing("No video attached.");
    }

    return dependencies.runtime.setAttachedSource(response.sourceLabel, {
      ...response.fingerprint,
      frameId: message.frameId,
      tabId,
    });
  } catch (error) {
    backgroundLogger.warn("Could not attach source in frame.", {
      error: toErrorMessage(error),
      frameId: message.frameId,
      tabId,
      videoId: message.videoId,
    });
    return dependencies.runtime.markMissing("No video attached.");
  }
}

async function detachCurrentAttachmentOwner(
  dependencies: HostMessageHandlerDependencies,
  snapshot = dependencies.runtime.getSnapshot(),
) {
  if (
    typeof snapshot.activeTabId !== "number" ||
    typeof snapshot.activeFrameId !== "number"
  ) {
    return;
  }

  try {
    await dependencies.sendTabMessage(
      snapshot.activeTabId,
      { type: "screenmate:detach-source" },
      { frameId: snapshot.activeFrameId },
    );
  } catch (error) {
    backgroundLogger.warn("Could not detach source in previous owner frame.", {
      activeFrameId: snapshot.activeFrameId,
      activeTabId: snapshot.activeTabId,
      error: toErrorMessage(error),
    });
  }
}

async function maybeReattachSource(
  dependencies: HostMessageHandlerDependencies,
  tabId: number,
  message: Extract<HostMessage, { type: "screenmate:content-ready" }>,
) {
  const snapshot = dependencies.runtime.getSnapshot();
  if (snapshot.sourceState !== "recovering") {
    return snapshot;
  }

  if (
    typeof message.tabId === "number" &&
    snapshot.activeTabId !== null &&
    message.tabId !== snapshot.activeTabId
  ) {
    return snapshot;
  }

  const sourceFingerprint = dependencies.runtime.getSourceFingerprint();
  const roomSession = await getAttachSessionForNegotiation(dependencies);
  if (
    !sourceFingerprint ||
    !roomSession ||
    sourceFingerprint.tabId !== tabId ||
    sourceFingerprint.frameId !== message.frameId
  ) {
    return dependencies.runtime.markMissing("No video attached.");
  }

  const matchingVideo = message.videos.find(
    (video) =>
      video.fingerprint &&
      isExactFingerprintMatch(sourceFingerprint, video.fingerprint),
  );
  if (!matchingVideo?.fingerprint) {
    // No matching video found yet.  If the recovery window is still open,
    // stay in "recovering" so later content-ready notifications (triggered by
    // the MutationObserver when the video element appears late) can retry.
    if (
      snapshot.recoverByTimestamp !== null &&
      snapshot.recoverByTimestamp > Date.now()
    ) {
      backgroundLogger.info("No matching video found yet, staying in recovery.", {
        recoverByTimestamp: snapshot.recoverByTimestamp,
        tabId,
        videoCount: message.videos.length,
      });
      return snapshot;
    }

    return dependencies.runtime.markMissing("No video attached.");
  }

  try {
    const response = await dependencies.sendTabMessage(
      tabId,
      {
        type: "screenmate:attach-source",
        roomSession,
        videoId: matchingVideo.id,
      },
      { frameId: message.frameId },
    );

    if (!isAttachSourceResponse(response)) {
      return dependencies.runtime.markMissing("No video attached.");
    }

    return dependencies.runtime.setAttachedSource(response.sourceLabel, {
      ...response.fingerprint,
      frameId: message.frameId,
      tabId,
    });
  } catch (error) {
    backgroundLogger.warn("Automatic source reattach failed.", {
      error: toErrorMessage(error),
      frameId: message.frameId,
      roomId: snapshot.roomId,
      tabId,
    });
    return dependencies.runtime.markMissing("No video attached.");
  }
}

async function getAttachSessionForNegotiation(
  dependencies: HostMessageHandlerDependencies,
) {
  const roomSession = dependencies.runtime.getAttachSession();
  if (!roomSession) {
    return null;
  }

  if (!dependencies.runtime.shouldRefreshHostIce?.()) {
    return roomSession;
  }

  try {
    const refreshed = await dependencies.runtime.refreshHostIce?.();
    if (refreshed === null) {
      return null;
    }
  } catch (error) {
    backgroundLogger.warn("Could not refresh host ICE before attaching.", {
      error: toErrorMessage(error),
      roomId: roomSession.roomId,
    });
  }

  return dependencies.runtime.getAttachSession();
}

async function broadcastPreviewToTab(
  dependencies: HostMessageHandlerDependencies,
  tabId: number,
  message: Extract<HostMessage, { type: "screenmate:preview-video" }>,
): Promise<PreviewAck> {
  const frameIds = await resolveFrameIds(dependencies, tabId);

  await Promise.allSettled(
    frameIds.map((frameId) =>
      dependencies.sendTabMessage(
        tabId,
        {
          ...message,
          active: frameId === message.frameId,
        },
        { frameId },
      ),
    ),
  );

  return { ok: true };
}

async function broadcastMessageToTab(
  dependencies: HostMessageHandlerDependencies,
  tabId: number,
  message: Extract<HostMessage, { type: "screenmate:clear-preview" }>,
): Promise<PreviewAck> {
  const frameIds = await resolveFrameIds(dependencies, tabId);

  await Promise.allSettled(
    frameIds.map((frameId) =>
      dependencies.sendTabMessage(tabId, message, { frameId }),
    ),
  );

  return { ok: true };
}

async function resolveFrameIds(
  dependencies: HostMessageHandlerDependencies,
  tabId: number,
): Promise<number[]> {
  try {
    const frameIds = await dependencies.queryFrameIds(tabId);
    const uniqueFrameIds = [...new Set(frameIds)];
    return uniqueFrameIds.length > 0 ? uniqueFrameIds : [0];
  } catch {
    return [0];
  }
}

function isHostMessage(message: unknown): message is HostMessage {
  if (!isRecord(message) || typeof message.type !== "string") {
    return false;
  }

  switch (message.type) {
    case "screenmate:get-room-session":
    case "screenmate:get-video-sniff-state":
    case "screenmate:ensure-video-sniff-state":
    case "screenmate:refresh-video-sniff-state":
      return true;
    case "screenmate:list-videos":
      return (
        typeof message.refresh === "undefined" ||
        typeof message.refresh === "boolean"
      );
    case "screenmate:stop-room":
    case "screenmate:clear-preview":
      return true;
    case "screenmate:start-room":
      return (
        typeof message.frameId === "number" &&
        (typeof message.tabId === "undefined" || typeof message.tabId === "number")
      );
    case "screenmate:attach-source":
      return (
        typeof message.videoId === "string" &&
        typeof message.frameId === "number" &&
        (typeof message.tabId === "undefined" || typeof message.tabId === "number")
      );
    case "screenmate:content-ready":
      return (
        typeof message.frameId === "number" &&
        Array.isArray(message.videos)
      );
    case "screenmate:source-detached":
      return (
        typeof message.frameId === "number" &&
        (message.reason === "track-ended" ||
          message.reason === "content-invalidated" ||
          message.reason === "manual-detach")
      );
    case "screenmate:signal-outbound":
      return isRecord(message.envelope);
    case "screenmate:signal-inbound":
      return (
        typeof message.frameId === "number" &&
        isRecord(message.envelope)
      );
    case "screenmate:preview-video":
      return (
        typeof message.videoId === "string" &&
        typeof message.frameId === "number" &&
        (typeof message.tabId === "undefined" || typeof message.tabId === "number") &&
        typeof message.label === "string"
      );
    default:
      return false;
  }
}

function normalizeIncomingFrameMessage(
  message: unknown,
  sender: Browser.runtime.MessageSender,
): unknown {
  if (!isHostMessage(message)) {
    return message;
  }

  if (
    message.type !== "screenmate:content-ready" &&
    message.type !== "screenmate:source-detached" &&
    message.type !== "screenmate:signal-outbound"
  ) {
    return message;
  }

  return {
    ...message,
    frameId: sender.frameId ?? 0,
    tabId: sender.tab?.id ?? null,
  } satisfies HostMessage;
}

function isCurrentAttachmentOwner(
  snapshot: Pick<HostRoomSnapshot, "activeFrameId" | "activeTabId">,
  message: {
    frameId?: number | null;
    tabId?: number | null;
  },
) {
  if (
    typeof snapshot.activeFrameId === "number" &&
    typeof message.frameId === "number" &&
    message.frameId !== snapshot.activeFrameId
  ) {
    return false;
  }

  if (
    typeof snapshot.activeTabId === "number" &&
    typeof message.tabId === "number" &&
    message.tabId !== snapshot.activeTabId
  ) {
    return false;
  }

  return true;
}

export function shouldForwardSignalToContentRuntime(
  envelope: SignalEnvelope,
) {
  return (
    envelope.messageType === "answer" ||
    envelope.messageType === "ice-candidate" ||
    envelope.messageType === "viewer-joined" ||
    envelope.messageType === "viewer-left"
  );
}

function isFulfilledVideoList(
  result: PromiseSettledResult<TabMessageResponse>,
): result is PromiseFulfilledResult<LocalVideoSource[]> {
  return result.status === "fulfilled" && Array.isArray(result.value);
}

function isAttachSourceResponse(
  value: TabMessageResponse,
): value is AttachSourceResponse {
  return (
    !!value &&
    !Array.isArray(value) &&
    !("ok" in value) &&
    typeof value.sourceLabel === "string" &&
    isRecord(value.fingerprint)
  );
}

function isRoomCreateResponse(
  response: InternalHostNetworkResponse,
): response is RoomCreateResponse {
  return (
    "roomId" in response &&
    typeof response.roomId === "string" &&
    typeof response.hostToken === "string" &&
    typeof response.signalingUrl === "string"
  );
}

function isInternalHostNetworkMessage(
  message: unknown,
): message is InternalHostNetworkMessage {
  return (
    isRecord(message) &&
    message.type === "screenmate:create-room" &&
    typeof message.apiBaseUrl === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isExactFingerprintMatch(
  stored: SourceFingerprint,
  candidate: SourceFingerprintMatch,
) {
  if (
    stored.pageUrl !== null &&
    candidate.pageUrl !== null &&
    stored.pageUrl !== candidate.pageUrl
  ) {
    return false;
  }

  if (
    stored.primaryUrl !== null &&
    stored.primaryUrl === candidate.primaryUrl
  ) {
    return true;
  }

  if (!hasUnstableSourceUrl(stored.primaryUrl, candidate.primaryUrl)) {
    return false;
  }

  if (
    stored.pageUrl === null ||
    candidate.pageUrl === null ||
    stored.pageUrl !== candidate.pageUrl
  ) {
    return false;
  }

  if (stored.elementId !== null || candidate.elementId !== null) {
    return (
      stored.elementId !== null &&
      stored.elementId === candidate.elementId
    );
  }

  return stored.visibleIndex === candidate.visibleIndex;
}

function hasUnstableSourceUrl(
  storedPrimaryUrl: string | null,
  candidatePrimaryUrl: string | null,
) {
  return (
    storedPrimaryUrl === null ||
    candidatePrimaryUrl === null ||
    isBlobSourceUrl(storedPrimaryUrl) ||
    isBlobSourceUrl(candidatePrimaryUrl)
  );
}

function isBlobSourceUrl(value: string) {
  return value.startsWith("blob:");
}

function formatFrameScopedLabel(label: string, frameId: number): string {
  return frameId === 0 ? label : `${label} [iframe #${frameId}]`;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown error";
}
