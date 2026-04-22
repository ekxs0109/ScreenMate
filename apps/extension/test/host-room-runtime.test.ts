import { describe, expect, it, vi } from "vitest";
import { createHostRoomRuntime } from "../entrypoints/background/host-room-runtime";

describe("createHostRoomRuntime", () => {
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
});
