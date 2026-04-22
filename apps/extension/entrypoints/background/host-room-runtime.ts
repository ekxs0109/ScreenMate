import {
  signalEnvelopeSchema,
  type RoomSourceState,
  type RoomState,
} from "@screenmate/shared";
import {
  getScreenMateApiBaseUrl,
  toScreenMateWebSocketUrl,
} from "../../lib/config";
import { refreshHostIce as requestHostIceRefresh } from "../../lib/room-api";
import {
  createHostRoomStore,
  type HostSourceState,
  type HostRoomSnapshot,
  type PersistedHostRoomSession,
  type SourceFingerprint,
} from "./host-room-snapshot";

const STORAGE_KEY = "screenmateHostRoomSession";
const OPEN_SOCKET_READY_STATE = 1;
const HEARTBEAT_INTERVAL_MS = 20_000;
export const TURN_REFRESH_SKEW_MS = 60_000;

type SessionStorageLike = {
  get: (key: string) => Promise<Record<string, PersistedHostRoomSession | undefined>>;
  set: (value: Record<string, PersistedHostRoomSession>) => Promise<void>;
  remove: (key: string) => Promise<void>;
};

export type HostSocket = Pick<
  WebSocket,
  "addEventListener" | "close" | "readyState" | "send"
>;

export type SignalEnvelope = typeof signalEnvelopeSchema._output;
export type HostRoomRuntime = ReturnType<typeof createHostRoomRuntime>;

export function createHostRoomRuntime(options: {
  storage: SessionStorageLike;
  now?: () => number;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  WebSocketImpl?: new (url: string) => HostSocket;
}) {
  const now = options.now ?? Date.now;
  const apiBaseUrl = options.apiBaseUrl ?? getScreenMateApiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;
  const store = createHostRoomStore(now);
  const WebSocketImpl = options.WebSocketImpl ?? globalThis.WebSocket;
  let session: PersistedHostRoomSession | null = null;
  let socket: HostSocket | null = null;
  let pendingOutboundSignals: string[] = [];
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let heartbeatSequence = 0;

  async function persist() {
    if (session) {
      await options.storage.set({ [STORAGE_KEY]: session });
      return;
    }

    await options.storage.remove(STORAGE_KEY);
  }

  function isSameSession(
    currentSession: PersistedHostRoomSession | null,
    targetSession: PersistedHostRoomSession | null,
  ) {
    if (!currentSession || !targetSession) {
      return false;
    }

    return (
      currentSession.roomId === targetSession.roomId &&
      currentSession.hostSessionId === targetSession.hostSessionId &&
      currentSession.hostToken === targetSession.hostToken
    );
  }

  async function updateIceServers(
    iceServers: RTCIceServer[],
    turnCredentialExpiresAt: number | null,
    targetSession: PersistedHostRoomSession | null = session,
  ) {
    if (!session || !targetSession || !isSameSession(session, targetSession)) {
      return null;
    }

    session = {
      ...targetSession,
      iceServers,
      turnCredentialExpiresAt,
    };
    await persist();
    return {
      iceServers: session.iceServers,
      turnCredentialExpiresAt: session.turnCredentialExpiresAt,
    };
  }

  function stopHeartbeat() {
    if (!heartbeatTimer) {
      return;
    }

    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  function sendHeartbeat() {
    if (!session) {
      return false;
    }

    heartbeatSequence += 1;
    return sendSignal(
      signalEnvelopeSchema.parse({
        roomId: session.roomId,
        sessionId: session.hostSessionId,
        role: "host",
        messageType: "heartbeat",
        timestamp: now(),
        payload: {
          sequence: heartbeatSequence,
        },
      }),
    );
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      sendHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
  }

  function closeSocket() {
    stopHeartbeat();

    if (!socket) {
      pendingOutboundSignals = [];
      return;
    }

    try {
      socket.close();
    } catch {
      // Best-effort teardown only.
    }

    socket = null;
    pendingOutboundSignals = [];
  }

  async function applyViewerSessions(viewerSessionIds: string[]) {
    if (!session) {
      return store.getSnapshot();
    }

    const uniqueViewerSessionIds = [...new Set(viewerSessionIds)];
    session = {
      ...session,
      viewerSessionIds: uniqueViewerSessionIds,
      viewerCount: uniqueViewerSessionIds.length,
    };
    store.setViewerCount(uniqueViewerSessionIds.length);
    await persist();
    return store.getSnapshot();
  }

  async function closeRoom(message: string) {
    closeSocket();
    session = null;
    const next = store.close(message);
    await persist();
    return next;
  }

  function toRoomSourceState(sourceState: HostSourceState): RoomSourceState {
    if (sourceState === "attached") {
      return "attached";
    }

    if (sourceState === "recovering") {
      return "recovering";
    }

    return "missing";
  }

  function toRoomState(snapshot: HostRoomSnapshot): RoomState {
    if (snapshot.roomLifecycle === "closed") {
      return "closed";
    }

    if (toRoomSourceState(snapshot.sourceState) !== "attached") {
      return "degraded";
    }

    if (snapshot.viewerCount > 0) {
      return "streaming";
    }

    return "hosting";
  }

  function publishRoomState(snapshot: HostRoomSnapshot) {
    if (!session) {
      return false;
    }

    return sendSignal(
      signalEnvelopeSchema.parse({
        roomId: session.roomId,
        sessionId: session.hostSessionId,
        role: "host",
        messageType: "room-state",
        timestamp: now(),
        payload: {
          state: toRoomState(snapshot),
          sourceState: toRoomSourceState(snapshot.sourceState),
          viewerCount: snapshot.viewerCount,
        },
      }),
    );
  }

  function sendSignal(envelope: Record<string, unknown>) {
    const payload = JSON.stringify(envelope);

    if (!socket) {
      return false;
    }

    if (socket.readyState !== OPEN_SOCKET_READY_STATE) {
      pendingOutboundSignals.push(payload);
      return true;
    }

    socket.send(payload);
    return true;
  }

  return {
    getSnapshot(): HostRoomSnapshot {
      return store.getSnapshot();
    },
    async startRoom(input: PersistedHostRoomSession) {
      closeSocket();
      session = input;
      store.openRoom(input);
      await persist();
      return store.getSnapshot();
    },
    getAttachSession() {
      if (!session) {
        return null;
      }

      return {
        roomId: session.roomId,
        sessionId: session.hostSessionId,
        viewerSessionIds: session.viewerSessionIds,
        iceServers: session.iceServers,
      };
    },
    getSourceFingerprint() {
      return session?.sourceFingerprint ?? null;
    },
    shouldRefreshHostIce() {
      if (!session || session.turnCredentialExpiresAt == null) {
        return false;
      }

      return session.turnCredentialExpiresAt <= now() + TURN_REFRESH_SKEW_MS;
    },
    async refreshHostIce() {
      if (!session) {
        return null;
      }

      const activeSession = session;

      const refreshed = await requestHostIceRefresh(
        fetchImpl,
        apiBaseUrl,
        activeSession.roomId,
        activeSession.hostToken,
      );
      await updateIceServers(
        refreshed.iceServers,
        refreshed.turnCredentialExpiresAt,
        activeSession,
      );
      return refreshed;
    },
    async updateIceServers(
      iceServers: RTCIceServer[],
      turnCredentialExpiresAt: number | null,
    ) {
      return updateIceServers(iceServers, turnCredentialExpiresAt);
    },
    async setViewerCount(viewerCount: number) {
      if (session) {
        session = { ...session, viewerCount };
        store.setViewerCount(viewerCount);
        await persist();
      }
      return store.getSnapshot();
    },
    async setViewerSessions(viewerSessionIds: string[]) {
      return applyViewerSessions(viewerSessionIds);
    },
    async setAttachedSource(sourceLabel: string, fingerprint: SourceFingerprint) {
      if (!session) {
        return store.getSnapshot();
      }

      session = {
        ...session,
        activeTabId: fingerprint.tabId,
        activeFrameId: fingerprint.frameId,
        sourceFingerprint: fingerprint,
        recoverByTimestamp: null,
      };
      store.setAttached(sourceLabel, {
        tabId: fingerprint.tabId,
        frameId: fingerprint.frameId,
      });
      await persist();
      const next = store.getSnapshot();
      publishRoomState(next);
      return next;
    },
    async markRecovering(message: string) {
      if (!session) {
        return store.getSnapshot();
      }

      const next = store.markRecovering(message);
      session = { ...session, recoverByTimestamp: next.recoverByTimestamp };
      await persist();
      publishRoomState(next);
      return next;
    },
    async markMissing(message: string) {
      if (!session) {
        return store.getSnapshot();
      }

      session = { ...session, recoverByTimestamp: null };
      const next = store.markMissing(message);
      await persist();
      publishRoomState(next);
      return next;
    },
    async close(message: string) {
      return closeRoom(message);
    },
    async connectSignaling(onInboundSignal: (envelope: SignalEnvelope) => void) {
      if (!session || !WebSocketImpl) {
        return false;
      }

      closeSocket();

      const activeSession = session;
      const nextSocket = new WebSocketImpl(
        toScreenMateWebSocketUrl(
          activeSession.signalingUrl,
          activeSession.hostToken,
          apiBaseUrl,
        ),
      );
      socket = nextSocket;

      const openPromise = new Promise<boolean>((resolve) => {
        let settled = false;
        const settle = (value: boolean) => {
          if (settled) {
            return;
          }

          settled = true;
          resolve(value);
        };

        nextSocket.addEventListener("open", () => {
          settle(true);
        });
        nextSocket.addEventListener("close", () => {
          settle(false);
        });
      });

      nextSocket.addEventListener("open", () => {
        if (socket !== nextSocket) {
          return;
        }

        const queuedSignals = pendingOutboundSignals;
        pendingOutboundSignals = [];
        for (const payload of queuedSignals) {
          nextSocket.send(payload);
        }
        publishRoomState(store.getSnapshot());
        heartbeatSequence = 0;
        startHeartbeat();
      });

      nextSocket.addEventListener("message", (event) => {
        void (async () => {
          const rawMessage = event as MessageEvent;
          const rawPayload =
            typeof rawMessage.data === "string"
              ? JSON.parse(rawMessage.data)
              : rawMessage.data;
          const parsedEnvelope = signalEnvelopeSchema.safeParse(rawPayload);

          if (!parsedEnvelope.success) {
            return;
          }

          if (
            !session ||
            session.roomId !== activeSession.roomId ||
            session.hostSessionId !== activeSession.hostSessionId ||
            socket !== nextSocket
          ) {
            return;
          }

          const envelope = parsedEnvelope.data;
          if (envelope.roomId !== activeSession.roomId) {
            return;
          }

          if (envelope.messageType === "viewer-joined") {
            await applyViewerSessions([
              ...session.viewerSessionIds,
              envelope.payload.viewerSessionId,
            ]);
            onInboundSignal(envelope);
            return;
          }

          if (envelope.messageType === "viewer-left") {
            await applyViewerSessions(
              session.viewerSessionIds.filter(
                (viewerSessionId) =>
                  viewerSessionId !== envelope.payload.viewerSessionId,
              ),
            );
            onInboundSignal(envelope);
            return;
          }

          if (
            envelope.messageType === "answer" ||
            envelope.messageType === "ice-candidate"
          ) {
            onInboundSignal(envelope);
            return;
          }

          if (envelope.messageType === "room-closed") {
            await closeRoom(`Room closed: ${envelope.payload.reason}.`);
            return;
          }

          if (envelope.messageType === "host-left") {
            await closeRoom(`Host session ended: ${envelope.payload.reason}.`);
          }
        })().catch(() => {
          // Ignore malformed socket payloads and continue listening.
        });
      });

      nextSocket.addEventListener("close", () => {
        if (socket === nextSocket) {
          stopHeartbeat();
          socket = null;
        }
      });

      return openPromise;
    },
    sendSignal,
    async restoreFromStorage() {
      const stored = (await options.storage.get(STORAGE_KEY))[STORAGE_KEY];
      if (!stored) {
        return store.getSnapshot();
      }

      session = stored;
      store.openRoom(stored);
      if (stored.recoverByTimestamp && stored.recoverByTimestamp > now()) {
        store.markRecovering(
          "Recovering video source after background restart.",
          stored.recoverByTimestamp,
        );
      } else {
        store.markMissing("No video attached.");
      }
      return store.getSnapshot();
    },
  };
}
