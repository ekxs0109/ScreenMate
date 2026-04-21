export type HostStatus =
  | "idle"
  | "starting"
  | "hosting"
  | "streaming"
  | "degraded"
  | "closed";

export type HostSnapshot = {
  status: HostStatus;
  roomId: string | null;
  viewerCount: number;
  errorMessage: string | null;
  sourceLabel: string | null;
};

export function createHostSnapshot(
  overrides: Partial<HostSnapshot> = {},
): HostSnapshot {
  return {
    status: "idle",
    roomId: null,
    viewerCount: 0,
    errorMessage: null,
    sourceLabel: null,
    ...overrides,
  };
}

export function createHostSessionStore() {
  let snapshot = createHostSnapshot();

  return {
    getSnapshot() {
      return snapshot;
    },
    beginStarting(sourceLabel: string | null) {
      snapshot = createHostSnapshot({
        status: "starting",
        sourceLabel,
      });
      return snapshot;
    },
    setRoom(roomId: string) {
      snapshot = {
        ...snapshot,
        roomId,
        status: snapshot.viewerCount > 0 ? "streaming" : "hosting",
        errorMessage: null,
      };
      return snapshot;
    },
    setViewerCount(viewerCount: number) {
      snapshot = {
        ...snapshot,
        viewerCount: Math.max(0, viewerCount),
        status:
          snapshot.roomId === null
            ? snapshot.status
            : viewerCount > 0
              ? "streaming"
              : "hosting",
      };
      return snapshot;
    },
    setError(
      errorMessage: string,
      status: HostStatus = snapshot.roomId ? "degraded" : "idle",
    ) {
      snapshot = {
        ...snapshot,
        status,
        errorMessage,
      };
      return snapshot;
    },
    setStatus(status: HostStatus) {
      snapshot = {
        ...snapshot,
        status,
      };
      return snapshot;
    },
    close(errorMessage?: string) {
      snapshot = {
        ...snapshot,
        status: "closed",
        errorMessage: errorMessage ?? snapshot.errorMessage,
      };
      return snapshot;
    },
    reset() {
      snapshot = createHostSnapshot();
      return snapshot;
    },
  };
}
