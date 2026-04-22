import { describe, expect, it, vi } from "vitest";
import { createHostRoomRuntime } from "../entrypoints/background/host-room-runtime";

describe("createHostRoomRuntime", () => {
  it("restores an active recovery session without extending its deadline", async () => {
    const storage = {
      get: vi.fn().mockResolvedValue({
        screenmateHostRoomSession: {
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
          recoverByTimestamp: 5_000,
        },
      }),
      set: vi.fn(),
      remove: vi.fn(),
    };

    const runtime = createHostRoomRuntime({
      storage,
      now: () => 1_000,
    });

    await runtime.restoreFromStorage();

    expect(runtime.getSnapshot()).toMatchObject({
      roomLifecycle: "degraded",
      sourceState: "recovering",
      roomId: "room_123",
      viewerCount: 1,
      recoverByTimestamp: 5_000,
    });
  });

  it("restores an expired recovery session as source missing", async () => {
    const storage = {
      get: vi.fn().mockResolvedValue({
        screenmateHostRoomSession: {
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
          recoverByTimestamp: 900,
        },
      }),
      set: vi.fn(),
      remove: vi.fn(),
    };

    const runtime = createHostRoomRuntime({
      storage,
      now: () => 1_000,
    });

    await runtime.restoreFromStorage();

    expect(runtime.getSnapshot()).toMatchObject({
      roomLifecycle: "open",
      sourceState: "missing",
      roomId: "room_123",
      viewerCount: 1,
    });
  });

  it("ignores late source updates after the room has been closed", async () => {
    const storage = {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn(),
      remove: vi.fn(),
    };

    const runtime = createHostRoomRuntime({
      storage,
      now: () => 1_000,
    });

    await runtime.startRoom({
      roomId: "room_123",
      hostSessionId: "host_1",
      hostToken: "host-token",
      signalingUrl: "/rooms/room_123/ws",
      iceServers: [],
      activeTabId: 42,
      activeFrameId: 0,
      viewerSessionIds: [],
      viewerCount: 0,
      sourceFingerprint: null,
      recoverByTimestamp: null,
    });
    await runtime.close("Room closed.");

    const closedSnapshot = runtime.getSnapshot();

    await runtime.setAttachedSource("Recovered source", {
      tabId: 42,
      frameId: 0,
      primaryUrl: "https://example.com/video.mp4",
      elementId: "video-1",
      label: "Recovered source",
      visibleIndex: 0,
    });
    await runtime.markRecovering("Page refreshed.");
    await runtime.markMissing("No video attached.");

    expect(runtime.getSnapshot()).toEqual(closedSnapshot);
    expect(storage.remove).toHaveBeenCalledTimes(1);
  });
});
