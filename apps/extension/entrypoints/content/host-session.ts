export type HostSnapshot = {
  status: "idle" | "hosting" | "streaming";
  roomId: string | null;
  viewerCount: number;
};

export function createHostSessionStore() {
  let snapshot: HostSnapshot = {
    status: "idle",
    roomId: null,
    viewerCount: 0,
  };

  return {
    getSnapshot() {
      return snapshot;
    },
    setRoom(roomId: string) {
      snapshot = { ...snapshot, roomId, status: "hosting" };
    },
    setViewerCount(viewerCount: number) {
      snapshot = {
        ...snapshot,
        viewerCount,
        status: viewerCount > 0 ? "streaming" : "hosting",
      };
    },
    reset() {
      snapshot = { status: "idle", roomId: null, viewerCount: 0 };
    },
  };
}
