import { signalEnvelopeSchema } from "@screenmate/shared";
import {
  getScreenMateApiBaseUrl,
  toScreenMateWebSocketUrl,
} from "../../lib/config";
import {
  createHostRoomStore,
  type HostRoomSnapshot,
  type PersistedHostRoomSession,
  type SourceFingerprint,
} from "./host-room-snapshot";

const STORAGE_KEY = "screenmateHostRoomSession";
const OPEN_SOCKET_READY_STATE = 1;

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
  WebSocketImpl?: new (url: string) => HostSocket;
}) {
  const now = options.now ?? Date.now;
  const apiBaseUrl = options.apiBaseUrl ?? getScreenMateApiBaseUrl();
  const store = createHostRoomStore(now);
  const WebSocketImpl = options.WebSocketImpl ?? globalThis.WebSocket;
  let session: PersistedHostRoomSession | null = null;
  let socket: HostSocket | null = null;

  async function persist() {
    if (session) {
      await options.storage.set({ [STORAGE_KEY]: session });
      return;
    }

    await options.storage.remove(STORAGE_KEY);
  }

  function closeSocket() {
    if (!socket) {
      return;
    }

    try {
      socket.close();
    } catch {
      // Best-effort teardown only.
    }

    socket = null;
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
        sourceFingerprint: fingerprint,
        recoverByTimestamp: null,
      };
      store.setAttached(sourceLabel);
      await persist();
      return store.getSnapshot();
    },
    async markRecovering(message: string) {
      if (!session) {
        return store.getSnapshot();
      }

      const next = store.markRecovering(message);
      session = { ...session, recoverByTimestamp: next.recoverByTimestamp };
      await persist();
      return next;
    },
    async markMissing(message: string) {
      if (!session) {
        return store.getSnapshot();
      }

      session = { ...session, recoverByTimestamp: null };
      const next = store.markMissing(message);
      await persist();
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
            return;
          }

          if (envelope.messageType === "viewer-left") {
            await applyViewerSessions(
              session.viewerSessionIds.filter(
                (viewerSessionId) =>
                  viewerSessionId !== envelope.payload.viewerSessionId,
              ),
            );
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
          socket = null;
        }
      });

      return true;
    },
    sendSignal(envelope: Record<string, unknown>) {
      if (!socket || socket.readyState !== OPEN_SOCKET_READY_STATE) {
        return false;
      }

      socket.send(JSON.stringify(envelope));
      return true;
    },
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
