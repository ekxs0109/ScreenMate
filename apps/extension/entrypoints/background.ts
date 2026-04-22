import { browser, type Browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
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
import type { VideoSource as LocalVideoSource } from "./content/video-detector";

type SourceFingerprintMatch = Omit<SourceFingerprint, "frameId" | "tabId">;

export type HostMessage =
  | { type: "screenmate:get-room-session" }
  | { type: "screenmate:list-videos" }
  | { type: "screenmate:start-room"; frameId: number }
  | { type: "screenmate:attach-source"; videoId: string; frameId: number }
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
      label: string;
      active?: boolean;
    }
  | { type: "screenmate:clear-preview" };

export type TabVideoSource = LocalVideoSource & {
  frameId: number;
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

type HandlerResponse = HostRoomSnapshot | TabVideoSource[] | PreviewAck;
type TabMessageResponse =
  | LocalVideoSource[]
  | AttachSourceResponse
  | PreviewAck
  | undefined;
type InternalHostNetworkResponse =
  | RoomCreateResponse
  | InternalHostNetworkErrorResponse;

const backgroundLogger = createLogger("background");

type HostMessageHandlerDependencies = {
  apiBaseUrl?: string;
  createRoom: (apiBaseUrl: string) => Promise<InternalHostNetworkResponse>;
  queryActiveTabId: () => Promise<number | null>;
  queryFrameIds: (tabId: number) => Promise<number[]>;
  runtime: HostRoomRuntime;
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

    const tabId =
      message.type === "screenmate:content-ready"
        ? dependencies.runtime.getSnapshot().activeTabId
        : await dependencies.queryActiveTabId();
    if (tabId === null) {
      if (message.type === "screenmate:list-videos") {
        return [];
      }

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

    if (message.type === "screenmate:list-videos") {
      return listVideosForTab(dependencies, tabId);
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
        currentWindow: true,
      });

      return tab?.id ?? null;
    },
    queryFrameIds: async (tabId) => {
      const frames = (await browser.webNavigation.getAllFrames({ tabId })) ?? [];
      const frameIds = frames
        .map((frame) => frame.frameId)
        .filter((frameId): frameId is number => typeof frameId === "number");

      return frameIds.length > 0 ? frameIds : [0];
    },
    runtime,
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

  return videos;
}

async function attachSourceInFrame(
  dependencies: HostMessageHandlerDependencies,
  tabId: number,
  message: Extract<HostMessage, { type: "screenmate:attach-source" }>,
) {
  const roomSession = dependencies.runtime.getAttachSession();
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
  const roomSession = dependencies.runtime.getAttachSession();
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
    case "screenmate:list-videos":
    case "screenmate:stop-room":
    case "screenmate:clear-preview":
      return true;
    case "screenmate:start-room":
      return typeof message.frameId === "number";
    case "screenmate:attach-source":
      return (
        typeof message.videoId === "string" &&
        typeof message.frameId === "number"
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
