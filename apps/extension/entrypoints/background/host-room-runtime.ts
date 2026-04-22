import {
  createHostRoomStore,
  type HostRoomSnapshot,
  type PersistedHostRoomSession,
  type SourceFingerprint,
} from "./host-room-snapshot";

const STORAGE_KEY = "screenmateHostRoomSession";

type SessionStorageLike = {
  get: (key: string) => Promise<Record<string, PersistedHostRoomSession | undefined>>;
  set: (value: Record<string, PersistedHostRoomSession>) => Promise<void>;
  remove: (key: string) => Promise<void>;
};

export function createHostRoomRuntime(options: {
  storage: SessionStorageLike;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const store = createHostRoomStore(now);
  let session: PersistedHostRoomSession | null = null;

  async function persist() {
    if (session) {
      await options.storage.set({ [STORAGE_KEY]: session });
      return;
    }

    await options.storage.remove(STORAGE_KEY);
  }

  return {
    getSnapshot(): HostRoomSnapshot {
      return store.getSnapshot();
    },
    async startRoom(input: PersistedHostRoomSession) {
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
      if (session) {
        session = {
          ...session,
          viewerSessionIds,
          viewerCount: viewerSessionIds.length,
        };
        store.setViewerCount(viewerSessionIds.length);
        await persist();
      }
      return store.getSnapshot();
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
      session = null;
      const next = store.close(message);
      await persist();
      return next;
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
