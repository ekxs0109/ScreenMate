import { describe, expect, it } from "vitest";
import {
  createHostRoomSnapshot,
  createHostRoomStore,
} from "../../entrypoints/background/host-room-snapshot";

describe("createHostRoomStore", () => {
  it("keeps the room open while source recovery is in progress", () => {
    const store = createHostRoomStore(() => 1_000);

    store.openRoom({
      roomId: "room_123",
      hostSessionId: "host_1",
      hostToken: "host-token",
      signalingUrl: "/rooms/room_123/ws",
      iceServers: [],
      activeTabId: 42,
      activeFrameId: 0,
      viewerSessionIds: [],
      viewerCount: 0,
      viewerRoster: [],
      chatMessages: [],
      sourceFingerprint: null,
      recoverByTimestamp: null,
    });
    store.markRecovering("Page refreshed.");

    expect(store.getSnapshot()).toEqual(
      createHostRoomSnapshot({
        roomLifecycle: "degraded",
        sourceState: "recovering",
        roomId: "room_123",
        activeTabId: 42,
        activeFrameId: 0,
        viewerCount: 0,
        message: "Page refreshed.",
        recoverByTimestamp: 16_000,
      }),
    );
  });

  it("preserves an existing recovery deadline when restoring recovery state", () => {
    const store = createHostRoomStore(() => 1_000);

    store.openRoom({
      roomId: "room_123",
      hostSessionId: "host_1",
      hostToken: "host-token",
      signalingUrl: "/rooms/room_123/ws",
      iceServers: [],
      activeTabId: 42,
      activeFrameId: 0,
      viewerSessionIds: [],
      viewerCount: 0,
      viewerRoster: [],
      chatMessages: [],
      sourceFingerprint: null,
      recoverByTimestamp: 5_000,
    });
    store.markRecovering("Background restored.", 5_000);

    expect(store.getSnapshot()).toEqual(
      createHostRoomSnapshot({
        roomLifecycle: "degraded",
        sourceState: "recovering",
        roomId: "room_123",
        activeTabId: 42,
        activeFrameId: 0,
        viewerCount: 0,
        message: "Background restored.",
        recoverByTimestamp: 5_000,
      }),
    );
  });

  it("defaults legacy persisted activity fields when opening a room", () => {
    const store = createHostRoomStore(() => 1_000);

    store.openRoom({
      roomId: "room_123",
      hostSessionId: "host_1",
      hostToken: "host-token",
      signalingUrl: "/rooms/room_123/ws",
      iceServers: [],
      activeTabId: 42,
      activeFrameId: 0,
      viewerSessionIds: ["viewer_1"],
      viewerCount: 1,
      sourceFingerprint: null,
      recoverByTimestamp: null,
    } as never);

    expect(store.getSnapshot()).toEqual(
      createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "unattached",
        roomId: "room_123",
        activeTabId: 42,
        activeFrameId: 0,
        viewerCount: 1,
        viewerRoster: [],
        chatMessages: [],
      }),
    );
  });
});
