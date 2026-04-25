import type { RoomChatMessage, ViewerRosterEntry } from "@screenmate/shared";

export type HostRoomLifecycle =
  | "idle"
  | "opening"
  | "open"
  | "degraded"
  | "closed";

export type HostSourceState =
  | "unattached"
  | "attaching"
  | "attached"
  | "recovering"
  | "missing";

export type SourceFingerprint = {
  tabId: number;
  frameId: number;
  primaryUrl: string | null;
  pageUrl: string | null;
  elementId: string | null;
  label: string;
  visibleIndex: number;
};

export type PersistedHostRoomSession = {
  roomId: string;
  hostSessionId: string;
  hostToken: string;
  signalingUrl: string;
  iceServers: RTCIceServer[];
  turnCredentialExpiresAt?: number | null;
  activeTabId: number;
  activeFrameId: number;
  viewerSessionIds: string[];
  viewerCount: number;
  viewerRoster?: ViewerRosterEntry[];
  chatMessages?: RoomChatMessage[];
  sourceFingerprint: SourceFingerprint | null;
  recoverByTimestamp: number | null;
};

export type HostRoomSnapshot = {
  roomLifecycle: HostRoomLifecycle;
  sourceState: HostSourceState;
  roomId: string | null;
  viewerCount: number;
  viewerRoster: ViewerRosterEntry[];
  chatMessages: RoomChatMessage[];
  sourceLabel: string | null;
  activeTabId: number | null;
  activeFrameId: number | null;
  recoverByTimestamp: number | null;
  message: string | null;
};

export function createHostRoomSnapshot(
  overrides: Partial<HostRoomSnapshot> = {},
): HostRoomSnapshot {
  return {
    roomLifecycle: "idle",
    sourceState: "unattached",
    roomId: null,
    viewerCount: 0,
    viewerRoster: [],
    chatMessages: [],
    sourceLabel: null,
    activeTabId: null,
    activeFrameId: null,
    recoverByTimestamp: null,
    message: null,
    ...overrides,
  };
}

export function createHostRoomStore(
  now: () => number,
  recoverWindowMs = 15_000,
) {
  let snapshot = createHostRoomSnapshot();

  return {
    getSnapshot: () => snapshot,
    openRoom(session: PersistedHostRoomSession) {
      const viewerRoster = session.viewerRoster ?? [];
      const chatMessages = session.chatMessages ?? [];
      snapshot = createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "unattached",
        roomId: session.roomId,
        viewerCount: countOnlineViewers(session.viewerRoster, session.viewerCount),
        viewerRoster,
        chatMessages,
        activeTabId: session.activeTabId,
        activeFrameId: session.activeFrameId,
      });
      return snapshot;
    },
    setRoomActivity(input: {
      viewerRoster?: ViewerRosterEntry[];
      chatMessages?: RoomChatMessage[];
    }) {
      const hasViewerRoster = Object.hasOwn(input, "viewerRoster");
      const viewerRoster = !hasViewerRoster
        ? snapshot.viewerRoster
        : input.viewerRoster ?? snapshot.viewerRoster;
      snapshot = {
        ...snapshot,
        viewerRoster,
        chatMessages: input.chatMessages ?? snapshot.chatMessages,
        viewerCount: hasViewerRoster
          ? countOnlineViewers(input.viewerRoster, snapshot.viewerCount)
          : snapshot.viewerCount,
      };
      return snapshot;
    },
    setAttached(sourceLabel: string, owner: { tabId: number; frameId: number }) {
      snapshot = {
        ...snapshot,
        roomLifecycle: "open",
        sourceState: "attached",
        sourceLabel,
        activeTabId: owner.tabId,
        activeFrameId: owner.frameId,
        message: null,
        recoverByTimestamp: null,
      };
      return snapshot;
    },
    markRecovering(
      message: string,
      recoverByTimestamp = now() + recoverWindowMs,
    ) {
      snapshot = {
        ...snapshot,
        roomLifecycle: "degraded",
        sourceState: "recovering",
        message,
        recoverByTimestamp,
      };
      return snapshot;
    },
    markMissing(message: string) {
      snapshot = {
        ...snapshot,
        roomLifecycle: "open",
        sourceState: "missing",
        message,
        recoverByTimestamp: null,
      };
      return snapshot;
    },
    setViewerCount(viewerCount: number) {
      snapshot = {
        ...snapshot,
        viewerCount: Math.max(0, viewerCount),
      };
      return snapshot;
    },
    close(message: string) {
      snapshot = {
        ...snapshot,
        roomLifecycle: "closed",
        sourceState: "missing",
        message,
        recoverByTimestamp: null,
      };
      return snapshot;
    },
  };
}

function countOnlineViewers(
  viewerRoster: ViewerRosterEntry[] | undefined,
  fallbackViewerCount: number,
) {
  if (!viewerRoster) {
    return Math.max(0, fallbackViewerCount);
  }

  return viewerRoster.filter((viewer) => viewer.online).length;
}
