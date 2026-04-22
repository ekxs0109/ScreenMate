import { describe, expect, it, vi } from "vitest";
import {
  createHostMessageHandler,
  createInternalHostNetworkHandler,
  createHostRuntimeMessageListener,
  type HostMessage,
} from "../entrypoints/background";

function createHandlerDependencies(
  overrides: Partial<Parameters<typeof createHostMessageHandler>[0]> = {},
) {
  return {
    apiBaseUrl: "http://localhost:8787",
    createRoom: vi.fn().mockResolvedValue({
      roomId: "room_123",
      hostSessionId: "host_1",
      hostToken: "host-token",
      signalingUrl: "/rooms/room_123/ws",
      iceServers: [],
    }),
    queryActiveTabId: vi.fn().mockResolvedValue(42),
    queryFrameIds: vi.fn().mockResolvedValue([0]),
    runtime: {
      close: vi.fn().mockResolvedValue({
        roomLifecycle: "closed",
        sourceState: "missing",
        roomId: "room_123",
        viewerCount: 0,
        sourceLabel: null,
        activeTabId: 42,
        activeFrameId: 0,
        recoverByTimestamp: null,
        message: "Room closed.",
      }),
      connectSignaling: vi.fn().mockResolvedValue(true),
      getAttachSession: vi.fn().mockReturnValue(null),
      getSnapshot: vi.fn().mockReturnValue({
        roomLifecycle: "idle",
        sourceState: "unattached",
        roomId: null,
        viewerCount: 0,
        sourceLabel: null,
        activeTabId: null,
        activeFrameId: null,
        recoverByTimestamp: null,
        message: null,
      }),
      getSourceFingerprint: vi.fn().mockReturnValue(null),
      markMissing: vi.fn().mockResolvedValue({
        roomLifecycle: "open",
        sourceState: "missing",
        roomId: "room_123",
        viewerCount: 0,
        sourceLabel: null,
        activeTabId: 42,
        activeFrameId: 0,
        recoverByTimestamp: null,
        message: "No video attached.",
      }),
      markRecovering: vi.fn().mockResolvedValue({
        roomLifecycle: "degraded",
        sourceState: "recovering",
        roomId: "room_123",
      }),
      sendSignal: vi.fn().mockReturnValue(true),
      setAttachedSource: vi.fn().mockResolvedValue({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_123",
        viewerCount: 1,
        sourceLabel: "https://example.com/hero.mp4",
        activeTabId: 42,
        activeFrameId: 0,
        recoverByTimestamp: null,
        message: null,
      }),
      startRoom: vi.fn().mockResolvedValue({
        roomLifecycle: "open",
        sourceState: "unattached",
        roomId: "room_123",
        viewerCount: 0,
        sourceLabel: null,
        activeTabId: 42,
        activeFrameId: 0,
        recoverByTimestamp: null,
        message: null,
      }),
    } as never,
    sendTabMessage: vi.fn(),
    forwardInboundSignal: vi.fn(),
    ...overrides,
  };
}

describe("createHostMessageHandler", () => {
  it("aggregates video lists from all reachable frames in the active tab", async () => {
    const queryActiveTabId = vi.fn().mockResolvedValue(42);
    const queryFrameIds = vi.fn().mockResolvedValue([0, 5]);
    const sendTabMessage = vi
      .fn()
      .mockImplementation(
        async (
          _tabId: number,
          message: HostMessage,
          options?: { frameId?: number },
        ) => {
          if (message.type !== "screenmate:list-videos") {
            return [];
          }

          if (options?.frameId === 5) {
            return [
              { id: "screenmate-video-1", label: "https://example.com/a.mp4" },
            ];
          }

          return [];
        },
      );
    const handler = createHostMessageHandler(createHandlerDependencies({
      queryActiveTabId,
      queryFrameIds,
      sendTabMessage,
    }));

    const result = await handler({ type: "screenmate:list-videos" });

    expect(queryActiveTabId).toHaveBeenCalledTimes(1);
    expect(queryFrameIds).toHaveBeenCalledWith(42);
    expect(sendTabMessage).toHaveBeenCalledWith(
      42,
      { type: "screenmate:list-videos" },
      { frameId: 0 },
    );
    expect(sendTabMessage).toHaveBeenCalledWith(
      42,
      { type: "screenmate:list-videos" },
      { frameId: 5 },
    );
    expect(result).toEqual([
      {
        id: "screenmate-video-1",
        label: "https://example.com/a.mp4 [iframe #5]",
        frameId: 5,
      },
    ]);
  });

  it("returns the background room snapshot without querying content frames", async () => {
    const queryFrameIds = vi.fn();
    const handler = createHostMessageHandler({
      queryActiveTabId: vi.fn().mockResolvedValue(42),
      queryFrameIds,
      createRoom: vi.fn(),
      forwardInboundSignal: vi.fn(),
      sendTabMessage: vi.fn(),
      runtime: {
        getSnapshot: vi.fn().mockReturnValue({
          roomLifecycle: "open",
          sourceState: "missing",
          roomId: "room_123",
          viewerCount: 2,
          sourceLabel: null,
          activeTabId: 42,
          activeFrameId: 0,
          recoverByTimestamp: null,
          message: "No video attached.",
        }),
      } as never,
    });

    const result = await handler({ type: "screenmate:get-room-session" });

    expect(result).toMatchObject({
      roomLifecycle: "open",
      sourceState: "missing",
      roomId: "room_123",
      viewerCount: 2,
    });
    expect(queryFrameIds).not.toHaveBeenCalled();
  });

  it("keeps the room open when the source detaches", async () => {
    const markRecovering = vi.fn().mockResolvedValue({
      roomLifecycle: "degraded",
      sourceState: "recovering",
      roomId: "room_123",
    });
    const handler = createHostMessageHandler({
      createRoom: vi.fn(),
      forwardInboundSignal: vi.fn(),
      queryActiveTabId: vi.fn().mockResolvedValue(42),
      queryFrameIds: vi.fn().mockResolvedValue([0]),
      sendTabMessage: vi.fn(),
      runtime: {
        getSnapshot: vi.fn(),
        markRecovering,
      } as never,
    });

    await handler({
      type: "screenmate:source-detached",
      frameId: 0,
      reason: "track-ended",
    });

    expect(markRecovering).toHaveBeenCalledWith("track-ended");
  });

  it("auto-reattaches when content-ready reports an exact fingerprint match", async () => {
    const sendTabMessage = vi.fn().mockResolvedValue({
      sourceLabel: "https://example.com/hero.mp4",
      fingerprint: {
        primaryUrl: "https://example.com/hero.mp4",
        elementId: "hero",
        label: "https://example.com/hero.mp4",
        visibleIndex: 0,
      },
    });
    const handler = createHostMessageHandler({
      createRoom: vi.fn(),
      forwardInboundSignal: vi.fn(),
      queryActiveTabId: vi.fn().mockResolvedValue(42),
      queryFrameIds: vi.fn().mockResolvedValue([0]),
      sendTabMessage,
      runtime: {
        getSnapshot: vi.fn().mockReturnValue({
          roomLifecycle: "degraded",
          sourceState: "recovering",
          roomId: "room_123",
          viewerCount: 1,
        }),
        getAttachSession: vi.fn().mockReturnValue({
          roomId: "room_123",
          sessionId: "host_1",
          viewerSessionIds: ["viewer_1"],
          iceServers: [],
        }),
        getSourceFingerprint: vi.fn().mockReturnValue({
          tabId: 42,
          frameId: 0,
          primaryUrl: "https://example.com/hero.mp4",
          elementId: "hero",
          label: "https://example.com/hero.mp4",
          visibleIndex: 0,
        }),
        setAttachedSource: vi.fn().mockResolvedValue(undefined),
      } as never,
    });

    await handler({
      type: "screenmate:content-ready",
      frameId: 0,
      videos: [
        {
          id: "screenmate-video-1",
          label: "https://example.com/hero.mp4",
          frameId: 0,
          fingerprint: {
            primaryUrl: "https://example.com/hero.mp4",
            elementId: "hero",
            label: "https://example.com/hero.mp4",
            visibleIndex: 0,
          },
        },
      ],
    });

    expect(sendTabMessage).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        type: "screenmate:attach-source",
        videoId: "screenmate-video-1",
      }),
      { frameId: 0 },
    );
  });

  it("returns an explicit room message when there is no active tab to start from", async () => {
    const handler = createHostMessageHandler(createHandlerDependencies({
      queryActiveTabId: vi.fn().mockResolvedValue(null),
    }));

    const result = await handler({
      type: "screenmate:start-room",
      frameId: 0,
    });

    expect(result).toBeDefined();
    if (!result || Array.isArray(result) || "ok" in result) {
      throw new Error("Expected a snapshot result");
    }

    expect(result.roomLifecycle).toBe("idle");
    expect(result.message).toContain("active tab");
    expect(result.roomId).toBeNull();
  });

  it("ignores unrelated runtime messages", async () => {
    const handler = createHostMessageHandler(createHandlerDependencies());

    const result = await handler({ type: "screenmate:other" } as unknown as HostMessage);

    expect(result).toBeUndefined();
  });

  it("starts the room in the background and connects signaling", async () => {
    const createRoom = vi.fn().mockResolvedValue({
      roomId: "room_123",
      hostSessionId: "host_1",
      hostToken: "host-token",
      signalingUrl: "/rooms/room_123/ws",
      iceServers: [{ urls: ["stun:stun.screenmate.dev"] }],
    });
    const runtime = {
      connectSignaling: vi.fn().mockResolvedValue(true),
      startRoom: vi.fn().mockResolvedValue({
        roomLifecycle: "open",
        sourceState: "unattached",
        roomId: "room_123",
        viewerCount: 0,
        sourceLabel: null,
        activeTabId: 42,
        activeFrameId: 7,
        recoverByTimestamp: null,
        message: null,
      }),
    };
    const handler = createHostMessageHandler(createHandlerDependencies({
      createRoom,
      runtime: runtime as never,
      sendTabMessage: vi.fn(),
    }));

    const result = await handler({
      type: "screenmate:start-room",
      frameId: 7,
    });

    expect(createRoom).toHaveBeenCalledWith("http://localhost:8787");
    expect(runtime.startRoom).toHaveBeenCalledWith(
      expect.objectContaining({
        activeFrameId: 7,
        activeTabId: 42,
        roomId: "room_123",
      }),
    );
    expect(runtime.connectSignaling).toHaveBeenCalled();
    expect(result).toMatchObject({
      roomLifecycle: "open",
      roomId: "room_123",
      sourceState: "unattached",
    });
  });

  it("broadcasts preview updates to every reachable frame", async () => {
    const queryActiveTabId = vi.fn().mockResolvedValue(42);
    const queryFrameIds = vi.fn().mockResolvedValue([0, 7]);
    const sendTabMessage = vi.fn().mockResolvedValue({ ok: true });
    const handler = createHostMessageHandler(createHandlerDependencies({
      queryActiveTabId,
      queryFrameIds,
      sendTabMessage,
    }));

    const result = await handler({
      type: "screenmate:preview-video",
      videoId: "screenmate-video-1",
      frameId: 7,
      label: "Video in iframe",
    } as HostMessage);

    expect(sendTabMessage).toHaveBeenCalledWith(
      42,
      {
        type: "screenmate:preview-video",
        active: false,
        videoId: "screenmate-video-1",
        frameId: 7,
        label: "Video in iframe",
      },
      { frameId: 0 },
    );
    expect(sendTabMessage).toHaveBeenCalledWith(
      42,
      {
        type: "screenmate:preview-video",
        active: true,
        videoId: "screenmate-video-1",
        frameId: 7,
        label: "Video in iframe",
      },
      { frameId: 7 },
    );
    expect(result).toEqual({ ok: true });
  });

  it("broadcasts preview clearing to every reachable frame", async () => {
    const queryActiveTabId = vi.fn().mockResolvedValue(42);
    const queryFrameIds = vi.fn().mockResolvedValue([0, 7]);
    const sendTabMessage = vi.fn().mockResolvedValue({ ok: true });
    const handler = createHostMessageHandler(createHandlerDependencies({
      queryActiveTabId,
      queryFrameIds,
      sendTabMessage,
    }));

    const result = await handler({ type: "screenmate:clear-preview" } as HostMessage);

    expect(sendTabMessage).toHaveBeenCalledWith(
      42,
      { type: "screenmate:clear-preview" },
      { frameId: 0 },
    );
    expect(sendTabMessage).toHaveBeenCalledWith(
      42,
      { type: "screenmate:clear-preview" },
      { frameId: 7 },
    );
    expect(result).toEqual({ ok: true });
  });

  it("keeps the runtime message channel open and replies asynchronously", async () => {
    const handler = vi.fn().mockResolvedValue([
      {
        id: "screenmate-video-1",
        label: "https://example.com/a.mp4 [iframe #0]",
        frameId: 0,
      },
    ]);
    const internalHandler = vi.fn().mockReturnValue(undefined);
    const sendResponse = vi.fn();

    const keepChannelOpen = createHostRuntimeMessageListener(
      handler,
      internalHandler,
    )(
      { type: "screenmate:list-videos" },
      {} as never,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(sendResponse).toHaveBeenCalledWith([
      {
        id: "screenmate-video-1",
        label: "https://example.com/a.mp4 [iframe #0]",
        frameId: 0,
      },
    ]);
  });

  it("does not swallow normal host messages when the internal handler is present", async () => {
    const handler = vi.fn().mockResolvedValue([
      {
        id: "screenmate-video-1",
        label: "https://example.com/a.mp4 [iframe #0]",
        frameId: 0,
      },
    ]);
    const internalHandler = createInternalHostNetworkHandler({
      fetchImpl: vi.fn() as typeof fetch,
    });
    const sendResponse = vi.fn();

    const keepChannelOpen = createHostRuntimeMessageListener(
      handler,
      internalHandler,
    )(
      { type: "screenmate:list-videos" },
      {} as never,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(handler).toHaveBeenCalledWith({ type: "screenmate:list-videos" });
    expect(sendResponse).toHaveBeenCalledWith([
      {
        id: "screenmate-video-1",
        label: "https://example.com/a.mp4 [iframe #0]",
        frameId: 0,
      },
    ]);
  });

  it("uses the runtime sender frame id for content lifecycle messages", async () => {
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const internalHandler = vi.fn().mockReturnValue(undefined);
    const sendResponse = vi.fn();

    const keepChannelOpen = createHostRuntimeMessageListener(
      handler,
      internalHandler,
    )(
      {
        type: "screenmate:source-detached",
        frameId: 99,
        reason: "track-ended",
      },
      { frameId: 7 } as never,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(handler).toHaveBeenCalledWith({
      type: "screenmate:source-detached",
      frameId: 7,
      reason: "track-ended",
    });
  });

  it("creates a room through the extension background network context", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        roomId: "room_123",
        hostToken: "host-token",
        signalingUrl: "/rooms/room_123/ws",
        iceServers: [{ urls: ["stun:stun.screenmate.dev"] }],
      }),
    });
    const handler = createInternalHostNetworkHandler({
      fetchImpl: fetchImpl as typeof fetch,
    });

    const result = await handler({
      type: "screenmate:create-room",
      apiBaseUrl: "http://localhost:8787",
    });

    expect(fetchImpl).toHaveBeenCalledWith("http://localhost:8787/rooms", {
      method: "POST",
    });
    expect(result).toEqual({
      roomId: "room_123",
      hostToken: "host-token",
      signalingUrl: "/rooms/room_123/ws",
      iceServers: [{ urls: ["stun:stun.screenmate.dev"] }],
    });
  });
});
