import { browser, type Browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { createLogger } from "../lib/logger";
import {
  createHostSnapshot,
  type HostSnapshot,
} from "./content/host-session";
import type { VideoSource as LocalVideoSource } from "./content/video-detector";

export type HostMessage =
  | { type: "screenmate:list-videos" }
  | { type: "screenmate:get-host-state" }
  | { type: "screenmate:start-sharing"; videoId: string; frameId: number }
  | { type: "screenmate:stop-sharing" }
  | {
      type: "screenmate:preview-video";
      videoId: string;
      frameId: number;
      label: string;
      active?: boolean;
    }
  | { type: "screenmate:clear-preview" };

export type TabVideoSource = LocalVideoSource & {
  frameId: number;
};

type PreviewAck = { ok: true };
type TabMessageResponse = HostSnapshot | LocalVideoSource[] | PreviewAck;
const backgroundLogger = createLogger("background");

function isHostMessage(message: unknown): message is HostMessage {
  if (typeof message !== "object" || message === null) {
    return false;
  }

  const candidate = message as Partial<HostMessage> & { type?: unknown };
  const { type } = candidate;

  if (type === "screenmate:start-sharing") {
    return (
      typeof candidate.videoId === "string" &&
      typeof candidate.frameId === "number"
    );
  }

  if (type === "screenmate:preview-video") {
    return (
      typeof candidate.videoId === "string" &&
      typeof candidate.frameId === "number" &&
      typeof candidate.label === "string"
    );
  }

  return (
    type === "screenmate:list-videos" ||
    type === "screenmate:get-host-state" ||
    type === "screenmate:stop-sharing" ||
    type === "screenmate:clear-preview"
  );
}

type HostMessageHandlerDependencies = {
  queryActiveTabId: () => Promise<number | null>;
  queryFrameIds: (tabId: number) => Promise<number[]>;
  sendTabMessage: (
    tabId: number,
    message: HostMessage,
    options?: { frameId?: number },
  ) => Promise<TabMessageResponse>;
};

export function createHostMessageHandler(
  dependencies: HostMessageHandlerDependencies,
) {
  return async (message: unknown) => {
    if (!isHostMessage(message)) {
      return undefined;
    }

    const tabId = await dependencies.queryActiveTabId();
    if (tabId === null) {
      if (message.type === "screenmate:list-videos") {
        return [];
      }

      return createHostSnapshot({
        errorMessage:
          message.type === "screenmate:get-host-state"
            ? null
            : "Could not find an active tab to start sharing from.",
      });
    }

    if (message.type === "screenmate:list-videos") {
      return listVideosForTab(dependencies, tabId);
    }

    if (message.type === "screenmate:get-host-state") {
      return getHostStateForTab(dependencies, tabId);
    }

    if (message.type === "screenmate:stop-sharing") {
      return stopSharingInTab(dependencies, tabId);
    }

    if (message.type === "screenmate:preview-video") {
      return broadcastPreviewToTab(dependencies, tabId, message);
    }

    if (message.type === "screenmate:clear-preview") {
      return broadcastMessageToTab(dependencies, tabId, message);
    }

    return sendMessageToFrame(dependencies, tabId, message.frameId, message);
  };
}

export function createHostRuntimeMessageListener(
  handler: ReturnType<typeof createHostMessageHandler>,
) {
  return (
    message: unknown,
    _sender: Browser.runtime.MessageSender,
    sendResponse: (response?: TabMessageResponse | HostSnapshot | TabVideoSource[]) => void,
  ) => {
    const result = handler(message);

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
          message,
        });
        sendResponse(
          createHostSnapshot({
            errorMessage: `Background handler failed: ${toErrorMessage(error)}`,
          }),
        );
      });

    return true;
  };
}

export default defineBackground(() => {
  const handler = createHostMessageHandler({
    async queryActiveTabId() {
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });

      return tab?.id ?? null;
    },
    async queryFrameIds(tabId) {
      const frames = (await browser.webNavigation.getAllFrames({ tabId })) ?? [];
      const frameIds = frames
        .map((frame) => frame.frameId)
        .filter((frameId): frameId is number => typeof frameId === "number");

      return frameIds.length > 0 ? frameIds : [0];
    },
    sendTabMessage(tabId, message, options) {
      return browser.tabs.sendMessage(
        tabId,
        message,
        options,
      ) as Promise<TabMessageResponse>;
    },
  });

  browser.runtime.onMessage.addListener(
    createHostRuntimeMessageListener(handler),
  );
});

async function listVideosForTab(
  dependencies: HostMessageHandlerDependencies,
  tabId: number,
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
      continue;
    }

    const frameId = frameIds[index] ?? 0;
    for (const video of result.value) {
      videos.push({
        ...video,
        label: formatFrameScopedLabel(video.label, frameId),
        frameId,
      });
    }
  }

  results.forEach((result, index) => {
    const frameId = frameIds[index] ?? 0;

    if (result.status === "fulfilled") {
      backgroundLogger.info("Frame video scan response.", {
        frameId,
        responseKind: Array.isArray(result.value)
          ? "video-list"
          : "ok" in result.value
            ? "ack"
            : "snapshot",
        videoCount: Array.isArray(result.value) ? result.value.length : null,
        firstVideo: Array.isArray(result.value) ? result.value[0] ?? null : null,
      });
      return;
    }

    backgroundLogger.warn("Frame video scan failed.", {
      error: toErrorMessage(result.reason),
      frameId,
    });
  });

  backgroundLogger.info("Video scan finished.", {
    tabId,
    totalFrames: frameIds.length,
    totalVideos: videos.length,
  });

  return videos;
}

async function getHostStateForTab(
  dependencies: HostMessageHandlerDependencies,
  tabId: number,
): Promise<HostSnapshot> {
  const frameIds = await resolveFrameIds(dependencies, tabId);
  backgroundLogger.debug("Collecting host state from frames.", {
    frameIds,
    tabId,
  });
  const results = await Promise.allSettled(
    frameIds.map((frameId) =>
      dependencies.sendTabMessage(
        tabId,
        { type: "screenmate:get-host-state" },
        { frameId },
      ),
    ),
  );

  const snapshots = results
    .filter(isFulfilledSnapshot)
    .map((result) => result.value);

  if (snapshots.length === 0) {
    return createHostSnapshot({
      errorMessage:
        "Could not reach the ScreenMate content script in the active tab: Receiving end does not exist.",
    });
  }

  return selectMostRelevantSnapshot(snapshots);
}

async function stopSharingInTab(
  dependencies: HostMessageHandlerDependencies,
  tabId: number,
): Promise<HostSnapshot> {
  const frameIds = await resolveFrameIds(dependencies, tabId);
  backgroundLogger.info("Stopping any active share in tab.", {
    frameIds,
    tabId,
  });
  const results = await Promise.allSettled(
    frameIds.map((frameId) =>
      dependencies.sendTabMessage(
        tabId,
        { type: "screenmate:stop-sharing" },
        { frameId },
      ),
    ),
  );

  const snapshots = results
    .filter(isFulfilledSnapshot)
    .map((result) => result.value);

  if (snapshots.length === 0) {
    return createHostSnapshot({
      errorMessage:
        "Could not reach the ScreenMate content script in the active tab: Receiving end does not exist.",
    });
  }

  return selectMostRelevantSnapshot(snapshots);
}

async function broadcastPreviewToTab(
  dependencies: HostMessageHandlerDependencies,
  tabId: number,
  message: Extract<HostMessage, { type: "screenmate:preview-video" }>,
): Promise<PreviewAck> {
  const frameIds = await resolveFrameIds(dependencies, tabId);
  backgroundLogger.info("Broadcasting preview selection.", {
    frameIds,
    selectedFrameId: message.frameId,
    selectedVideoId: message.videoId,
    tabId,
  });

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
  backgroundLogger.info("Broadcasting preview clear.", {
    frameIds,
    tabId,
  });

  await Promise.allSettled(
    frameIds.map((frameId) =>
      dependencies.sendTabMessage(tabId, message, { frameId }),
    ),
  );

  return { ok: true };
}

async function sendMessageToFrame(
  dependencies: HostMessageHandlerDependencies,
  tabId: number,
  frameId: number,
  message: HostMessage,
): Promise<HostSnapshot> {
  try {
    backgroundLogger.info("Sending frame-targeted message.", {
      frameId,
      tabId,
      type: message.type,
    });
    const response = await dependencies.sendTabMessage(
      tabId,
      message,
      { frameId },
    );

    if (Array.isArray(response)) {
      return createHostSnapshot({
        errorMessage: "Unexpected response received from the active tab.",
      });
    }

    if ("ok" in response) {
      return createHostSnapshot({
        errorMessage: "Unexpected acknowledgement received from the active tab.",
      });
    }

    return response;
  } catch (error) {
    backgroundLogger.error("Frame-targeted message failed.", {
      error: toErrorMessage(error),
      frameId,
      tabId,
      type: message.type,
    });
    return createHostSnapshot({
      errorMessage: `Could not reach the ScreenMate content script in the active tab: ${toErrorMessage(error)}`,
    });
  }
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

function isFulfilledSnapshot(
  result: PromiseSettledResult<TabMessageResponse>,
): result is PromiseFulfilledResult<HostSnapshot> {
  return (
    result.status === "fulfilled" &&
    !Array.isArray(result.value) &&
    !("ok" in result.value)
  );
}

function isFulfilledVideoList(
  result: PromiseSettledResult<TabMessageResponse>,
): result is PromiseFulfilledResult<LocalVideoSource[]> {
  return result.status === "fulfilled" && Array.isArray(result.value);
}

function selectMostRelevantSnapshot(snapshots: HostSnapshot[]): HostSnapshot {
  return [...snapshots].sort((left, right) => {
    return getSnapshotPriority(right) - getSnapshotPriority(left);
  })[0] ?? createHostSnapshot();
}

function getSnapshotPriority(snapshot: HostSnapshot): number {
  switch (snapshot.status) {
    case "streaming":
      return 5;
    case "hosting":
      return 4;
    case "starting":
      return 3;
    case "degraded":
      return 2;
    case "closed":
      return 1;
    case "idle":
    default:
      return 0;
  }
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
