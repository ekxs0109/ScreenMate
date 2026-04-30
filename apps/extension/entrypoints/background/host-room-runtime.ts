import {
  signalEnvelopeSchema,
  type RoomChatMessage,
  type RoomSourceState,
  type RoomState,
  type ViewerRosterEntry,
} from "@screenmate/shared";
import {
  getScreenMateApiBaseUrl,
  toScreenMateWebSocketUrl,
} from "../../lib/config";
import {
  refreshHostIce as requestHostIceRefresh,
  updateRoomAccess,
  type HostIceRefreshResponse,
} from "../../lib/room-api";
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
  onSnapshotUpdated?: () => void;
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
  let pendingHostIceRefresh:
    | {
        session: PersistedHostRoomSession;
        promise: Promise<HostIceRefreshResponse | null>;
      }
    | null = null;

  async function persist() {
    if (session) {
      await options.storage.set({ [STORAGE_KEY]: session });
      return;
    }

    await options.storage.remove(STORAGE_KEY);
  }

  function notifySnapshotUpdated() {
    options.onSnapshotUpdated?.();
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
      turnCredentialExpiresAt: session.turnCredentialExpiresAt ?? null,
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
      viewerRoster: undefined,
    };
    store.setViewerCount(uniqueViewerSessionIds.length);
    await persist();
    notifySnapshotUpdated();
    return store.getSnapshot();
  }

  async function applyViewerRoster(viewerRoster: ViewerRosterEntry[]) {
    if (!session) {
      return store.getSnapshot();
    }

    const viewerSessionIds = viewerRoster
      .filter((viewer) => viewer.online)
      .map((viewer) => viewer.viewerSessionId);
    session = {
      ...session,
      viewerSessionIds,
      viewerCount: viewerSessionIds.length,
      viewerRoster,
    };
    store.setRoomActivity({ viewerRoster });
    await persist();
    notifySnapshotUpdated();
    return store.getSnapshot();
  }

  async function applyChatMessages(chatMessages: RoomChatMessage[]) {
    if (!session) {
      return store.getSnapshot();
    }

    session = {
      ...session,
      chatMessages,
    };
    store.setRoomActivity({ chatMessages });
    await persist();
    notifySnapshotUpdated();
    return store.getSnapshot();
  }

  async function closeRoom(message: string) {
    closeSocket();
    session = null;
    const next = store.close(message);
    await persist();
    notifySnapshotUpdated();
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

  function normalizePersistedSession(
    input: PersistedHostRoomSession,
  ): PersistedHostRoomSession {
    return {
      ...input,
      viewerRoster: input.viewerRoster,
      chatMessages: input.chatMessages ?? [],
    };
  }

  return {
    getSnapshot(): HostRoomSnapshot {
      return store.getSnapshot();
    },
    async startRoom(input: PersistedHostRoomSession) {
      closeSocket();
      session = normalizePersistedSession(input);
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
      if (
        pendingHostIceRefresh &&
        isSameSession(pendingHostIceRefresh.session, activeSession)
      ) {
        return pendingHostIceRefresh.promise;
      }

      const refreshPromise = (async () => {
        const refreshed = await requestHostIceRefresh(
          fetchImpl,
          apiBaseUrl,
          activeSession.roomId,
          activeSession.hostToken,
        );

        return updateIceServers(
          refreshed.iceServers,
          refreshed.turnCredentialExpiresAt,
          activeSession,
        );
      })();

      pendingHostIceRefresh = {
        session: activeSession,
        promise: refreshPromise,
      };

      try {
        return await refreshPromise;
      } finally {
        if (pendingHostIceRefresh?.promise === refreshPromise) {
          pendingHostIceRefresh = null;
        }
      }
    },
    async updateIceServers(
      iceServers: RTCIceServer[],
      turnCredentialExpiresAt: number | null,
    ) {
      return updateIceServers(iceServers, turnCredentialExpiresAt);
    },
    async setRoomPassword(password: string) {
      if (!session) {
        return {
          ok: false,
          snapshot: store.getSnapshot(),
          error: "room-password-save-failed" as const,
        };
      }

      try {
        await updateRoomAccess(
          fetchImpl,
          apiBaseUrl,
          session.roomId,
          session.hostToken,
          password,
        );

        return {
          ok: true,
          snapshot: store.getSnapshot(),
          error: null,
        };
      } catch {
        return {
          ok: false,
          snapshot: store.getSnapshot(),
          error: "room-password-save-failed" as const,
        };
      }
    },
    async setViewerCount(viewerCount: number) {
      if (session) {
        session = { ...session, viewerCount };
        store.setViewerCount(viewerCount);
        await persist();
        notifySnapshotUpdated();
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
      notifySnapshotUpdated();
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
      notifySnapshotUpdated();
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
      notifySnapshotUpdated();
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

          if (envelope.messageType === "viewer-roster") {
            const previousViewerSessionIds = new Set(session.viewerSessionIds);
            const nextViewerSessionIds = envelope.payload.viewers
              .filter((viewer) => viewer.online)
              .map((viewer) => viewer.viewerSessionId);
            const nextViewerSessionIdSet = new Set(nextViewerSessionIds);
            await applyViewerRoster(envelope.payload.viewers);
            for (const viewerSessionId of nextViewerSessionIds) {
              if (previousViewerSessionIds.has(viewerSessionId)) {
                continue;
              }

              const joinedEnvelope: SignalEnvelope = {
                roomId: activeSession.roomId,
                sessionId: viewerSessionId,
                role: "viewer",
                messageType: "viewer-joined",
                timestamp: envelope.timestamp,
                payload: {
                  viewerSessionId,
                },
              };
              onInboundSignal(joinedEnvelope);
            }
            for (const viewerSessionId of previousViewerSessionIds) {
              if (nextViewerSessionIdSet.has(viewerSessionId)) {
                continue;
              }

              const leftEnvelope: SignalEnvelope = {
                roomId: activeSession.roomId,
                sessionId: viewerSessionId,
                role: "viewer",
                messageType: "viewer-left",
                timestamp: envelope.timestamp,
                payload: {
                  viewerSessionId,
                },
              };
              onInboundSignal(leftEnvelope);
            }
            return;
          }

          if (envelope.messageType === "chat-history") {
            await applyChatMessages(envelope.payload.messages);
            return;
          }

          if (envelope.messageType === "chat-message-created") {
            await applyChatMessages([
              ...(session.chatMessages ?? []).filter(
                (message) => message.messageId !== envelope.payload.messageId,
              ),
              envelope.payload,
            ]);
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

      const connected = await openPromise;

      if (!connected && isSameSession(session, activeSession)) {
        await closeRoom("Room expired or unavailable.");
      }

      return connected;
    },
    sendSignal,
    sendHostChatMessage(text: string) {
      if (!session || !socket || socket.readyState !== OPEN_SOCKET_READY_STATE) {
        return false;
      }

      const trimmedText = text.trim();
      if (!trimmedText) {
        return false;
      }

      return sendSignal(
        signalEnvelopeSchema.parse({
          roomId: session.roomId,
          sessionId: session.hostSessionId,
          role: "host",
          messageType: "chat-message",
          timestamp: now(),
          payload: {
            text: trimmedText,
          },
        }),
      );
    },
    async restoreFromStorage() {
      const stored = (await options.storage.get(STORAGE_KEY))[STORAGE_KEY];
      if (!stored) {
        return store.getSnapshot();
      }

      session = normalizePersistedSession(stored);
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
