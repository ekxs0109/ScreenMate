import { browser, type Browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { storage } from "wxt/utils/storage";
import type { RoomChatMessage } from "@screenmate/shared";
import {
  getScreenMateApiBaseUrl,
  getScreenMateViewerBaseUrl,
} from "../lib/config";
import type { LocalMediaMetadata } from "../lib/local-media-store";
import { createLogger } from "../lib/logger";
import {
  requestRoomCreation,
  updateRoomAccess,
  type RoomAccessResponse,
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
const OFFSCREEN_ATTACHMENT_TAB_ID = -1;
const OFFSCREEN_ATTACHMENT_FRAME_ID = -1;
const PLAYER_ATTACHMENT_TAB_ID = -2;
const PLAYER_ATTACHMENT_FRAME_ID = -1;
type ScreenMatePageKind = "viewer";

export type StartSharingSource =
  | { kind: "tab-video"; tabId: number; frameId: number; videoId: string }
  | { kind: "active-tab-video" }
  | { kind: "player-local-video"; label: string }
  | { kind: "prepared-offscreen"; sourceType: "screen" }
  | {
      kind: "prepared-offscreen";
      sourceType: "upload";
      label?: string;
      fileId?: string;
      metadata?: LocalMediaMetadata;
    };

export type HostMessage =
  | { type: "screenmate:get-room-session" }
  | { type: "screenmate:create-room-session" }
  | { type: "screenmate:get-prepared-source-state" }
  | { type: "screenmate:get-local-playback-state" }
  | { type: "screenmate:clear-prepared-source-state" }
  | { type: "screenmate:send-chat-message"; text: string }
  | { type: "screenmate:set-room-password"; password: string }
  | { type: "screenmate:list-videos"; refresh?: boolean }
  | { type: "screenmate:get-video-sniff-state" }
  | { type: "screenmate:ensure-video-sniff-state" }
  | { type: "screenmate:refresh-video-sniff-state" }
  | { type: "screenmate:get-follow-active-tab-video-state" }
  | { type: "screenmate:set-follow-active-tab-video"; enabled: boolean }
  | {
      type: "screenmate:prepare-screen-source";
      captureType: "screen" | "window" | "tab";
    }
  | {
      type: "screenmate:prepare-local-file-source";
      fileId: string;
      metadata: LocalMediaMetadata;
    }
  | {
      type: "screenmate:start-sharing";
      source: StartSharingSource;
    }
  | {
      type: "screenmate:sync-local-playback";
      action: "play" | "pause" | "seek" | "ratechange";
      currentTime?: number;
      playbackRate?: number;
    }
  | {
      type: "screenmate:player-signal-outbound";
      envelope: Record<string, unknown>;
    }
  | {
      type: "screenmate:player-source-detached";
      roomId: string;
      reason: "track-ended" | "content-invalidated" | "manual-detach";
    }
  | {
      type: "screenmate:offscreen-signal-outbound";
      envelope: Record<string, unknown>;
    }
  | {
      type: "screenmate:offscreen-source-detached";
      roomId: string;
      reason: "track-ended" | "content-invalidated" | "manual-detach";
    }
  | { type: "screenmate:stop-room" }
  | {
      type: "screenmate:content-ready";
      frameId: number;
      tabId?: number | null;
      screenmatePageKind?: ScreenMatePageKind | null;
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
export type FollowActiveTabVideoState = { enabled: boolean };
export type InternalHostNetworkMessage = {
  type: "screenmate:create-room";
  apiBaseUrl: string;
} | {
  type: "screenmate:set-room-access";
  apiBaseUrl: string;
  roomId: string;
  hostToken: string;
  password: string;
};
export type InternalHostNetworkErrorResponse = {
  error: string;
};

type AttachSourceResponse = {
  sourceLabel: string;
  fingerprint: SourceFingerprintMatch;
};
type OffscreenErrorResponse = {
  ok: false;
  error: string;
};

type AttachSourceInFrameRequest = {
  type: "screenmate:attach-source";
  videoId: string;
  frameId: number;
  tabId?: number;
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
    }
  | {
      type: "screenmate:update-chat-messages";
      messages: RoomChatMessage[];
    };

type HandlerResponse =
  | HostRoomSnapshot
  | TabVideoSource[]
  | VideoSniffState
  | PreparedSourceState
  | LocalPlaybackState
  | FollowActiveTabVideoState
  | PreviewAck
  | {
      ok: boolean;
      snapshot: HostRoomSnapshot;
      error: "room-chat-send-failed" | "room-password-save-failed" | null;
    };
type TabMessageResponse =
  | LocalVideoSource[]
  | AttachSourceResponse
  | LocalPlaybackState
  | PreviewAck
  | OffscreenErrorResponse
  | undefined;
type InternalHostNetworkResponse =
  | RoomCreateResponse
  | RoomAccessResponse
  | InternalHostNetworkErrorResponse;

export type PreparedSourceState =
  | { status: "prepared-source"; kind: null; ready: false; label: null; metadata: null; error: string | null }
  | {
      status: "prepared-source";
      kind: "screen";
      ready: true;
      label: string;
      metadata: null;
      captureType: "screen" | "window" | "tab";
      error: null;
    }
  | {
      status: "prepared-source";
      kind: "upload";
      ready: true;
      label: string;
      metadata: LocalMediaMetadata;
      fileId: string;
      error: null;
    };
export type LocalPlaybackState = {
  status: "local-playback-state";
  active: boolean;
  currentTime: number | null;
  duration: number | null;
  paused: boolean | null;
  playbackRate: number | null;
  sourceLabel: string | null;
};

const backgroundLogger = createLogger("background");
const VIDEO_SNIFF_AUTO_REFRESH_TTL_MS = 30_000;
const VIDEO_SNIFF_STUCK_REFRESH_MS = 60_000;
const FOLLOW_ACTIVE_TAB_VIDEO_DEBOUNCE_MS = 700;
const OFFSCREEN_SCREEN_ATTACH_TIMEOUT_MS = 10_000;
const OFFSCREEN_LOCAL_FILE_ATTACH_TIMEOUT_MS = 75_000;
const PLAYER_ATTACH_TIMEOUT_MS = 60_000;
function createEmptyPreparedSourceState(): PreparedSourceState {
  return {
    status: "prepared-source",
    kind: null,
    ready: false,
    label: null,
    metadata: null,
    error: null,
  };
}
function createInactiveLocalPlaybackState(): LocalPlaybackState {
  return {
    status: "local-playback-state",
    active: false,
    currentTime: null,
    duration: null,
    paused: null,
    playbackRate: null,
    sourceLabel: null,
  };
}
type AttachmentSignalTarget = {
  tabId: number;
  frameId: number;
};
type AttachmentRoutingState = {
  pendingAttachmentTarget: AttachmentSignalTarget | null;
  followActiveTabVideoPromise: Promise<HostRoomSnapshot> | null;
  followActiveTabVideoTargetTabId: number | null;
  followActiveTabVideoGeneration: number;
};
type FollowActiveTabVideoStateStorage = {
  getValue: () => Promise<FollowActiveTabVideoState | null>;
  setValue: (state: FollowActiveTabVideoState) => Promise<void>;
};
type HostMessageHandlerDependencies = {
  apiBaseUrl?: string;
  viewerBaseUrl?: string;
  createRoom: (apiBaseUrl: string) => Promise<InternalHostNetworkResponse>;
  queryActiveTabId: () => Promise<number | null>;
  queryCurrentWindowTabs?: () => Promise<
    Array<{ id: number; title?: string; url?: string }>
  >;
  queryFrameIds: (tabId: number) => Promise<number[]>;
  runtime: HostRoomRuntime;
  videoCache?: VideoSourceCache;
  videoListScanPromise?: Promise<TabVideoSource[]> | null;
  followActiveTabVideoStateStorage?: FollowActiveTabVideoStateStorage;
  attachmentRoutingState?: AttachmentRoutingState;
  sendTabMessage: (
    tabId: number,
    message: TabContentMessage,
    options?: { frameId?: number },
  ) => Promise<TabMessageResponse>;
  forwardInboundSignal: (envelope: SignalEnvelope) => void;
  preparedSourceState?: PreparedSourceState;
  ensureOffscreenDocument?: () => Promise<void>;
  sendOffscreenMessage?: (
    message: OffscreenControlMessage,
  ) => Promise<TabMessageResponse>;
  sendPlayerMessage?: (
    message: PlayerControlMessage,
  ) => Promise<TabMessageResponse>;
};

type OffscreenControlMessage =
  | { type: "screenmate:offscreen-get-prepared-display-media-state" }
  | { type: "screenmate:offscreen-get-local-playback-state" }
  | { type: "screenmate:offscreen-clear-prepared-source" }
  | {
      type: "screenmate:offscreen-prepare-display-media";
      captureType: "screen" | "window" | "tab";
    }
  | {
      type: "screenmate:offscreen-attach-display-media";
      roomSession: NonNullable<ReturnType<HostRoomRuntime["getAttachSession"]>>;
      sourceLabel: string;
    }
  | {
      type: "screenmate:offscreen-attach-local-file";
      roomSession: NonNullable<ReturnType<HostRoomRuntime["getAttachSession"]>>;
      fileId: string;
      metadata: LocalMediaMetadata;
    }
  | {
      type: "screenmate:offscreen-signal-inbound";
      envelope: SignalEnvelope;
    }
  | {
      type: "screenmate:offscreen-update-ice-servers";
      iceServers: RTCIceServer[];
    }
  | {
      type: "screenmate:offscreen-local-playback-control";
      action: "play" | "pause" | "seek" | "ratechange";
      currentTime?: number;
      playbackRate?: number;
    }
  | { type: "screenmate:offscreen-detach-source" };

type PlayerControlMessage =
  | {
      type: "screenmate:player-attach-local-video";
      roomSession: NonNullable<ReturnType<HostRoomRuntime["getAttachSession"]>>;
      sourceLabel: string;
    }
  | {
      type: "screenmate:player-signal-inbound";
      envelope: SignalEnvelope;
    }
  | {
      type: "screenmate:player-update-ice-servers";
      iceServers: RTCIceServer[];
    }
  | { type: "screenmate:player-detach-source" };

type InternalHostNetworkHandlerDependencies = {
  fetchImpl: typeof fetch;
};

export function createAttachmentRoutingState(): AttachmentRoutingState {
  return {
    pendingAttachmentTarget: null,
    followActiveTabVideoPromise: null,
    followActiveTabVideoTargetTabId: null,
    followActiveTabVideoGeneration: 0,
  };
}

export function createHostMessageHandler(
  dependencies: HostMessageHandlerDependencies,
) {
  dependencies.attachmentRoutingState ??= createAttachmentRoutingState();
  let preparedSourceState =
    dependencies.preparedSourceState ?? createEmptyPreparedSourceState();

  return async (message: unknown): Promise<HandlerResponse | undefined> => {
    if (!isHostMessage(message)) {
      return undefined;
    }

    if (message.type === "screenmate:get-room-session") {
      return dependencies.runtime.getSnapshot();
    }

    if (message.type === "screenmate:create-room-session") {
      return createRoomSession(dependencies);
    }

    if (message.type === "screenmate:get-prepared-source-state") {
      preparedSourceState = await refreshPreparedSourceStateFromOffscreen(
        dependencies,
        preparedSourceState,
      );
      return preparedSourceState;
    }

    if (message.type === "screenmate:get-local-playback-state") {
      return getLocalPlaybackStateFromOffscreen(dependencies);
    }

    if (message.type === "screenmate:clear-prepared-source-state") {
      preparedSourceState = createEmptyPreparedSourceState();
      try {
        await dependencies.sendOffscreenMessage?.({
          type: "screenmate:offscreen-clear-prepared-source",
        });
      } catch (error) {
        backgroundLogger.debug("Could not clear offscreen prepared source.", {
          error: toErrorMessage(error),
        });
      }
      return preparedSourceState;
    }

    if (message.type === "screenmate:prepare-screen-source") {
      if (!dependencies.ensureOffscreenDocument || !dependencies.sendOffscreenMessage) {
        preparedSourceState = {
          status: "prepared-source",
          kind: null,
          ready: false,
          label: null,
          metadata: null,
          error: "Offscreen screen capture is not available in this browser.",
        };
        return preparedSourceState;
      }

      try {
        await dependencies.ensureOffscreenDocument();
        const response = await dependencies.sendOffscreenMessage({
          type: "screenmate:offscreen-prepare-display-media",
          captureType: message.captureType,
        });
        if (!isAttachSourceResponse(response)) {
          preparedSourceState = {
            status: "prepared-source",
            kind: null,
            ready: false,
            label: null,
            metadata: null,
            error: "Screen capture was cancelled.",
          };
          return preparedSourceState;
        }

        const capturedSourceState = {
          status: "prepared-source",
          kind: "screen",
          ready: true,
          label: response.sourceLabel,
          metadata: null,
          captureType: message.captureType,
          error: null,
        } satisfies PreparedSourceState;
        preparedSourceState = capturedSourceState;

        const snapshot = dependencies.runtime.getSnapshot();
        if (
          snapshot.roomId !== null &&
          snapshot.roomLifecycle !== "idle" &&
          snapshot.roomLifecycle !== "closed"
        ) {
          await disableFollowActiveTabVideo(dependencies);
          const attachSnapshot = await startPreparedOffscreenSource(
            dependencies,
            capturedSourceState,
            "screen",
          );
          if (
            attachSnapshot.sourceState === "attached" &&
            isOffscreenAttachmentOwner(attachSnapshot)
          ) {
            preparedSourceState = createEmptyPreparedSourceState();
          }
        }

        return capturedSourceState;
      } catch (error) {
        preparedSourceState = {
          status: "prepared-source",
          kind: null,
          ready: false,
          label: null,
          metadata: null,
          error: toErrorMessage(error),
        };
        return preparedSourceState;
      }
    }

    if (message.type === "screenmate:prepare-local-file-source") {
      preparedSourceState = {
        status: "prepared-source",
        kind: "upload",
        ready: true,
        label: message.metadata.name,
        metadata: message.metadata,
        fileId: message.fileId,
        error: null,
      };
      return preparedSourceState;
    }

    if (message.type === "screenmate:send-chat-message") {
      const text = message.text.trim();
      const ok = dependencies.runtime.sendHostChatMessage(text);
      return {
        ok,
        snapshot: dependencies.runtime.getSnapshot(),
        error: ok ? null : "room-chat-send-failed",
      };
    }

    if (message.type === "screenmate:set-room-password") {
      return dependencies.runtime.setRoomPassword(message.password);
    }

    if (message.type === "screenmate:stop-room") {
      await detachCurrentAttachmentOwner(dependencies);
      preparedSourceState = createEmptyPreparedSourceState();
      return dependencies.runtime.close("Room closed.");
    }

    if (message.type === "screenmate:offscreen-source-detached") {
      const snapshot = dependencies.runtime.getSnapshot();
      if (!isOffscreenAttachmentOwner(snapshot)) {
        return snapshot;
      }

      return dependencies.runtime.markRecovering(message.reason);
    }

    if (message.type === "screenmate:player-source-detached") {
      const snapshot = dependencies.runtime.getSnapshot();
      if (!isPlayerAttachmentOwner(snapshot)) {
        return snapshot;
      }

      return dependencies.runtime.markRecovering(message.reason);
    }

    if (message.type === "screenmate:offscreen-signal-outbound") {
      dependencies.runtime.sendSignal(message.envelope);
      return { ok: true };
    }

    if (message.type === "screenmate:player-signal-outbound") {
      const playerOwner = {
        tabId: PLAYER_ATTACHMENT_TAB_ID,
        frameId: PLAYER_ATTACHMENT_FRAME_ID,
      };
      const snapshot = dependencies.runtime.getSnapshot();
      if (!isCurrentOrPendingAttachmentOwner(dependencies, snapshot, playerOwner)) {
        backgroundLogger.warn("Dropping outbound signal from non-owner player.", {
          activeFrameId: snapshot.activeFrameId,
          activeTabId: snapshot.activeTabId,
          messageType: readSignalMessageType(message.envelope),
          pendingFrameId:
            dependencies.attachmentRoutingState?.pendingAttachmentTarget?.frameId ??
            null,
          pendingTabId:
            dependencies.attachmentRoutingState?.pendingAttachmentTarget?.tabId ??
            null,
          sourceState: snapshot.sourceState,
        });
        return { ok: true };
      }

      dependencies.runtime.sendSignal(message.envelope);
      return { ok: true };
    }

    if (message.type === "screenmate:sync-local-playback") {
      if (isOffscreenAttachmentOwner(dependencies.runtime.getSnapshot())) {
        await dependencies.sendOffscreenMessage?.({
          type: "screenmate:offscreen-local-playback-control",
          action: message.action,
          currentTime: message.currentTime,
          playbackRate: message.playbackRate,
        });
      }
      return { ok: true };
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
      if (!isCurrentOrPendingAttachmentOwner(dependencies, snapshot, message)) {
        backgroundLogger.warn("Dropping outbound signal from non-owner content.", {
          activeFrameId: snapshot.activeFrameId,
          activeTabId: snapshot.activeTabId,
          messageFrameId: message.frameId ?? null,
          messageTabId: message.tabId ?? null,
          messageType: readSignalMessageType(message.envelope),
          pendingFrameId:
            dependencies.attachmentRoutingState?.pendingAttachmentTarget?.frameId ??
            null,
          pendingTabId:
            dependencies.attachmentRoutingState?.pendingAttachmentTarget?.tabId ??
            null,
          sourceState: snapshot.sourceState,
        });
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

    if (message.type === "screenmate:get-follow-active-tab-video-state") {
      return getFollowActiveTabVideoState(dependencies);
    }

    if (message.type === "screenmate:set-follow-active-tab-video") {
      const state = { enabled: message.enabled };
      await setFollowActiveTabVideoState(dependencies, state);
      if (state.enabled) {
        const activeTabId = await dependencies.queryActiveTabId();
        await followActiveTabVideoOnce(dependencies, activeTabId, {
          restart: true,
        });
      } else {
        await detachActiveFollowSource(dependencies);
      }
      return state;
    }

    if (message.type === "screenmate:start-sharing") {
      if (message.source.kind === "prepared-offscreen") {
        preparedSourceState =
          createPreparedSourceStateFromStartSource(message.source) ??
          await refreshPreparedSourceStateFromOffscreen(
            dependencies,
            preparedSourceState,
          );
        const snapshot = await startSharing(
          dependencies,
          preparedSourceState,
          message.source,
        );
        if (
          message.source.sourceType === "screen" &&
          snapshot.sourceState === "attached" &&
          isOffscreenAttachmentOwner(snapshot)
        ) {
          preparedSourceState = createEmptyPreparedSourceState();
        }
        return snapshot;
      }

      return startSharing(dependencies, preparedSourceState, message.source);
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

    if (message.type === "screenmate:content-ready") {
      if (message.screenmatePageKind === "viewer") {
        await getVideoCache(dependencies).removeTab(tabId);
        backgroundLogger.info(
          "Ignoring content-ready from self-identified ScreenMate viewer page.",
          {
            tabId,
          },
        );
        return dependencies.runtime.getSnapshot();
      }

      if (typeof message.tabId === "number") {
        const tabMetadata = await querySniffTabById(dependencies, message.tabId);
        if (isScreenMateViewerUrl(tabMetadata?.url, dependencies.viewerBaseUrl)) {
          backgroundLogger.info("Ignoring content-ready from ScreenMate viewer tab.", {
            tabId: message.tabId,
          });
          return dependencies.runtime.getSnapshot();
        }

        await getVideoCache(dependencies).setForFrame(
          message.tabId,
          message.frameId,
          message.videos.map((video) => ({
            ...video,
            frameId: message.frameId,
            tabId: message.tabId as number,
          })),
          tabMetadata ?? undefined,
        );
      }
      if (await shouldFollowContentReadyTab(dependencies, tabId)) {
        return followActiveTabVideoOnce(dependencies, tabId, { restart: true });
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
    onSnapshotUpdated() {
      const snapshot = runtime.getSnapshot();
      void browser.runtime
        .sendMessage({ type: "screenmate:room-snapshot-updated" })
        .catch(() => {
          // No popup may be open to receive the notification.
        });
      void notifyAttachedContentChat({
        snapshot,
        sendTabMessage(tabId, message, options) {
          return browser.tabs.sendMessage(
            tabId,
            message,
            options,
          ) as Promise<TabMessageResponse>;
        },
      });
    },
  });
  const videoSniffStateStorage = storage.defineItem<VideoSniffState>(
    "session:screenmate-video-sniff-state",
    {
      fallback: createEmptyVideoSniffState(),
    },
  );
  const followActiveTabVideoStateStorage =
    storage.defineItem<FollowActiveTabVideoState>(
      "local:screenmate-follow-active-tab-video-state",
      {
        fallback: { enabled: false },
      },
    );
  const videoCache = new VideoSourceCache(videoSniffStateStorage);
  const attachmentRoutingState = createAttachmentRoutingState();
  const internalHandler = createInternalHostNetworkHandler({
    fetchImpl: fetch,
  });
  const ensureOffscreenDocument = createOffscreenDocumentEnsurer();
  const sendOffscreenMessage = (message: OffscreenControlMessage) =>
    browser.runtime.sendMessage(message) as Promise<TabMessageResponse>;
  const sendPlayerMessage = (message: PlayerControlMessage) =>
    browser.runtime.sendMessage(message) as Promise<TabMessageResponse>;
  const forwardInboundSignal = createForwardInboundSignalHandler({
    attachmentRoutingState,
    runtime,
    sendTabMessage(tabId, message, options) {
      return browser.tabs.sendMessage(
        tabId,
        message,
        options,
      ) as Promise<TabMessageResponse>;
    },
    sendOffscreenMessage,
    sendPlayerMessage,
  });
  const messageDependencies: HostMessageHandlerDependencies = {
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
    followActiveTabVideoStateStorage,
    attachmentRoutingState,
    ensureOffscreenDocument,
    sendOffscreenMessage,
    sendPlayerMessage,
    sendTabMessage(tabId, message, options) {
      return browser.tabs.sendMessage(
        tabId,
        message,
        options,
      ) as Promise<TabMessageResponse>;
    },
    forwardInboundSignal,
  };
  const handler = createHostMessageHandler(messageDependencies);

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

  const scheduleFollowActiveTabVideo = createFollowActiveTabVideoScheduler({
    dependencies: messageDependencies,
  });

  browser.tabs.onActivated.addListener(({ tabId }) => {
    scheduleFollowActiveTabVideo(tabId);
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!tab.active || changeInfo.status !== "complete") {
      return;
    }

    scheduleFollowActiveTabVideo(tabId);
  });
});

export async function notifyAttachedContentChat({
  snapshot,
  sendTabMessage,
}: {
  snapshot: HostRoomSnapshot;
  sendTabMessage: (
    tabId: number,
    message: Extract<TabContentMessage, { type: "screenmate:update-chat-messages" }>,
    options: { frameId: number },
  ) => Promise<TabMessageResponse>;
}) {
  if (
    snapshot.sourceState !== "attached" ||
    snapshot.activeTabId === null ||
    snapshot.activeFrameId === null ||
    isSpecialAttachmentOwner(snapshot)
  ) {
    return false;
  }

  try {
    await sendTabMessage(
      snapshot.activeTabId,
      {
        type: "screenmate:update-chat-messages",
        messages: snapshot.chatMessages,
      },
      { frameId: snapshot.activeFrameId },
    );
    return true;
  } catch (error) {
    backgroundLogger.debug("Could not push chat messages to attached content.", {
      activeFrameId: snapshot.activeFrameId,
      activeTabId: snapshot.activeTabId,
      error: toErrorMessage(error),
    });
    return false;
  }
}

function createOffscreenDocumentEnsurer() {
  let creating: Promise<void> | null = null;

  return async () => {
    const chromeApi = getChromeApi();
    const offscreen = chromeApi?.offscreen;
    if (!offscreen?.createDocument) {
      throw new Error("Offscreen documents are not available.");
    }

    const offscreenUrl = browser.runtime.getURL("/offscreen.html");
    if (offscreen.hasDocument && await offscreen.hasDocument()) {
      return;
    }

    const contexts = await chromeApi?.runtime?.getContexts?.({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl],
    });
    if (contexts && contexts.length > 0) {
      return;
    }

    creating ??= offscreen
      .createDocument({
        url: "offscreen.html",
        reasons: ["DISPLAY_MEDIA", "USER_MEDIA", "WEB_RTC"],
        justification:
          "ScreenMate keeps screen and local video streams alive while the popup is closed.",
      })
      .catch((error: unknown) => {
        if (!String(error).includes("Only a single offscreen document")) {
          throw error;
        }
      })
      .finally(() => {
        creating = null;
      });
    await creating;
  };
}

type ChromeRuntimeApi = {
  offscreen?: {
    createDocument?: (parameters: {
      url: string;
      reasons: string[];
      justification: string;
    }) => Promise<void>;
    hasDocument?: () => Promise<boolean>;
  };
  runtime?: {
    getContexts?: (parameters: {
      contextTypes: string[];
      documentUrls?: string[];
    }) => Promise<Array<unknown>>;
  };
};

function getChromeApi() {
  return (globalThis as typeof globalThis & { chrome?: ChromeRuntimeApi }).chrome;
}

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
      if (message.type === "screenmate:set-room-access") {
        backgroundLogger.info("Updating room access via extension background.", {
          endpoint: `${message.apiBaseUrl}/rooms/${message.roomId}/access`,
          roomId: message.roomId,
        });

        try {
          return await updateRoomAccess(
            dependencies.fetchImpl,
            message.apiBaseUrl,
            message.roomId,
            message.hostToken,
            message.password,
          );
        } catch (error) {
          const formattedError = toErrorMessage(error);
          backgroundLogger.error("Background room access update failed.", {
            endpoint: `${message.apiBaseUrl}/rooms/${message.roomId}/access`,
            error: formattedError,
            roomId: message.roomId,
          });
          return { error: formattedError };
        }
      }

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
  attachmentRoutingState?: AttachmentRoutingState;
  runtime: Pick<
    HostRoomRuntime,
    "getSnapshot" | "shouldRefreshHostIce" | "refreshHostIce"
  >;
  sendTabMessage: (
    tabId: number,
    message: TabContentMessage,
    options?: { frameId?: number },
  ) => Promise<TabMessageResponse>;
  sendOffscreenMessage?: (
    message: OffscreenControlMessage,
  ) => Promise<TabMessageResponse>;
  sendPlayerMessage?: (
    message: PlayerControlMessage,
  ) => Promise<TabMessageResponse>;
}) {
  function getActiveAttachmentTarget() {
    const pendingTarget = dependencies.attachmentRoutingState
      ?.pendingAttachmentTarget;
    if (pendingTarget) {
      return pendingTarget;
    }

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
          if (isOffscreenSignalTarget(refreshedTarget)) {
            await dependencies.sendOffscreenMessage?.({
              type: "screenmate:offscreen-update-ice-servers",
              iceServers: refreshed.iceServers,
            });
          } else if (isPlayerSignalTarget(refreshedTarget)) {
            await dependencies.sendPlayerMessage?.({
              type: "screenmate:player-update-ice-servers",
              iceServers: refreshed.iceServers,
            });
          } else {
            await dependencies.sendTabMessage(
              refreshedTarget.tabId,
              {
                type: "screenmate:update-ice-servers",
                iceServers: refreshed.iceServers,
              },
              { frameId: refreshedTarget.frameId },
            );
          }
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
      backgroundLogger.warn("Could not forward inbound signal because no attachment target exists.", {
        messageType: envelope.messageType,
        pendingFrameId:
          dependencies.attachmentRoutingState?.pendingAttachmentTarget?.frameId ??
          null,
        pendingTabId:
          dependencies.attachmentRoutingState?.pendingAttachmentTarget?.tabId ??
          null,
      });
      return;
    }

    backgroundLogger.debug("Forwarding inbound signal to content attachment target.", {
      frameId: target.frameId,
      messageType: envelope.messageType,
      pendingFrameId:
        dependencies.attachmentRoutingState?.pendingAttachmentTarget?.frameId ??
        null,
      pendingTabId:
        dependencies.attachmentRoutingState?.pendingAttachmentTarget?.tabId ??
        null,
      tabId: target.tabId,
    });

    try {
      if (isOffscreenSignalTarget(target)) {
        await dependencies.sendOffscreenMessage?.({
          type: "screenmate:offscreen-signal-inbound",
          envelope,
        });
      } else if (isPlayerSignalTarget(target)) {
        await dependencies.sendPlayerMessage?.({
          type: "screenmate:player-signal-inbound",
          envelope,
        });
      } else {
        await dependencies.sendTabMessage(
          target.tabId,
          {
            type: "screenmate:signal-inbound",
            envelope,
          },
          { frameId: target.frameId },
        );
      }
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

function isOffscreenSignalTarget(target: AttachmentSignalTarget) {
  return (
    target.tabId === OFFSCREEN_ATTACHMENT_TAB_ID &&
    target.frameId === OFFSCREEN_ATTACHMENT_FRAME_ID
  );
}

function isPlayerSignalTarget(target: AttachmentSignalTarget) {
  return (
    target.tabId === PLAYER_ATTACHMENT_TAB_ID &&
    target.frameId === PLAYER_ATTACHMENT_FRAME_ID
  );
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

async function getFollowActiveTabVideoState(
  dependencies: HostMessageHandlerDependencies,
): Promise<FollowActiveTabVideoState> {
  if (!dependencies.followActiveTabVideoStateStorage) {
    return { enabled: false };
  }

  const stored = await dependencies.followActiveTabVideoStateStorage.getValue();
  return stored?.enabled === true ? { enabled: true } : { enabled: false };
}

async function setFollowActiveTabVideoState(
  dependencies: HostMessageHandlerDependencies,
  state: FollowActiveTabVideoState,
) {
  if (!state.enabled) {
    invalidateFollowActiveTabVideo(dependencies);
  }
  await dependencies.followActiveTabVideoStateStorage?.setValue(state);
}

function invalidateFollowActiveTabVideo(
  dependencies: HostMessageHandlerDependencies,
) {
  dependencies.attachmentRoutingState ??= createAttachmentRoutingState();
  dependencies.attachmentRoutingState.followActiveTabVideoGeneration += 1;
  dependencies.attachmentRoutingState.followActiveTabVideoPromise = null;
  dependencies.attachmentRoutingState.followActiveTabVideoTargetTabId = null;
}

async function disableFollowActiveTabVideo(
  dependencies: HostMessageHandlerDependencies,
) {
  try {
    await setFollowActiveTabVideoState(dependencies, { enabled: false });
  } catch (error) {
    backgroundLogger.warn("Could not clear automatic follow state.", {
      error: toErrorMessage(error),
    });
  }
}

async function detachActiveFollowSource(
  dependencies: HostMessageHandlerDependencies,
) {
  const snapshot = dependencies.runtime.getSnapshot();
  if (snapshot.sourceState !== "attached") {
    return snapshot;
  }

  await detachCurrentAttachmentOwner(dependencies, snapshot);
  return dependencies.runtime.markMissing("No video attached.");
}

async function shouldFollowContentReadyTab(
  dependencies: HostMessageHandlerDependencies,
  tabId: number,
) {
  const state = await getFollowActiveTabVideoState(dependencies);
  if (!state.enabled) {
    return false;
  }

  if (await isScreenMateViewerTab(dependencies, tabId)) {
    backgroundLogger.info("Ignoring content-ready follow from ScreenMate viewer tab.", {
      tabId,
    });
    return false;
  }

  return await dependencies.queryActiveTabId() === tabId;
}

function createFollowActiveTabVideoScheduler({
  debounceMs = FOLLOW_ACTIVE_TAB_VIDEO_DEBOUNCE_MS,
  dependencies,
}: {
  debounceMs?: number;
  dependencies: HostMessageHandlerDependencies;
}) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingTabId: number | null = null;

  return (tabId: number | null) => {
    pendingTabId = tabId;
    if (timer) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      timer = null;
      const nextTabId = pendingTabId;
      pendingTabId = null;

      void getFollowActiveTabVideoState(dependencies)
        .then((state) => {
          if (!state.enabled) {
            return undefined;
          }

          return followActiveTabVideoOnce(dependencies, nextTabId, {
            restart: true,
          });
        })
        .catch((error) => {
          backgroundLogger.warn("Could not follow active tab video.", {
            error: toErrorMessage(error),
            tabId: nextTabId,
          });
        });
    }, debounceMs);
  };
}

export async function followActiveTabVideoOnce(
  dependencies: HostMessageHandlerDependencies,
  activeTabId: number | null,
  options: { restart?: boolean } = {},
): Promise<HostRoomSnapshot> {
  dependencies.attachmentRoutingState ??= createAttachmentRoutingState();
  const routingState = dependencies.attachmentRoutingState;
  if (
    routingState.followActiveTabVideoPromise &&
    options.restart !== true &&
    routingState.followActiveTabVideoTargetTabId === activeTabId
  ) {
    backgroundLogger.info("Joining in-flight active tab follow.", {
      activeTabId,
    });
    return routingState.followActiveTabVideoPromise;
  }

  if (routingState.followActiveTabVideoPromise) {
    invalidateFollowActiveTabVideo(dependencies);
  }

  const followActiveTabVideoGeneration =
    routingState.followActiveTabVideoGeneration;
  const followPromise = followActiveTabVideoOnceUnserialized(
    dependencies,
    activeTabId,
    followActiveTabVideoGeneration,
  );
  routingState.followActiveTabVideoPromise = followPromise;
  routingState.followActiveTabVideoTargetTabId = activeTabId;

  try {
    return await followPromise;
  } finally {
    if (routingState.followActiveTabVideoPromise === followPromise) {
      routingState.followActiveTabVideoPromise = null;
      routingState.followActiveTabVideoTargetTabId = null;
    }
  }
}

async function followActiveTabVideoOnceUnserialized(
  dependencies: HostMessageHandlerDependencies,
  activeTabId: number | null,
  followActiveTabVideoGeneration: number,
): Promise<HostRoomSnapshot> {
  const snapshot = dependencies.runtime.getSnapshot();
  if (
    isStaleFollowActiveTabVideoRun(
      dependencies,
      followActiveTabVideoGeneration,
    )
  ) {
    return getStaleFollowActiveTabVideoSnapshot(dependencies, {
      activeTabId,
      stage: "start",
    });
  }

  if (
    snapshot.roomId === null ||
    snapshot.roomLifecycle === "idle" ||
    snapshot.roomLifecycle === "closed"
  ) {
    backgroundLogger.info("Skipping active tab follow because no room is open.", {
      activeTabId,
      roomLifecycle: snapshot.roomLifecycle,
    });
    return snapshot;
  }

  if (activeTabId === null) {
    if (
      isStaleFollowActiveTabVideoRun(
        dependencies,
        followActiveTabVideoGeneration,
      )
    ) {
      return getStaleFollowActiveTabVideoSnapshot(dependencies, {
        activeTabId,
        stage: "missing-active-tab",
      });
    }
    await detachCurrentAttachmentOwner(dependencies, snapshot);
    return dependencies.runtime.markMissing("No video attached.");
  }

  if (await isScreenMateViewerTab(dependencies, activeTabId)) {
    if (
      isStaleFollowActiveTabVideoRun(
        dependencies,
        followActiveTabVideoGeneration,
      )
    ) {
      return getStaleFollowActiveTabVideoSnapshot(dependencies, {
        activeTabId,
        stage: "viewer-tab",
      });
    }
    backgroundLogger.info("Active tab follow ignored the ScreenMate viewer tab.", {
      activeTabId,
    });
    await detachCurrentAttachmentOwner(dependencies, snapshot);
    return dependencies.runtime.markMissing("No video attached.");
  }

  const videos = await listVideosForTab(dependencies, activeTabId);
  await getVideoCache(dependencies).setForTab(activeTabId, videos);
  if (
    isStaleFollowActiveTabVideoRun(
      dependencies,
      followActiveTabVideoGeneration,
    )
  ) {
    return getStaleFollowActiveTabVideoSnapshot(dependencies, {
      activeTabId,
      stage: "after-video-scan",
    });
  }

  const bestVideo = selectBestFollowVideo(videos);

  if (!bestVideo) {
    backgroundLogger.info("Active tab follow found no usable video.", {
      activeTabId,
      videoCount: videos.length,
    });
    await detachCurrentAttachmentOwner(dependencies, snapshot);
    return dependencies.runtime.markMissing("No video attached.");
  }

  const currentFingerprint = dependencies.runtime.getSourceFingerprint();
  if (
    snapshot.sourceState === "attached" &&
    currentFingerprint &&
    bestVideo.fingerprint &&
    isSameAttachedFollowSource(currentFingerprint, bestVideo)
  ) {
    backgroundLogger.info("Active tab follow skipped duplicate source.", {
      activeTabId,
      frameId: bestVideo.frameId,
      videoId: bestVideo.id,
    });
    return snapshot;
  }

  backgroundLogger.info("Active tab follow attaching best video.", {
    activeTabId,
    frameId: bestVideo.frameId,
    isPlaying: bestVideo.isPlaying === true,
    label: bestVideo.label,
    videoId: bestVideo.id,
    visibleArea: bestVideo.visibleArea ?? null,
  });

  return attachSourceInFrame(
    dependencies,
    activeTabId,
    {
      type: "screenmate:attach-source",
      frameId: bestVideo.frameId,
      tabId: activeTabId,
      videoId: bestVideo.id,
    },
    {
      followActiveTabVideoGeneration,
    },
  );
}

function isStaleFollowActiveTabVideoRun(
  dependencies: HostMessageHandlerDependencies,
  followActiveTabVideoGeneration: number | undefined,
) {
  return (
    typeof followActiveTabVideoGeneration === "number" &&
    dependencies.attachmentRoutingState?.followActiveTabVideoGeneration !==
      followActiveTabVideoGeneration
  );
}

function getStaleFollowActiveTabVideoSnapshot(
  dependencies: HostMessageHandlerDependencies,
  context: { activeTabId: number | null; stage: string },
) {
  backgroundLogger.info("Ignoring stale active tab follow.", context);
  return dependencies.runtime.getSnapshot();
}

async function detachStaleFollowAttachment(
  dependencies: HostMessageHandlerDependencies,
  tabId: number,
  frameId: number,
) {
  try {
    await dependencies.sendTabMessage(
      tabId,
      { type: "screenmate:detach-source" },
      { frameId },
    );
  } catch (error) {
    backgroundLogger.warn("Could not detach stale active tab follow attachment.", {
      error: toErrorMessage(error),
      frameId,
      tabId,
    });
  }
}

function isSameAttachedFollowSource(
  stored: SourceFingerprint,
  candidate: TabVideoSource,
) {
  if (
    stored.tabId !== candidate.tabId ||
    stored.frameId !== candidate.frameId ||
    !candidate.fingerprint
  ) {
    return false;
  }

  if (stored.primaryUrl && candidate.fingerprint.primaryUrl) {
    return stored.primaryUrl === candidate.fingerprint.primaryUrl;
  }

  return isExactFingerprintMatch(stored, candidate.fingerprint);
}

function selectBestFollowVideo(videos: TabVideoSource[]): TabVideoSource | null {
  return videos
    .filter((video) => video.isVisible !== false)
    .sort(compareFollowVideoCandidates)[0] ?? null;
}

function compareFollowVideoCandidates(
  left: TabVideoSource,
  right: TabVideoSource,
) {
  const leftPlaying = left.isPlaying === true ? 1 : 0;
  const rightPlaying = right.isPlaying === true ? 1 : 0;
  if (leftPlaying !== rightPlaying) {
    return rightPlaying - leftPlaying;
  }

  return (right.visibleArea ?? 0) - (left.visibleArea ?? 0);
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
  const scannableTabs = windowTabs.filter((tab) =>
    isScannableSourceTab(tab, dependencies.viewerBaseUrl),
  );
  const sniffTabs = scannableTabs.map(toSniffTabSummary);
  await videoCache.markScanning(sniffTabs);

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
  return tabs
    .filter((tab) => isScannableSourceTab(tab, dependencies.viewerBaseUrl))
    .map(toSniffTabSummary);
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

function isScannableSourceTab(
  tab: { id: number; url?: string },
  viewerBaseUrl?: string,
) {
  if (!tab.url) {
    return true;
  }

  if (!(tab.url.startsWith("http://") || tab.url.startsWith("https://"))) {
    return false;
  }

  return !isScreenMateViewerUrl(tab.url, viewerBaseUrl);
}

async function isScreenMateViewerTab(
  dependencies: HostMessageHandlerDependencies,
  tabId: number,
) {
  const tab = await querySniffTabById(dependencies, tabId);
  return isScreenMateViewerUrl(tab?.url, dependencies.viewerBaseUrl);
}

async function querySniffTabById(
  dependencies: HostMessageHandlerDependencies,
  tabId: number,
): Promise<SniffTabSummary | null> {
  if (!dependencies.queryCurrentWindowTabs) {
    return null;
  }

  const tab = (await dependencies.queryCurrentWindowTabs()).find(
    (candidate) => candidate.id === tabId,
  );
  return tab ? toSniffTabSummary(tab) : null;
}

export function isScreenMateViewerUrl(
  value: string | null | undefined,
  viewerBaseUrl = getScreenMateViewerBaseUrl(),
) {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    const viewerBase = new URL(viewerBaseUrl);
    const sameConfiguredOrigin = url.origin === viewerBase.origin;
    const sameLocalViewerPort =
      url.port === viewerBase.port &&
      viewerBase.port === "4173" &&
      isLocalhostName(url.hostname) &&
      isLocalhostName(viewerBase.hostname);

    if (!sameConfiguredOrigin && !sameLocalViewerPort) {
      return false;
    }

    const basePath = viewerBase.pathname.replace(/\/+$/, "");
    return isViewerRoomPath(url.pathname, basePath);
  } catch {
    return false;
  }
}

function isViewerRoomPath(pathname: string, basePath: string) {
  const roomPrefix = `${basePath}/rooms`.replace(/\/{2,}/g, "/");
  return pathname === roomPrefix || pathname.startsWith(`${roomPrefix}/`);
}

function isLocalhostName(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function getVideoCache(dependencies: HostMessageHandlerDependencies) {
  dependencies.videoCache ??= new VideoSourceCache();
  return dependencies.videoCache;
}

async function startSharing(
  dependencies: HostMessageHandlerDependencies,
  preparedSourceState: PreparedSourceState,
  source: StartSharingSource,
) {
  const existingSnapshot = dependencies.runtime.getSnapshot();
  if (
    existingSnapshot.roomId === null ||
    existingSnapshot.roomLifecycle === "idle" ||
    existingSnapshot.roomLifecycle === "closed"
  ) {
    return createHostRoomSnapshot({
      ...existingSnapshot,
      message: "Create a sync room first.",
    });
  }

  if (source.kind === "prepared-offscreen") {
    await disableFollowActiveTabVideo(dependencies);
    return startPreparedOffscreenSource(
      dependencies,
      preparedSourceState,
      source.sourceType,
    );
  }

  if (source.kind === "player-local-video") {
    await disableFollowActiveTabVideo(dependencies);
    return startPlayerLocalVideoSource(dependencies, source.label);
  }

  if (source.kind === "active-tab-video") {
    const activeTabId = await dependencies.queryActiveTabId();
    if (activeTabId === null) {
      return createHostRoomSnapshot({
        ...dependencies.runtime.getSnapshot(),
        message: "Could not find an active tab to continue.",
      });
    }

    return followActiveTabVideoOnce(dependencies, activeTabId, { restart: true });
  }

  await disableFollowActiveTabVideo(dependencies);
  return attachSourceInFrame(dependencies, source.tabId, {
    type: "screenmate:attach-source",
    frameId: source.frameId,
    tabId: source.tabId,
    videoId: source.videoId,
  });
}

async function createRoomSession(
  dependencies: HostMessageHandlerDependencies,
) {
  const snapshot = dependencies.runtime.getSnapshot();
  if (
    snapshot.roomId !== null &&
    snapshot.roomLifecycle !== "idle" &&
    snapshot.roomLifecycle !== "closed"
  ) {
    return snapshot;
  }

  const roomResponse = await dependencies.createRoom(
    dependencies.apiBaseUrl ?? getScreenMateApiBaseUrl(),
  );
  if (!isRoomCreateResponse(roomResponse)) {
    return createHostRoomSnapshot({
      ...snapshot,
      message: isInternalHostNetworkErrorResponse(roomResponse)
        ? roomResponse.error
        : "Room creation returned an incomplete response.",
    });
  }

  await disableFollowActiveTabVideo(dependencies);

  const nextSnapshot = await dependencies.runtime.startRoom({
    roomId: roomResponse.roomId,
    hostSessionId: roomResponse.hostSessionId ?? "host",
    hostToken: roomResponse.hostToken,
    signalingUrl: roomResponse.signalingUrl,
    iceServers: roomResponse.iceServers ?? [],
    turnCredentialExpiresAt: roomResponse.turnCredentialExpiresAt ?? null,
    activeTabId: null,
    activeFrameId: null,
    viewerSessionIds: [],
    viewerCount: 0,
    viewerRoster: [],
    chatMessages: [],
    sourceFingerprint: null,
    recoverByTimestamp: null,
  });
  await dependencies.runtime.connectSignaling(dependencies.forwardInboundSignal);
  return nextSnapshot;
}

async function attachSourceInFrame(
  dependencies: HostMessageHandlerDependencies,
  tabId: number,
  message: AttachSourceInFrameRequest,
  options: { followActiveTabVideoGeneration?: number } = {},
) {
  dependencies.attachmentRoutingState ??= createAttachmentRoutingState();
  if (
    isStaleFollowActiveTabVideoRun(
      dependencies,
      options.followActiveTabVideoGeneration,
    )
  ) {
    return getStaleFollowActiveTabVideoSnapshot(dependencies, {
      activeTabId: tabId,
      stage: "before-attach-session",
    });
  }

  const roomSession = await getAttachSessionForNegotiation(dependencies);
  if (!roomSession) {
    backgroundLogger.warn("Manual source attach skipped because no room session is available.", {
      frameId: message.frameId,
      tabId,
      videoId: message.videoId,
    });
    return dependencies.runtime.getSnapshot();
  }
  if (
    isStaleFollowActiveTabVideoRun(
      dependencies,
      options.followActiveTabVideoGeneration,
    )
  ) {
    return getStaleFollowActiveTabVideoSnapshot(dependencies, {
      activeTabId: tabId,
      stage: "after-attach-session",
    });
  }

  const snapshot = dependencies.runtime.getSnapshot();
  backgroundLogger.info("Manual source attach requested.", {
    activeFrameId: snapshot.activeFrameId,
    activeTabId: snapshot.activeTabId,
    frameId: message.frameId,
    roomId: roomSession.roomId,
    sourceState: snapshot.sourceState,
    tabId,
    videoId: message.videoId,
    viewerCount: snapshot.viewerCount,
    viewerSessionCount: roomSession.viewerSessionIds.length,
    viewerSessionIds: roomSession.viewerSessionIds,
  });

  if (
    snapshot.activeTabId !== tabId ||
    snapshot.activeFrameId !== message.frameId
  ) {
    await detachCurrentAttachmentOwner(dependencies, snapshot);
  }
  if (
    isStaleFollowActiveTabVideoRun(
      dependencies,
      options.followActiveTabVideoGeneration,
    )
  ) {
    return getStaleFollowActiveTabVideoSnapshot(dependencies, {
      activeTabId: tabId,
      stage: "after-detach-current-owner",
    });
  }

  const pendingTarget = {
    tabId,
    frameId: message.frameId,
  };
  dependencies.attachmentRoutingState.pendingAttachmentTarget = pendingTarget;
  backgroundLogger.info("Pending attachment target registered.", {
    frameId: pendingTarget.frameId,
    roomId: roomSession.roomId,
    tabId: pendingTarget.tabId,
    videoId: message.videoId,
  });

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

    if (
      isStaleFollowActiveTabVideoRun(
        dependencies,
        options.followActiveTabVideoGeneration,
      )
    ) {
      await detachStaleFollowAttachment(dependencies, tabId, message.frameId);
      return getStaleFollowActiveTabVideoSnapshot(dependencies, {
        activeTabId: tabId,
        stage: "after-attach-response",
      });
    }

    if (!isAttachSourceResponse(response)) {
      backgroundLogger.warn("Manual source attach returned an invalid response.", {
        frameId: message.frameId,
        roomId: roomSession.roomId,
        tabId,
        videoId: message.videoId,
        viewerSessionCount: roomSession.viewerSessionIds.length,
      });
      return dependencies.runtime.markMissing("No video attached.");
    }

    backgroundLogger.info("Manual source attach sent to content successfully.", {
      frameId: message.frameId,
      roomId: roomSession.roomId,
      sourceLabel: response.sourceLabel,
      tabId,
      videoId: message.videoId,
      viewerSessionCount: roomSession.viewerSessionIds.length,
      viewerSessionIds: roomSession.viewerSessionIds,
    });

    const attachedSnapshot = await dependencies.runtime.setAttachedSource(response.sourceLabel, {
      ...response.fingerprint,
      frameId: message.frameId,
      tabId,
    });
    await forwardNewlyKnownViewersToAttachmentTarget(
      dependencies,
      pendingTarget,
      roomSession.viewerSessionIds,
    );
    return attachedSnapshot;
  } catch (error) {
    backgroundLogger.warn("Could not attach source in frame.", {
      error: toErrorMessage(error),
      frameId: message.frameId,
      tabId,
      videoId: message.videoId,
    });
    return dependencies.runtime.markMissing("No video attached.");
  } finally {
    if (
      dependencies.attachmentRoutingState.pendingAttachmentTarget?.tabId ===
        pendingTarget.tabId &&
      dependencies.attachmentRoutingState.pendingAttachmentTarget?.frameId ===
        pendingTarget.frameId
    ) {
      dependencies.attachmentRoutingState.pendingAttachmentTarget = null;
      backgroundLogger.info("Pending attachment target cleared.", {
        frameId: pendingTarget.frameId,
        roomId: roomSession.roomId,
        tabId: pendingTarget.tabId,
        videoId: message.videoId,
      });
    }
  }
}

async function startPreparedOffscreenSource(
  dependencies: HostMessageHandlerDependencies,
  preparedSourceState: PreparedSourceState,
  requestedSourceType: "screen" | "upload",
) {
  if (
    !preparedSourceState.ready ||
    (requestedSourceType === "screen" && preparedSourceState.kind !== "screen") ||
    (requestedSourceType === "upload" && preparedSourceState.kind !== "upload")
  ) {
    return createHostRoomSnapshot({
      ...dependencies.runtime.getSnapshot(),
      message: "No prepared source is ready.",
    });
  }

  if (!dependencies.sendOffscreenMessage || !dependencies.ensureOffscreenDocument) {
    return createHostRoomSnapshot({
      ...dependencies.runtime.getSnapshot(),
      message: "Offscreen streaming is not available in this browser.",
    });
  }

  try {
    await dependencies.ensureOffscreenDocument();
  } catch (error) {
    backgroundLogger.warn("Could not prepare offscreen document.", {
      error: toErrorMessage(error),
      sourceType: requestedSourceType,
    });
    return createHostRoomSnapshot({
      ...dependencies.runtime.getSnapshot(),
      message: "Offscreen streaming is not available in this browser.",
    });
  }

  const snapshot = dependencies.runtime.getSnapshot();
  if (
    snapshot.roomId === null ||
    snapshot.roomLifecycle === "idle" ||
    snapshot.roomLifecycle === "closed"
  ) {
    return createHostRoomSnapshot({
      ...snapshot,
      message: "Create a sync room first.",
    });
  }

  if (!isOffscreenAttachmentOwner(snapshot)) {
    await detachCurrentAttachmentOwner(dependencies, snapshot);
  }

  const roomSession = await getAttachSessionForNegotiation(dependencies);
  if (!roomSession) {
    return dependencies.runtime.getSnapshot();
  }

  dependencies.attachmentRoutingState ??= createAttachmentRoutingState();
  const pendingTarget = {
    tabId: OFFSCREEN_ATTACHMENT_TAB_ID,
    frameId: OFFSCREEN_ATTACHMENT_FRAME_ID,
  };
  dependencies.attachmentRoutingState.pendingAttachmentTarget = pendingTarget;
  backgroundLogger.info("Prepared offscreen source attach requested.", {
    preparedKind: preparedSourceState.kind,
    requestedSourceType,
    roomId: roomSession.roomId,
    sourceLabel: preparedSourceState.label,
    viewerSessionCount: roomSession.viewerSessionIds.length,
  });

  try {
    const response = await withTimeout(
      preparedSourceState.kind === "screen"
        ? dependencies.sendOffscreenMessage({
            type: "screenmate:offscreen-attach-display-media",
            roomSession,
            sourceLabel: preparedSourceState.label,
          })
        : dependencies.sendOffscreenMessage({
            type: "screenmate:offscreen-attach-local-file",
            roomSession,
            fileId: preparedSourceState.fileId,
            metadata: preparedSourceState.metadata,
          }),
      getOffscreenAttachTimeoutMs(requestedSourceType),
      getOffscreenAttachTimeoutMessage(requestedSourceType),
    );

    if (isOffscreenErrorResponse(response)) {
      return dependencies.runtime.markMissing(response.error);
    }

    if (!isAttachSourceResponse(response)) {
      return dependencies.runtime.markMissing("No offscreen source attached.");
    }

    backgroundLogger.info("Prepared offscreen source attached.", {
      requestedSourceType,
      responseSourceLabel: response.sourceLabel,
      roomId: roomSession.roomId,
    });
    const attachedSnapshot = await dependencies.runtime.setAttachedSource(response.sourceLabel, {
      ...response.fingerprint,
      frameId: OFFSCREEN_ATTACHMENT_FRAME_ID,
      tabId: OFFSCREEN_ATTACHMENT_TAB_ID,
    });
    await forwardNewlyKnownViewersToAttachmentTarget(
      dependencies,
      pendingTarget,
      roomSession.viewerSessionIds,
    );
    return attachedSnapshot;
  } catch (error) {
    const errorMessage = toErrorMessage(error);
    backgroundLogger.warn("Could not attach prepared offscreen source.", {
      error: errorMessage,
      sourceType: requestedSourceType,
    });
    return dependencies.runtime.markMissing(errorMessage);
  } finally {
    if (isAttachmentTargetOwner(
      dependencies.attachmentRoutingState.pendingAttachmentTarget,
      pendingTarget,
    )) {
      dependencies.attachmentRoutingState.pendingAttachmentTarget = null;
    }
  }
}

async function startPlayerLocalVideoSource(
  dependencies: HostMessageHandlerDependencies,
  sourceLabel: string,
) {
  if (!dependencies.sendPlayerMessage) {
    return createHostRoomSnapshot({
      ...dependencies.runtime.getSnapshot(),
      message: "Local player streaming is not available in this browser.",
    });
  }

  const snapshot = dependencies.runtime.getSnapshot();
  if (
    snapshot.roomId === null ||
    snapshot.roomLifecycle === "idle" ||
    snapshot.roomLifecycle === "closed"
  ) {
    return createHostRoomSnapshot({
      ...snapshot,
      message: "Create a sync room first.",
    });
  }

  if (!isPlayerAttachmentOwner(snapshot)) {
    await detachCurrentAttachmentOwner(dependencies, snapshot);
  }

  const roomSession = await getAttachSessionForNegotiation(dependencies);
  if (!roomSession) {
    return dependencies.runtime.getSnapshot();
  }

  dependencies.attachmentRoutingState ??= createAttachmentRoutingState();
  const pendingTarget = {
    tabId: PLAYER_ATTACHMENT_TAB_ID,
    frameId: PLAYER_ATTACHMENT_FRAME_ID,
  };
  dependencies.attachmentRoutingState.pendingAttachmentTarget = pendingTarget;
  backgroundLogger.info("Player local source attach requested.", {
    roomId: roomSession.roomId,
    sourceLabel,
    viewerSessionCount: roomSession.viewerSessionIds.length,
  });

  try {
    const response = await withTimeout(
      dependencies.sendPlayerMessage({
        type: "screenmate:player-attach-local-video",
        roomSession,
        sourceLabel,
      }),
      PLAYER_ATTACH_TIMEOUT_MS,
      "Player local source did not respond before the timeout.",
    );

    if (isOffscreenErrorResponse(response)) {
      return dependencies.runtime.markMissing(response.error);
    }

    if (!isAttachSourceResponse(response)) {
      return dependencies.runtime.markMissing("No player local source attached.");
    }

    backgroundLogger.info("Player local source attached.", {
      responseSourceLabel: response.sourceLabel,
      roomId: roomSession.roomId,
    });
    const attachedSnapshot = await dependencies.runtime.setAttachedSource(response.sourceLabel, {
      ...response.fingerprint,
      frameId: PLAYER_ATTACHMENT_FRAME_ID,
      tabId: PLAYER_ATTACHMENT_TAB_ID,
    });
    await forwardNewlyKnownViewersToAttachmentTarget(
      dependencies,
      pendingTarget,
      roomSession.viewerSessionIds,
    );
    return attachedSnapshot;
  } catch (error) {
    const errorMessage = toErrorMessage(error);
    backgroundLogger.warn("Could not attach player local source.", {
      error: errorMessage,
    });
    return dependencies.runtime.markMissing(errorMessage);
  } finally {
    if (isAttachmentTargetOwner(
      dependencies.attachmentRoutingState.pendingAttachmentTarget,
      pendingTarget,
    )) {
      dependencies.attachmentRoutingState.pendingAttachmentTarget = null;
    }
  }
}

async function refreshPreparedSourceStateFromOffscreen(
  dependencies: HostMessageHandlerDependencies,
  currentState: PreparedSourceState,
): Promise<PreparedSourceState> {
  if (
    currentState.ready ||
    !dependencies.ensureOffscreenDocument ||
    !dependencies.sendOffscreenMessage
  ) {
    return currentState;
  }

  try {
    await dependencies.ensureOffscreenDocument();
    const response = await dependencies.sendOffscreenMessage({
      type: "screenmate:offscreen-get-prepared-display-media-state",
    });
    if (!isAttachSourceResponse(response)) {
      return currentState;
    }

    return {
      status: "prepared-source",
      kind: "screen",
      ready: true,
      label: response.sourceLabel,
      metadata: null,
      captureType: "screen",
      error: null,
    };
  } catch (error) {
    backgroundLogger.debug("No prepared offscreen source could be restored.", {
      error: toErrorMessage(error),
    });
    return currentState;
  }
}

async function getLocalPlaybackStateFromOffscreen(
  dependencies: HostMessageHandlerDependencies,
): Promise<LocalPlaybackState> {
  if (!dependencies.ensureOffscreenDocument || !dependencies.sendOffscreenMessage) {
    return createInactiveLocalPlaybackState();
  }

  try {
    await dependencies.ensureOffscreenDocument();
    const response = await dependencies.sendOffscreenMessage({
      type: "screenmate:offscreen-get-local-playback-state",
    });

    return isLocalPlaybackStateResponse(response)
      ? response
      : createInactiveLocalPlaybackState();
  } catch (error) {
    backgroundLogger.debug("No active offscreen local playback state could be read.", {
      error: toErrorMessage(error),
    });
    return createInactiveLocalPlaybackState();
  }
}

function createPreparedSourceStateFromStartSource(
  source: StartSharingSource,
): PreparedSourceState | null {
  if (
    source.kind !== "prepared-offscreen" ||
    source.sourceType !== "upload" ||
    typeof source.fileId !== "string" ||
    !isLocalMediaMetadata(source.metadata)
  ) {
    return null;
  }

  return {
    status: "prepared-source",
    kind: "upload",
    ready: true,
    label:
      typeof source.label === "string" && source.label.trim()
        ? source.label
        : source.metadata.name,
    metadata: source.metadata,
    fileId: source.fileId,
    error: null,
  };
}

async function forwardNewlyKnownViewersToAttachmentTarget(
  dependencies: HostMessageHandlerDependencies,
  target: AttachmentSignalTarget,
  alreadyAttachedViewerSessionIds: string[],
) {
  const latestRoomSession = dependencies.runtime.getAttachSession();
  if (!latestRoomSession) {
    return;
  }

  const alreadyAttachedViewerSessionIdSet = new Set(
    alreadyAttachedViewerSessionIds,
  );
  const viewerSessionIds = [
    ...new Set(latestRoomSession.viewerSessionIds),
  ].filter(
    (viewerSessionId) =>
      !alreadyAttachedViewerSessionIdSet.has(viewerSessionId),
  );
  if (viewerSessionIds.length === 0) {
    return;
  }

  backgroundLogger.info("Forwarding newly known viewers to attached source.", {
    frameId: target.frameId,
    roomId: latestRoomSession.roomId,
    tabId: target.tabId,
    viewerSessionCount: viewerSessionIds.length,
    viewerSessionIds,
  });

  for (const viewerSessionId of viewerSessionIds) {
    await sendInboundSignalToAttachmentTarget(dependencies, target, {
      roomId: latestRoomSession.roomId,
      sessionId: viewerSessionId,
      role: "viewer",
      messageType: "viewer-joined",
      timestamp: Date.now(),
      payload: {
        viewerSessionId,
      },
    });
  }
}

async function sendInboundSignalToAttachmentTarget(
  dependencies: Pick<
    HostMessageHandlerDependencies,
    "sendOffscreenMessage" | "sendPlayerMessage" | "sendTabMessage"
  >,
  target: AttachmentSignalTarget,
  envelope: SignalEnvelope,
) {
  if (isOffscreenSignalTarget(target)) {
    await dependencies.sendOffscreenMessage?.({
      type: "screenmate:offscreen-signal-inbound",
      envelope,
    });
    return;
  }

  if (isPlayerSignalTarget(target)) {
    await dependencies.sendPlayerMessage?.({
      type: "screenmate:player-signal-inbound",
      envelope,
    });
    return;
  }

  await dependencies.sendTabMessage(
    target.tabId,
    {
      type: "screenmate:signal-inbound",
      envelope,
    },
    { frameId: target.frameId },
  );
}

async function detachCurrentAttachmentOwner(
  dependencies: HostMessageHandlerDependencies,
  snapshot = dependencies.runtime.getSnapshot(),
) {
  if (isOffscreenAttachmentOwner(snapshot)) {
    try {
      await dependencies.sendOffscreenMessage?.({
        type: "screenmate:offscreen-detach-source",
      });
    } catch (error) {
      backgroundLogger.warn("Could not detach offscreen source.", {
        error: toErrorMessage(error),
      });
    }
    return;
  }

  if (isPlayerAttachmentOwner(snapshot)) {
    try {
      await dependencies.sendPlayerMessage?.({
        type: "screenmate:player-detach-source",
      });
    } catch (error) {
      backgroundLogger.warn("Could not detach player local source.", {
        error: toErrorMessage(error),
      });
    }
    return;
  }

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
    case "screenmate:create-room-session":
    case "screenmate:get-prepared-source-state":
    case "screenmate:get-local-playback-state":
    case "screenmate:clear-prepared-source-state":
    case "screenmate:get-video-sniff-state":
    case "screenmate:ensure-video-sniff-state":
    case "screenmate:refresh-video-sniff-state":
    case "screenmate:get-follow-active-tab-video-state":
      return true;
    case "screenmate:set-follow-active-tab-video":
      return typeof message.enabled === "boolean";
    case "screenmate:prepare-screen-source":
      return (
        message.captureType === "screen" ||
        message.captureType === "window" ||
        message.captureType === "tab"
      );
    case "screenmate:prepare-local-file-source":
      return (
        typeof message.fileId === "string" &&
        isRecord(message.metadata) &&
        typeof message.metadata.id === "string" &&
        typeof message.metadata.name === "string" &&
        typeof message.metadata.size === "number" &&
        typeof message.metadata.type === "string"
      );
    case "screenmate:start-sharing":
      return isStartSharingSource(message.source);
    case "screenmate:sync-local-playback":
      return (
        (message.action === "play" ||
          message.action === "pause" ||
          message.action === "seek" ||
          message.action === "ratechange") &&
        (typeof message.currentTime === "undefined" ||
          typeof message.currentTime === "number") &&
        (typeof message.playbackRate === "undefined" ||
          typeof message.playbackRate === "number")
      );
    case "screenmate:offscreen-signal-outbound":
    case "screenmate:player-signal-outbound":
      return isRecord(message.envelope);
    case "screenmate:offscreen-source-detached":
    case "screenmate:player-source-detached":
      return (
        typeof message.roomId === "string" &&
        (message.reason === "track-ended" ||
          message.reason === "content-invalidated" ||
          message.reason === "manual-detach")
      );
    case "screenmate:send-chat-message":
      return typeof message.text === "string" && message.text.trim().length > 0;
    case "screenmate:set-room-password":
      return typeof message.password === "string";
    case "screenmate:list-videos":
      return (
        typeof message.refresh === "undefined" ||
        typeof message.refresh === "boolean"
      );
    case "screenmate:stop-room":
    case "screenmate:clear-preview":
      return true;
    case "screenmate:content-ready":
      return (
        typeof message.frameId === "number" &&
        (
          typeof message.screenmatePageKind === "undefined" ||
          message.screenmatePageKind === null ||
          message.screenmatePageKind === "viewer"
        ) &&
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

function isStartSharingSource(source: unknown): source is StartSharingSource {
  if (!isRecord(source) || typeof source.kind !== "string") {
    return false;
  }

  if (source.kind === "active-tab-video") {
    return true;
  }

  if (source.kind === "player-local-video") {
    return typeof source.label === "string" && source.label.trim().length > 0;
  }

  if (source.kind === "prepared-offscreen") {
    if (source.sourceType === "screen") {
      return true;
    }

    if (source.sourceType !== "upload") {
      return false;
    }

    const hasInlineUploadSource =
      "fileId" in source || "metadata" in source || "label" in source;
    if (!hasInlineUploadSource) {
      return true;
    }

    return (
      typeof source.fileId === "string" &&
      isLocalMediaMetadata(source.metadata) &&
      (
        typeof source.label === "undefined" ||
        typeof source.label === "string"
      )
    );
  }

  if (source.kind === "tab-video") {
    return (
      typeof source.tabId === "number" &&
      typeof source.frameId === "number" &&
      typeof source.videoId === "string"
    );
  }

  return false;
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

function isOffscreenAttachmentOwner(
  snapshot: Pick<HostRoomSnapshot, "activeFrameId" | "activeTabId">,
) {
  return (
    snapshot.activeTabId === OFFSCREEN_ATTACHMENT_TAB_ID &&
    snapshot.activeFrameId === OFFSCREEN_ATTACHMENT_FRAME_ID
  );
}

function isPlayerAttachmentOwner(
  snapshot: Pick<HostRoomSnapshot, "activeFrameId" | "activeTabId">,
) {
  return (
    snapshot.activeTabId === PLAYER_ATTACHMENT_TAB_ID &&
    snapshot.activeFrameId === PLAYER_ATTACHMENT_FRAME_ID
  );
}

function isSpecialAttachmentOwner(
  snapshot: Pick<HostRoomSnapshot, "activeFrameId" | "activeTabId">,
) {
  return isOffscreenAttachmentOwner(snapshot) || isPlayerAttachmentOwner(snapshot);
}

function isCurrentOrPendingAttachmentOwner(
  dependencies: Pick<HostMessageHandlerDependencies, "attachmentRoutingState">,
  snapshot: Pick<HostRoomSnapshot, "activeFrameId" | "activeTabId">,
  message: {
    frameId?: number | null;
    tabId?: number | null;
  },
) {
  if (isCurrentAttachmentOwner(snapshot, message)) {
    return true;
  }

  const pendingTarget =
    dependencies.attachmentRoutingState?.pendingAttachmentTarget;
  return isAttachmentTargetOwner(pendingTarget, message);
}

function isAttachmentTargetOwner(
  target: AttachmentSignalTarget | null | undefined,
  message: {
    frameId?: number | null;
    tabId?: number | null;
  },
) {
  return (
    !!target &&
    message.tabId === target.tabId &&
    message.frameId === target.frameId
  );
}

function readSignalMessageType(envelope: Record<string, unknown>) {
  return typeof envelope.messageType === "string"
    ? envelope.messageType
    : null;
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
  const candidate = value as Record<string, unknown>;
  return (
    isRecord(value) &&
    !Array.isArray(value) &&
    !("ok" in value) &&
    typeof candidate.sourceLabel === "string" &&
    isRecord(candidate.fingerprint)
  );
}

function isLocalPlaybackStateResponse(
  value: TabMessageResponse,
): value is LocalPlaybackState {
  const candidate = value as Record<string, unknown>;
  return (
    isRecord(value) &&
    !Array.isArray(value) &&
    candidate.status === "local-playback-state" &&
    typeof candidate.active === "boolean" &&
    (typeof candidate.currentTime === "number" || candidate.currentTime === null) &&
    (typeof candidate.duration === "number" || candidate.duration === null) &&
    (typeof candidate.paused === "boolean" || candidate.paused === null) &&
    (typeof candidate.playbackRate === "number" || candidate.playbackRate === null) &&
    (typeof candidate.sourceLabel === "string" || candidate.sourceLabel === null)
  );
}

function isOffscreenErrorResponse(
  value: TabMessageResponse,
): value is OffscreenErrorResponse {
  return (
    !!value &&
    !Array.isArray(value) &&
    "ok" in value &&
    value.ok === false &&
    typeof value.error === "string"
  );
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

function getOffscreenAttachTimeoutMessage(sourceType: "screen" | "upload") {
  return sourceType === "upload"
    ? "Offscreen local source did not respond before the timeout."
    : "Offscreen screen source did not respond before the timeout.";
}

function getOffscreenAttachTimeoutMs(sourceType: "screen" | "upload") {
  return sourceType === "upload"
    ? OFFSCREEN_LOCAL_FILE_ATTACH_TIMEOUT_MS
    : OFFSCREEN_SCREEN_ATTACH_TIMEOUT_MS;
}

function isRoomCreateResponse(
  response: InternalHostNetworkResponse,
): response is RoomCreateResponse {
  return (
    isRecord(response) &&
    "roomId" in response &&
    typeof response.roomId === "string" &&
    "hostToken" in response &&
    typeof response.hostToken === "string" &&
    "signalingUrl" in response &&
    typeof response.signalingUrl === "string"
  );
}

function isInternalHostNetworkErrorResponse(
  response: InternalHostNetworkResponse,
): response is InternalHostNetworkErrorResponse {
  return isRecord(response) && "error" in response && typeof response.error === "string";
}

function isInternalHostNetworkMessage(
  message: unknown,
): message is InternalHostNetworkMessage {
  if (!isRecord(message) || typeof message.apiBaseUrl !== "string") {
    return false;
  }

  if (message.type === "screenmate:create-room") {
    return true;
  }

  return (
    message.type === "screenmate:set-room-access" &&
    typeof message.roomId === "string" &&
    typeof message.hostToken === "string" &&
    typeof message.password === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLocalMediaMetadata(value: unknown): value is LocalMediaMetadata {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.size === "number" &&
    typeof value.type === "string" &&
    typeof value.updatedAt === "number"
  );
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
