import { describe, expect, it, vi } from "vitest";
import { createHostRoomRuntime } from "../entrypoints/background/host-room-runtime";

class MockHostSocket {
  public readyState = 0;
  public readonly send = vi.fn();
  private readonly listeners = new Map<string, Set<(event?: Event) => void>>();

  addEventListener(type: string, listener: (event?: Event) => void) {
    const typedListeners = this.listeners.get(type) ?? new Set();
    typedListeners.add(listener);
    this.listeners.set(type, typedListeners);
  }

  close() {
    this.readyState = 3;
    this.emit("close");
  }

  emit(type: string, event?: Event) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

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
      pageUrl: "https://example.com/watch",
      elementId: "video-1",
      label: "Recovered source",
      visibleIndex: 0,
    });
    await runtime.markRecovering("Page refreshed.");
    await runtime.markMissing("No video attached.");

    expect(runtime.getSnapshot()).toEqual(closedSnapshot);
    expect(storage.remove).toHaveBeenCalledTimes(1);
  });

  it("updates the active owner when a new source is attached", async () => {
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

    await runtime.setAttachedSource("Moved source", {
      tabId: 99,
      frameId: 7,
      primaryUrl: "https://example.com/moved.mp4",
      pageUrl: "https://example.com/moved",
      elementId: "moved",
      label: "Moved source",
      visibleIndex: 0,
    });

    expect(runtime.getSnapshot()).toMatchObject({
      roomLifecycle: "open",
      sourceState: "attached",
      activeTabId: 99,
      activeFrameId: 7,
      sourceLabel: "Moved source",
    });
    expect(storage.set).toHaveBeenLastCalledWith({
      screenmateHostRoomSession: expect.objectContaining({
        activeTabId: 99,
        activeFrameId: 7,
      }),
    });
  });

  it("queues outbound signals until the signaling socket opens", async () => {
    const storage = {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn(),
      remove: vi.fn(),
    };
    const sockets: MockHostSocket[] = [];
    const runtime = createHostRoomRuntime({
      storage,
      WebSocketImpl: class {
        constructor(_url: string) {
          const socket = new MockHostSocket();
          sockets.push(socket);
          return socket as never;
        }
      } as never,
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

    const connectPromise = runtime.connectSignaling(vi.fn());

    expect(
      runtime.sendSignal({
        roomId: "room_123",
        sessionId: "host_1",
        role: "host",
        messageType: "offer",
        timestamp: 10,
        payload: {
          targetSessionId: "viewer_1",
          sdp: "offer-sdp",
        },
      }),
    ).toBe(true);
    expect(sockets[0]?.send).not.toHaveBeenCalled();

    sockets[0]?.emit("open");
    sockets[0]!.readyState = 1;
    await connectPromise;

    expect(sockets[0]?.send).toHaveBeenCalledWith(
      JSON.stringify({
        roomId: "room_123",
        sessionId: "host_1",
        role: "host",
        messageType: "offer",
        timestamp: 10,
        payload: {
          targetSessionId: "viewer_1",
          sdp: "offer-sdp",
        },
      }),
    );
  });

  it("forwards viewer lifecycle events after updating runtime viewer sessions", async () => {
    const storage = {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn(),
      remove: vi.fn(),
    };
    const sockets: MockHostSocket[] = [];
    const onInboundSignal = vi.fn();
    const runtime = createHostRoomRuntime({
      storage,
      WebSocketImpl: class {
        constructor(_url: string) {
          const socket = new MockHostSocket();
          sockets.push(socket);
          return socket as never;
        }
      } as never,
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

    const connectPromise = runtime.connectSignaling(onInboundSignal);
    sockets[0]!.readyState = 1;
    sockets[0]?.emit("open");
    await connectPromise;

    sockets[0]?.emit(
      "message",
      {
        data: JSON.stringify({
          roomId: "room_123",
          sessionId: "viewer_1",
          role: "viewer",
          messageType: "viewer-joined",
          timestamp: 10,
          payload: {
            viewerSessionId: "viewer_1",
          },
        }),
      } as unknown as Event,
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(runtime.getSnapshot().viewerCount).toBe(1);
    expect(onInboundSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        messageType: "viewer-joined",
        payload: {
          viewerSessionId: "viewer_1",
        },
      }),
    );

    sockets[0]?.emit(
      "message",
      {
        data: JSON.stringify({
          roomId: "room_123",
          sessionId: "viewer_1",
          role: "viewer",
          messageType: "viewer-left",
          timestamp: 11,
          payload: {
            viewerSessionId: "viewer_1",
          },
        }),
      } as unknown as Event,
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(runtime.getSnapshot().viewerCount).toBe(0);
    expect(onInboundSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        messageType: "viewer-left",
        payload: {
          viewerSessionId: "viewer_1",
        },
      }),
    );
  });

  it("publishes room-state on signaling connect and when host source state changes", async () => {
    const storage = {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn(),
      remove: vi.fn(),
    };
    const sockets: MockHostSocket[] = [];
    const runtime = createHostRoomRuntime({
      storage,
      WebSocketImpl: class {
        constructor(_url: string) {
          const socket = new MockHostSocket();
          sockets.push(socket);
          return socket as never;
        }
      } as never,
    });

    await runtime.startRoom({
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
    });

    const connectPromise = runtime.connectSignaling(vi.fn());
    sockets[0]!.readyState = 1;
    sockets[0]?.emit("open");
    await connectPromise;

    await runtime.setAttachedSource("Primary source", {
      tabId: 42,
      frameId: 0,
      primaryUrl: "https://example.com/video.mp4",
      pageUrl: "https://example.com/watch",
      elementId: "video-1",
      label: "Primary source",
      visibleIndex: 0,
    });
    await runtime.markRecovering("track-ended");
    await runtime.markMissing("No video attached.");

    const sentPayloads = sockets[0]!.send.mock.calls.map(([payload]) =>
      JSON.parse(payload as string),
    );

    expect(sentPayloads).toEqual([
      {
        roomId: "room_123",
        sessionId: "host_1",
        role: "host",
        messageType: "room-state",
        timestamp: expect.any(Number),
        payload: {
          state: "degraded",
          sourceState: "missing",
          viewerCount: 1,
        },
      },
      {
        roomId: "room_123",
        sessionId: "host_1",
        role: "host",
        messageType: "room-state",
        timestamp: expect.any(Number),
        payload: {
          state: "streaming",
          sourceState: "attached",
          viewerCount: 1,
        },
      },
      {
        roomId: "room_123",
        sessionId: "host_1",
        role: "host",
        messageType: "room-state",
        timestamp: expect.any(Number),
        payload: {
          state: "degraded",
          sourceState: "recovering",
          viewerCount: 1,
        },
      },
      {
        roomId: "room_123",
        sessionId: "host_1",
        role: "host",
        messageType: "room-state",
        timestamp: expect.any(Number),
        payload: {
          state: "degraded",
          sourceState: "missing",
          viewerCount: 1,
        },
      },
    ]);
  });

  it("sends host heartbeats every 20 seconds while signaling remains open", async () => {
    vi.useFakeTimers();
    try {
      const storage = {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn(),
        remove: vi.fn(),
      };
      const sockets: MockHostSocket[] = [];
      const now = vi.fn(() => 1_710_000_000_000);
      const runtime = createHostRoomRuntime({
        storage,
        now,
        WebSocketImpl: class {
          constructor(_url: string) {
            const socket = new MockHostSocket();
            sockets.push(socket);
            return socket as never;
          }
        } as never,
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

      const connectPromise = runtime.connectSignaling(vi.fn());
      sockets[0]!.readyState = 1;
      sockets[0]?.emit("open");
      await connectPromise;

      await vi.advanceTimersByTimeAsync(20_000);
      await vi.advanceTimersByTimeAsync(20_000);

      const sentPayloads = sockets[0]!.send.mock.calls
        .map(([payload]) => JSON.parse(payload as string))
        .filter((payload) => payload.messageType === "heartbeat");

      expect(sentPayloads).toEqual([
        {
          roomId: "room_123",
          sessionId: "host_1",
          role: "host",
          messageType: "heartbeat",
          timestamp: 1_710_000_000_000,
          payload: {
            sequence: 1,
          },
        },
        {
          roomId: "room_123",
          sessionId: "host_1",
          role: "host",
          messageType: "heartbeat",
          timestamp: 1_710_000_000_000,
          payload: {
            sequence: 2,
          },
        },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
