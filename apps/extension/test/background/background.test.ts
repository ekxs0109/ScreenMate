import { describe, expect, it, vi } from "vitest";
import {
  createHostMessageHandler,
  createForwardInboundSignalHandler,
  createInternalHostNetworkHandler,
  createHostRuntimeMessageListener,
  shouldForwardSignalToContentRuntime,
  type HostMessage,
} from "../../entrypoints/background";
import { createHostRoomSnapshot } from "../../entrypoints/background/host-room-snapshot";
import { VideoSourceCache } from "../../entrypoints/background/video-source-cache";

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
    queryCurrentWindowTabs: vi.fn().mockResolvedValue([{ id: 42 }]),
    queryFrameIds: vi.fn().mockResolvedValue([0]),
    videoCache: new VideoSourceCache(),
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
      sendHostChatMessage: vi.fn().mockReturnValue(true),
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
  it("aggregates video lists from the current window and all reachable frames", async () => {
    const queryActiveTabId = vi.fn().mockResolvedValue(42);
    const queryCurrentWindowTabs = vi.fn().mockResolvedValue([{ id: 42 }, { id: 84 }]);
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

          if (_tabId === 84 && options?.frameId === 0) {
            return [
              { id: "screenmate-video-2", label: "https://example.com/other.mp4" },
            ];
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
      queryCurrentWindowTabs,
      queryFrameIds,
      sendTabMessage,
    }));

    const result = await handler({ type: "screenmate:list-videos" });

    expect(queryActiveTabId).toHaveBeenCalledTimes(1);
    expect(queryCurrentWindowTabs).toHaveBeenCalledTimes(1);
    expect(queryFrameIds).toHaveBeenCalledWith(42);
    expect(queryFrameIds).toHaveBeenCalledWith(84);
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
    expect(sendTabMessage).toHaveBeenCalledWith(
      84,
      { type: "screenmate:list-videos" },
      { frameId: 0 },
    );
    expect(result).toEqual([
      {
        id: "screenmate-video-1",
        label: "https://example.com/a.mp4 [iframe #5]",
        tabId: 42,
        frameId: 5,
      },
      {
        id: "screenmate-video-2",
        label: "https://example.com/other.mp4",
        tabId: 84,
        frameId: 0,
      },
      {
        id: "screenmate-video-1",
        label: "https://example.com/a.mp4 [iframe #5]",
        tabId: 84,
        frameId: 5,
      },
    ]);
  });

  it("routes popup chat messages through the host runtime", async () => {
    const runtime = {
      ...createHandlerDependencies().runtime,
      getSnapshot: vi.fn().mockReturnValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_123",
      })),
      sendHostChatMessage: vi.fn().mockReturnValue(true),
    };
    const handler = createHostMessageHandler(createHandlerDependencies({
      runtime: runtime as never,
    }));

    const result = await handler({
      type: "screenmate:send-chat-message",
      text: "  hello room  ",
    });

    expect(runtime.sendHostChatMessage).toHaveBeenCalledWith("hello room");
    expect(result).toEqual({
      ok: true,
      snapshot: expect.objectContaining({
        roomId: "room_123",
      }),
      error: null,
    });
  });

  it("reports popup chat send failures with the current snapshot", async () => {
    const snapshot = createHostRoomSnapshot({
      roomLifecycle: "open",
      sourceState: "attached",
      roomId: "room_123",
    });
    const runtime = {
      ...createHandlerDependencies().runtime,
      getSnapshot: vi.fn().mockReturnValue(snapshot),
      sendHostChatMessage: vi.fn().mockReturnValue(false),
    };
    const handler = createHostMessageHandler(createHandlerDependencies({
      runtime: runtime as never,
    }));

    const result = await handler({
      type: "screenmate:send-chat-message",
      text: "hello room",
    });

    expect(runtime.sendHostChatMessage).toHaveBeenCalledWith("hello room");
    expect(result).toEqual({
      ok: false,
      snapshot,
      error: "room-chat-send-failed",
    });
    await expect(
      handler({ type: "screenmate:send-chat-message", text: "   " }),
    ).resolves.toBeUndefined();
  });

  it("keeps sniff results in the browser tab order instead of forcing the active tab first", async () => {
    const queryActiveTabId = vi.fn().mockResolvedValue(84);
    const queryCurrentWindowTabs = vi.fn().mockResolvedValue([
      { id: 42, title: "First tab" },
      { id: 84, title: "Active tab" },
    ]);
    const sendTabMessage = vi
      .fn()
      .mockImplementation(async (tabId: number, message: HostMessage) => {
        if (message.type !== "screenmate:list-videos") {
          return [];
        }

        return [{ id: `video-${tabId}`, label: `video-${tabId}` }];
      });
    const handler = createHostMessageHandler(createHandlerDependencies({
      queryActiveTabId,
      queryCurrentWindowTabs,
      queryFrameIds: vi.fn().mockResolvedValue([0]),
      sendTabMessage,
    }));

    const result = await handler({ type: "screenmate:list-videos" });

    expect(result).toEqual([
      {
        id: "video-42",
        label: "video-42",
        tabId: 42,
        tabTitle: "First tab",
        frameId: 0,
      },
      {
        id: "video-84",
        label: "video-84",
        tabId: 84,
        tabTitle: "Active tab",
        frameId: 0,
      },
    ]);
  });

  it("restores persisted sniff results before falling back to a live scan", async () => {
    const persistedVideos = [
      {
        id: "persisted-video",
        label: "Persisted Video",
        tabId: 42,
        frameId: 0,
      },
    ];
    const sendTabMessage = vi.fn();
    const videoCache = new VideoSourceCache({
      getValue: vi.fn().mockResolvedValue({
        videos: persistedVideos,
        isScanning: false,
        updatedAt: 123,
        error: null,
      }),
      setValue: vi.fn(),
    });
    const handler = createHostMessageHandler(createHandlerDependencies({
      sendTabMessage,
      videoCache,
    }));

    const result = await handler({ type: "screenmate:list-videos" });

    expect(result).toEqual(persistedVideos);
    expect(sendTabMessage).not.toHaveBeenCalled();
  });

  it("returns the persisted video sniff state without starting a live scan", async () => {
    const persistedVideos = [
      {
        id: "persisted-video",
        label: "Persisted Video",
        tabId: 42,
        frameId: 0,
      },
    ];
    const sendTabMessage = vi.fn();
    const videoCache = new VideoSourceCache({
      getValue: vi.fn().mockResolvedValue({
        tabs: [{ tabId: 42, title: "Cached tab" }],
        videos: persistedVideos,
        status: "success",
        isScanning: false,
        updatedAt: Date.now(),
        startedAt: null,
        refreshId: null,
        error: null,
      }),
      setValue: vi.fn(),
    });
    const handler = createHostMessageHandler(createHandlerDependencies({
      sendTabMessage,
      videoCache,
    }));

    const result = await handler({ type: "screenmate:get-video-sniff-state" });

    expect(result).toMatchObject({
      tabs: [{ tabId: 42, title: "Cached tab" }],
      videos: persistedVideos,
      status: "success",
      error: null,
    });
    expect(sendTabMessage).not.toHaveBeenCalled();
  });

  it("does not scan when ensuring a fresh cached video sniff state", async () => {
    const persistedVideos = [
      {
        id: "persisted-video",
        label: "Persisted Video",
        tabId: 42,
        frameId: 0,
      },
    ];
    const sendTabMessage = vi.fn();
    const videoCache = new VideoSourceCache({
      getValue: vi.fn().mockResolvedValue({
        tabs: [{ tabId: 42, title: "Cached tab" }],
        videos: persistedVideos,
        status: "success",
        isScanning: false,
        updatedAt: Date.now(),
        startedAt: null,
        refreshId: null,
        error: null,
      }),
      setValue: vi.fn(),
    });
    const handler = createHostMessageHandler(createHandlerDependencies({
      sendTabMessage,
      videoCache,
    }));

    const result = await handler({ type: "screenmate:ensure-video-sniff-state" });

    expect(result).toMatchObject({
      tabs: [{ tabId: 42, title: "Cached tab" }],
      videos: persistedVideos,
      status: "success",
    });
    expect(sendTabMessage).not.toHaveBeenCalled();
  });

  it("refreshes when ensuring a stale video sniff state", async () => {
    const sendTabMessage = vi.fn().mockImplementation(async (
      _tabId: number,
      message: HostMessage,
    ) => {
      if (message.type !== "screenmate:list-videos") {
        return [];
      }

      return [{ id: "fresh-video", label: "Fresh Video" }];
    });
    const videoCache = new VideoSourceCache({
      getValue: vi.fn().mockResolvedValue({
        tabs: [{ tabId: 42, title: "Cached tab" }],
        videos: [],
        status: "success",
        isScanning: false,
        updatedAt: Date.now() - 60_000,
        startedAt: null,
        refreshId: null,
        error: null,
      }),
      setValue: vi.fn(),
    });
    const handler = createHostMessageHandler(createHandlerDependencies({
      queryCurrentWindowTabs: vi.fn().mockResolvedValue([
        { id: 42, title: "Fresh tab", url: "https://example.com" },
      ]),
      queryFrameIds: vi.fn().mockResolvedValue([0]),
      sendTabMessage,
      videoCache,
    }));

    const result = await handler({ type: "screenmate:ensure-video-sniff-state" });

    expect(result).toMatchObject({
      tabs: [{ tabId: 42, title: "Fresh tab", url: "https://example.com" }],
      videos: [
        {
          id: "fresh-video",
          label: "Fresh Video",
          tabId: 42,
          tabTitle: "Fresh tab",
          frameId: 0,
        },
      ],
      status: "success",
    });
    expect(sendTabMessage).toHaveBeenCalledTimes(1);
  });

  it("persists content-ready sniff results with the sender tab id", async () => {
    const setValue = vi.fn();
    const videoCache = new VideoSourceCache({
      getValue: vi.fn().mockResolvedValue(null),
      setValue,
    });
    const handler = createHostMessageHandler(createHandlerDependencies({
      videoCache,
    }));

    await handler({
      type: "screenmate:content-ready",
      tabId: 42,
      frameId: 0,
      videos: [
        {
          id: "screenmate-video-1",
          label: "https://example.com/a.mp4",
          frameId: 0,
        },
      ],
    });

    expect(setValue).toHaveBeenCalledWith(
      expect.objectContaining({
        error: null,
        isScanning: false,
        videos: [
          {
            id: "screenmate-video-1",
            label: "https://example.com/a.mp4",
            tabId: 42,
            frameId: 0,
          },
        ],
      }),
    );
  });

  it("merges content-ready sniff results by frame instead of replacing the whole tab", async () => {
    const setValue = vi.fn();
    const videoCache = new VideoSourceCache({
      getValue: vi.fn().mockResolvedValue(null),
      setValue,
    });
    const handler = createHostMessageHandler(createHandlerDependencies({
      videoCache,
    }));

    await handler({
      type: "screenmate:content-ready",
      tabId: 42,
      frameId: 0,
      videos: [
        {
          id: "main-video",
          label: "Main frame video",
          frameId: 0,
        },
      ],
    });
    await handler({
      type: "screenmate:content-ready",
      tabId: 42,
      frameId: 5,
      videos: [
        {
          id: "iframe-video",
          label: "Iframe video",
          frameId: 5,
        },
      ],
    });

    expect(setValue).toHaveBeenLastCalledWith(
      expect.objectContaining({
        videos: [
          {
            id: "main-video",
            label: "Main frame video",
            tabId: 42,
            frameId: 0,
          },
          {
            id: "iframe-video",
            label: "Iframe video",
            tabId: 42,
            frameId: 5,
          },
        ],
      }),
    );
  });

  it("bypasses persisted sniff results when a refresh is requested", async () => {
    const sendTabMessage = vi.fn().mockImplementation(async (
      _tabId: number,
      message: HostMessage,
    ) => {
      if (message.type !== "screenmate:list-videos") {
        return [];
      }

      return [{ id: "fresh-video", label: "Fresh Video" }];
    });
    const videoCache = new VideoSourceCache({
      getValue: vi.fn().mockResolvedValue({
        videos: [
          {
            id: "persisted-video",
            label: "Persisted Video",
            tabId: 42,
            frameId: 0,
          },
        ],
        isScanning: false,
        updatedAt: 123,
        error: null,
      }),
      setValue: vi.fn(),
    });
    const handler = createHostMessageHandler(createHandlerDependencies({
      queryCurrentWindowTabs: vi.fn().mockResolvedValue([{ id: 42 }]),
      queryFrameIds: vi.fn().mockResolvedValue([0]),
      sendTabMessage,
      videoCache,
    }));

    const result = await handler({ type: "screenmate:list-videos", refresh: true });

    expect(result).toEqual([
      {
        id: "fresh-video",
        label: "Fresh Video",
        tabId: 42,
        frameId: 0,
      },
    ]);
  });

  it("shares an in-flight all-tab video scan across overlapping list requests", async () => {
    let resolveFrameMessage: ((videos: Array<{ id: string; label: string }>) => void) | null = null;
    const sendTabMessage = vi.fn().mockImplementation(
      (_tabId: number, message: HostMessage) => {
        if (message.type !== "screenmate:list-videos") {
          return Promise.resolve([]);
        }

        return new Promise((resolve) => {
          resolveFrameMessage = resolve;
        });
      },
    );
    const handler = createHostMessageHandler(createHandlerDependencies({
      queryCurrentWindowTabs: vi.fn().mockResolvedValue([{ id: 42, title: "Video tab" }]),
      queryFrameIds: vi.fn().mockResolvedValue([0]),
      sendTabMessage,
    }));

    const firstScan = handler({ type: "screenmate:list-videos", refresh: true });
    const secondScan = handler({ type: "screenmate:list-videos", refresh: true });
    while (!resolveFrameMessage) {
      await Promise.resolve();
    }
    const finishFrameMessage = resolveFrameMessage as (
      videos: Array<{ id: string; label: string }>,
    ) => void;
    finishFrameMessage([{ id: "video-1", label: "Video 1" }]);

    await expect(firstScan).resolves.toEqual([
      {
        id: "video-1",
        label: "Video 1",
        tabId: 42,
        tabTitle: "Video tab",
        frameId: 0,
      },
    ]);
    await expect(secondScan).resolves.toEqual([
      {
        id: "video-1",
        label: "Video 1",
        tabId: 42,
        tabTitle: "Video tab",
        frameId: 0,
      },
    ]);
    expect(sendTabMessage).toHaveBeenCalledTimes(1);
  });

  it("scans normal browser tabs even when there is no active tab context", async () => {
    const queryActiveTabId = vi.fn().mockResolvedValue(null);
    const queryCurrentWindowTabs = vi.fn().mockResolvedValue([
      { id: 42, title: "Video tab" },
      { id: 84, title: "Other window video tab" },
    ]);
    const sendTabMessage = vi.fn().mockImplementation(async (
      tabId: number,
      message: HostMessage,
    ) => {
      if (message.type !== "screenmate:list-videos") {
        return [];
      }

      return [{ id: `video-${tabId}`, label: `Video ${tabId}` }];
    });
    const handler = createHostMessageHandler(createHandlerDependencies({
      queryActiveTabId,
      queryCurrentWindowTabs,
      queryFrameIds: vi.fn().mockResolvedValue([0]),
      sendTabMessage,
    }));

    const result = await handler({ type: "screenmate:list-videos", refresh: true });

    expect(result).toEqual([
      {
        id: "video-42",
        label: "Video 42",
        tabId: 42,
        tabTitle: "Video tab",
        frameId: 0,
      },
      {
        id: "video-84",
        label: "Video 84",
        tabId: 84,
        tabTitle: "Other window video tab",
        frameId: 0,
      },
    ]);
    expect(queryCurrentWindowTabs).toHaveBeenCalledTimes(1);
  });

  it("ignores non-web tabs when scanning all normal browser tabs", async () => {
    const queryCurrentWindowTabs = vi.fn().mockResolvedValue([
      { id: 42, title: "Video tab", url: "https://example.com/watch" },
      { id: 99, title: "Settings", url: "chrome://settings" },
    ]);
    const sendTabMessage = vi.fn().mockResolvedValue([
      { id: "video-42", label: "Video 42" },
    ]);
    const handler = createHostMessageHandler(createHandlerDependencies({
      queryActiveTabId: vi.fn().mockResolvedValue(null),
      queryCurrentWindowTabs,
      queryFrameIds: vi.fn().mockResolvedValue([0]),
      sendTabMessage,
    }));

    const result = await handler({ type: "screenmate:list-videos", refresh: true });

    expect(sendTabMessage).toHaveBeenCalledTimes(1);
    expect(sendTabMessage).toHaveBeenCalledWith(
      42,
      { type: "screenmate:list-videos" },
      { frameId: 0 },
    );
    expect(result).toEqual([
      {
        id: "video-42",
        label: "Video 42",
        tabId: 42,
        tabTitle: "Video tab",
        frameId: 0,
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
        getSnapshot: vi.fn().mockReturnValue({
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
          activeTabId: 42,
          activeFrameId: 0,
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

  it("refreshes host ICE before recovery reattach uses persisted viewer sessions", async () => {
    const refreshedSession = {
      roomId: "room_123",
      sessionId: "host_1",
      viewerSessionIds: ["viewer_1"],
      iceServers: [{ urls: ["turn:refreshed.screenmate.dev"] }],
    };
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
        getAttachSession: vi
          .fn()
          .mockReturnValueOnce({
            roomId: "room_123",
            sessionId: "host_1",
            viewerSessionIds: ["viewer_1"],
            iceServers: [{ urls: ["turn:stale.screenmate.dev"] }],
          })
          .mockReturnValueOnce(refreshedSession),
        getSnapshot: vi.fn().mockReturnValue({
          roomLifecycle: "degraded",
          sourceState: "recovering",
          roomId: "room_123",
          viewerCount: 1,
          activeTabId: 42,
          activeFrameId: 0,
          recoverByTimestamp: 5_000,
          message: "Page refreshed.",
        }),
        getSourceFingerprint: vi.fn().mockReturnValue({
          tabId: 42,
          frameId: 0,
          primaryUrl: "https://example.com/hero.mp4",
          elementId: "hero",
          label: "https://example.com/hero.mp4",
          visibleIndex: 0,
        }),
        markMissing: vi.fn().mockResolvedValue(createHostRoomSnapshot()),
        refreshHostIce: vi.fn().mockResolvedValue({
          iceServers: refreshedSession.iceServers,
          turnCredentialExpiresAt: 200_000,
        }),
        setAttachedSource: vi.fn().mockResolvedValue(createHostRoomSnapshot()),
        shouldRefreshHostIce: vi.fn().mockReturnValue(true),
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
        roomSession: refreshedSession,
      }),
      { frameId: 0 },
    );
  });

  it("auto-reattaches when blob URLs change but the page and slot stay the same", async () => {
    const sendTabMessage = vi.fn().mockResolvedValue({
      sourceLabel: "blob:https://www.bilibili.com/new",
      fingerprint: {
        primaryUrl: "blob:https://www.bilibili.com/new",
        pageUrl: "https://www.bilibili.com/video/BV1demo",
        elementId: null,
        label: "blob:https://www.bilibili.com/new",
        visibleIndex: 0,
      },
    });
    const markMissing = vi.fn().mockResolvedValue({
      roomLifecycle: "open",
      sourceState: "missing",
      roomId: "room_123",
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
          activeTabId: 42,
          activeFrameId: 0,
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
          primaryUrl: "blob:https://www.bilibili.com/old",
          pageUrl: "https://www.bilibili.com/video/BV1demo",
          elementId: null,
          label: "blob:https://www.bilibili.com/old",
          visibleIndex: 0,
        }),
        markMissing,
        setAttachedSource: vi.fn().mockResolvedValue(undefined),
      } as never,
    });

    await handler({
      type: "screenmate:content-ready",
      frameId: 0,
      videos: [
        {
          id: "screenmate-video-1",
          label: "blob:https://www.bilibili.com/new",
          frameId: 0,
          fingerprint: {
            primaryUrl: "blob:https://www.bilibili.com/new",
            pageUrl: "https://www.bilibili.com/video/BV1demo",
            elementId: null,
            label: "blob:https://www.bilibili.com/new",
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
    expect(markMissing).not.toHaveBeenCalled();
  });

  it("does not auto-reattach a blob video when the page URL changed", async () => {
    const sendTabMessage = vi.fn();
    const markMissing = vi.fn().mockResolvedValue({
      roomLifecycle: "open",
      sourceState: "missing",
      roomId: "room_123",
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
          activeTabId: 42,
          activeFrameId: 0,
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
          primaryUrl: "blob:https://www.bilibili.com/old",
          pageUrl: "https://www.bilibili.com/video/BV1demo",
          elementId: null,
          label: "blob:https://www.bilibili.com/old",
          visibleIndex: 0,
        }),
        markMissing,
        setAttachedSource: vi.fn().mockResolvedValue(undefined),
      } as never,
    });

    await handler({
      type: "screenmate:content-ready",
      frameId: 0,
      videos: [
        {
          id: "screenmate-video-1",
          label: "blob:https://www.bilibili.com/new",
          frameId: 0,
          fingerprint: {
            primaryUrl: "blob:https://www.bilibili.com/new",
            pageUrl: "https://www.bilibili.com/video/BV2other",
            elementId: null,
            label: "blob:https://www.bilibili.com/new",
            visibleIndex: 0,
          },
        },
      ],
    });

    expect(sendTabMessage).not.toHaveBeenCalled();
    expect(markMissing).toHaveBeenCalledWith("No video attached.");
  });

  it("auto-reattaches against the persisted host tab when a different tab is active", async () => {
    const sendTabMessage = vi.fn().mockResolvedValue({
      sourceLabel: "https://example.com/hero.mp4",
      fingerprint: {
        primaryUrl: "https://example.com/hero.mp4",
        elementId: "hero",
        label: "https://example.com/hero.mp4",
        visibleIndex: 0,
      },
    });
    const markMissing = vi.fn().mockResolvedValue({
      roomLifecycle: "open",
      sourceState: "missing",
      roomId: "room_123",
    });
    const handler = createHostMessageHandler({
      createRoom: vi.fn(),
      forwardInboundSignal: vi.fn(),
      queryActiveTabId: vi.fn().mockResolvedValue(7),
      queryFrameIds: vi.fn().mockResolvedValue([0]),
      sendTabMessage,
      runtime: {
        getSnapshot: vi.fn().mockReturnValue({
          roomLifecycle: "degraded",
          sourceState: "recovering",
          roomId: "room_123",
          viewerCount: 1,
          activeTabId: 42,
          activeFrameId: 0,
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
        markMissing,
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
    expect(markMissing).not.toHaveBeenCalled();
  });

  it("ignores content-ready recovery payloads from the wrong sender tab", async () => {
    const sendTabMessage = vi.fn();
    const markMissing = vi.fn();
    const snapshot = {
      roomLifecycle: "degraded",
      sourceState: "recovering",
      roomId: "room_123",
      viewerCount: 1,
      activeTabId: 42,
      activeFrameId: 0,
    };
    const handler = createHostMessageHandler({
      createRoom: vi.fn(),
      forwardInboundSignal: vi.fn(),
      queryActiveTabId: vi.fn().mockResolvedValue(7),
      queryFrameIds: vi.fn().mockResolvedValue([0]),
      videoCache: new VideoSourceCache(),
      sendTabMessage,
      runtime: {
        getSnapshot: vi.fn().mockReturnValue(snapshot),
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
        markMissing,
        setAttachedSource: vi.fn(),
      } as never,
    });

    const result = await handler({
      type: "screenmate:content-ready",
      frameId: 0,
      tabId: 7,
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
    } as HostMessage);

    expect(result).toEqual(snapshot);
    expect(sendTabMessage).not.toHaveBeenCalled();
    expect(markMissing).not.toHaveBeenCalled();
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
    if (!result || Array.isArray(result) || "ok" in result || "status" in result) {
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

  it("transfers active attachment ownership when attaching a new source", async () => {
    const setAttachedSource = vi.fn().mockResolvedValue({
      roomLifecycle: "open",
      sourceState: "attached",
      roomId: "room_123",
      viewerCount: 1,
      sourceLabel: "https://example.com/next.mp4",
      activeTabId: 99,
      activeFrameId: 7,
      recoverByTimestamp: null,
      message: null,
    });
    const handler = createHostMessageHandler({
      createRoom: vi.fn(),
      forwardInboundSignal: vi.fn(),
      queryActiveTabId: vi.fn().mockResolvedValue(99),
      queryFrameIds: vi.fn().mockResolvedValue([7]),
      sendTabMessage: vi.fn().mockResolvedValue({
        sourceLabel: "https://example.com/next.mp4",
        fingerprint: {
          primaryUrl: "https://example.com/next.mp4",
          elementId: "next",
          label: "https://example.com/next.mp4",
          visibleIndex: 0,
        },
      }),
      runtime: {
        getAttachSession: vi.fn().mockReturnValue({
          roomId: "room_123",
          sessionId: "host_1",
          viewerSessionIds: ["viewer_1"],
          iceServers: [],
        }),
        getSnapshot: vi.fn().mockReturnValue({
          roomLifecycle: "open",
          sourceState: "attached",
          roomId: "room_123",
          viewerCount: 1,
          sourceLabel: "https://example.com/previous.mp4",
          activeTabId: 42,
          activeFrameId: 0,
          recoverByTimestamp: null,
          message: null,
        }),
        setAttachedSource,
      } as never,
    });

    await handler({
      type: "screenmate:attach-source",
      videoId: "screenmate-video-2",
      frameId: 7,
    });

    expect(setAttachedSource).toHaveBeenCalledWith(
      "https://example.com/next.mp4",
      {
        tabId: 99,
        frameId: 7,
        primaryUrl: "https://example.com/next.mp4",
        elementId: "next",
        label: "https://example.com/next.mp4",
        visibleIndex: 0,
      },
    );
  });

  it("refreshes host ICE before attaching a source when the cached lease is stale", async () => {
    const refreshedSession = {
      roomId: "room_123",
      sessionId: "host_1",
      viewerSessionIds: ["viewer_1"],
      iceServers: [{ urls: ["turn:refreshed.screenmate.dev"] }],
    };
    const sendTabMessage = vi.fn().mockResolvedValue({
      sourceLabel: "https://example.com/next.mp4",
      fingerprint: {
        primaryUrl: "https://example.com/next.mp4",
        elementId: "next",
        label: "https://example.com/next.mp4",
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
        getAttachSession: vi
          .fn()
          .mockReturnValueOnce({
            roomId: "room_123",
            sessionId: "host_1",
            viewerSessionIds: ["viewer_1"],
            iceServers: [{ urls: ["turn:stale.screenmate.dev"] }],
          })
          .mockReturnValueOnce(refreshedSession),
        getSnapshot: vi.fn().mockReturnValue({
          roomLifecycle: "open",
          sourceState: "attached",
          roomId: "room_123",
          viewerCount: 1,
          sourceLabel: "https://example.com/previous.mp4",
          activeTabId: 42,
          activeFrameId: 0,
          recoverByTimestamp: null,
          message: null,
        }),
        refreshHostIce: vi.fn().mockResolvedValue({
          iceServers: refreshedSession.iceServers,
          turnCredentialExpiresAt: 200_000,
        }),
        setAttachedSource: vi.fn().mockResolvedValue(createHostRoomSnapshot()),
        shouldRefreshHostIce: vi.fn().mockReturnValue(true),
      } as never,
    });

    await handler({
      type: "screenmate:attach-source",
      frameId: 0,
      videoId: "screenmate-video-2",
    });

    expect(sendTabMessage).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        type: "screenmate:attach-source",
        roomSession: refreshedSession,
      }),
      { frameId: 0 },
    );
  });

  it("best-effort detaches the current attachment owner before stopping the room", async () => {
    const sendTabMessage = vi.fn().mockRejectedValue(new Error("frame gone"));
    const close = vi.fn().mockResolvedValue({
      roomLifecycle: "closed",
      sourceState: "missing",
      roomId: "room_123",
      viewerCount: 0,
      sourceLabel: null,
      activeTabId: 42,
      activeFrameId: 7,
      recoverByTimestamp: null,
      message: "Room closed.",
    });
    const handler = createHostMessageHandler(createHandlerDependencies({
      runtime: {
        close,
        getSnapshot: vi.fn().mockReturnValue({
          roomLifecycle: "open",
          sourceState: "attached",
          roomId: "room_123",
          viewerCount: 1,
          sourceLabel: "https://example.com/previous.mp4",
          activeTabId: 42,
          activeFrameId: 7,
          recoverByTimestamp: null,
          message: null,
        }),
      } as never,
      sendTabMessage,
    }));

    const result = await handler({ type: "screenmate:stop-room" });

    expect(sendTabMessage).toHaveBeenCalledWith(
      42,
      { type: "screenmate:detach-source" },
      { frameId: 7 },
    );
    expect(close).toHaveBeenCalledWith("Room closed.");
    expect(result).toMatchObject({
      roomLifecycle: "closed",
      roomId: "room_123",
    });
  });

  it("best-effort detaches the previous owner before attaching in a different frame", async () => {
    const sendTabMessage = vi.fn().mockImplementation(
      async (
        _tabId: number,
        tabMessage: HostMessage | { type: "screenmate:detach-source" },
      ) => {
        if (tabMessage.type === "screenmate:detach-source") {
          throw new Error("old frame gone");
        }

        return {
          sourceLabel: "https://example.com/next.mp4",
          fingerprint: {
            primaryUrl: "https://example.com/next.mp4",
            elementId: "next",
            label: "https://example.com/next.mp4",
            visibleIndex: 0,
          },
        };
      },
    );
    const setAttachedSource = vi.fn().mockResolvedValue({
      roomLifecycle: "open",
      sourceState: "attached",
      roomId: "room_123",
      viewerCount: 1,
      sourceLabel: "https://example.com/next.mp4",
      activeTabId: 42,
      activeFrameId: 7,
      recoverByTimestamp: null,
      message: null,
    });
    const handler = createHostMessageHandler({
      createRoom: vi.fn(),
      forwardInboundSignal: vi.fn(),
      queryActiveTabId: vi.fn().mockResolvedValue(42),
      queryFrameIds: vi.fn().mockResolvedValue([0, 7]),
      sendTabMessage,
      runtime: {
        getAttachSession: vi.fn().mockReturnValue({
          roomId: "room_123",
          sessionId: "host_1",
          viewerSessionIds: ["viewer_1"],
          iceServers: [],
        }),
        getSnapshot: vi.fn().mockReturnValue({
          roomLifecycle: "open",
          sourceState: "attached",
          roomId: "room_123",
          viewerCount: 1,
          sourceLabel: "https://example.com/previous.mp4",
          activeTabId: 42,
          activeFrameId: 0,
          recoverByTimestamp: null,
          message: null,
        }),
        markMissing: vi.fn(),
        setAttachedSource,
      } as never,
    });

    await handler({
      type: "screenmate:attach-source",
      videoId: "screenmate-video-2",
      frameId: 7,
    });

    expect(sendTabMessage).toHaveBeenNthCalledWith(
      1,
      42,
      { type: "screenmate:detach-source" },
      { frameId: 0 },
    );
    expect(sendTabMessage).toHaveBeenNthCalledWith(
      2,
      42,
      expect.objectContaining({
        type: "screenmate:attach-source",
        videoId: "screenmate-video-2",
      }),
      { frameId: 7 },
    );
    expect(setAttachedSource).toHaveBeenCalledWith(
      "https://example.com/next.mp4",
      {
        tabId: 42,
        frameId: 7,
        primaryUrl: "https://example.com/next.mp4",
        elementId: "next",
        label: "https://example.com/next.mp4",
        visibleIndex: 0,
      },
    );
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
      tabId: null,
    });
  });

  it("uses the runtime sender tab id for content-ready trust decisions", async () => {
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const internalHandler = vi.fn().mockReturnValue(undefined);
    const sendResponse = vi.fn();

    const keepChannelOpen = createHostRuntimeMessageListener(
      handler,
      internalHandler,
    )(
      {
        type: "screenmate:content-ready",
        frameId: 99,
        videos: [],
      },
      { frameId: 7, tab: { id: 42 } } as never,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(handler).toHaveBeenCalledWith({
      type: "screenmate:content-ready",
      frameId: 7,
      tabId: 42,
      videos: [],
    });
  });

  it("uses the runtime sender identity for signal-outbound ownership checks", async () => {
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const internalHandler = vi.fn().mockReturnValue(undefined);
    const sendResponse = vi.fn();

    const keepChannelOpen = createHostRuntimeMessageListener(
      handler,
      internalHandler,
    )(
      {
        type: "screenmate:signal-outbound",
        envelope: { messageType: "offer" },
      },
      { frameId: 7, tab: { id: 42 } } as never,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(handler).toHaveBeenCalledWith({
      type: "screenmate:signal-outbound",
      envelope: { messageType: "offer" },
      frameId: 7,
      tabId: 42,
    });
  });

  it("ignores stale source-detached and signal-outbound messages after ownership moves", async () => {
    const markRecovering = vi.fn();
    const sendSignal = vi.fn();
    const snapshot = {
      roomLifecycle: "open",
      sourceState: "attached",
      roomId: "room_123",
      viewerCount: 1,
      sourceLabel: "https://example.com/current.mp4",
      activeTabId: 99,
      activeFrameId: 7,
      recoverByTimestamp: null,
      message: null,
    };
    const handler = createHostMessageHandler({
      createRoom: vi.fn(),
      forwardInboundSignal: vi.fn(),
      queryActiveTabId: vi.fn(),
      queryFrameIds: vi.fn(),
      sendTabMessage: vi.fn(),
      runtime: {
        getSnapshot: vi.fn().mockReturnValue(snapshot),
        markRecovering,
        sendSignal,
      } as never,
    });

    const detachResult = await handler({
      type: "screenmate:source-detached",
      frameId: 0,
      tabId: 42,
      reason: "track-ended",
    } as HostMessage);
    const signalResult = await handler({
      type: "screenmate:signal-outbound",
      frameId: 0,
      tabId: 42,
      envelope: { messageType: "ice-candidate" },
    } as HostMessage);

    expect(detachResult).toEqual(snapshot);
    expect(signalResult).toEqual({ ok: true });
    expect(markRecovering).not.toHaveBeenCalled();
    expect(sendSignal).not.toHaveBeenCalled();
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

  it("refreshes host ICE before forwarding a late viewer-joined signal", async () => {
    const sendTabMessage = vi.fn().mockResolvedValue(undefined);
    const refreshHostIce = vi.fn().mockResolvedValue({
      iceServers: [{ urls: ["turn:refreshed.screenmate.dev"] }],
      turnCredentialExpiresAt: 200_000,
    });
    const forwardInboundSignal = createForwardInboundSignalHandler({
      runtime: {
        getSnapshot: vi.fn().mockReturnValue({
          roomLifecycle: "open",
          sourceState: "attached",
          roomId: "room_123",
          viewerCount: 1,
          sourceLabel: "Primary source",
          activeTabId: 42,
          activeFrameId: 7,
          recoverByTimestamp: null,
          message: null,
        }),
        shouldRefreshHostIce: vi.fn().mockReturnValue(true),
        refreshHostIce,
      } as never,
      sendTabMessage,
    });

    const envelope = {
      roomId: "room_123",
      sessionId: "viewer_2",
      role: "viewer" as const,
      messageType: "viewer-joined" as const,
      timestamp: 10,
      payload: {
        viewerSessionId: "viewer_2",
      },
    };

    await forwardInboundSignal(envelope);

    expect(refreshHostIce).toHaveBeenCalledTimes(1);
    expect(sendTabMessage).toHaveBeenNthCalledWith(
      1,
      42,
      {
        type: "screenmate:update-ice-servers",
        iceServers: [{ urls: ["turn:refreshed.screenmate.dev"] }],
      },
      { frameId: 7 },
    );
    expect(sendTabMessage).toHaveBeenNthCalledWith(
      2,
      42,
      {
        type: "screenmate:signal-inbound",
        envelope,
      },
      { frameId: 7 },
    );
  });

  it("re-reads the active attachment owner after ICE refresh before forwarding", async () => {
    const sendTabMessage = vi.fn().mockResolvedValue(undefined);
    const refreshHostIce = vi.fn().mockResolvedValue({
      iceServers: [{ urls: ["turn:refreshed.screenmate.dev"] }],
      turnCredentialExpiresAt: 200_000,
    });
    const getSnapshot = vi
      .fn()
      .mockReturnValueOnce({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_123",
        viewerCount: 1,
        sourceLabel: "Primary source",
        activeTabId: 42,
        activeFrameId: 7,
        recoverByTimestamp: null,
        message: null,
      })
      .mockReturnValueOnce({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_123",
        viewerCount: 1,
        sourceLabel: "Moved source",
        activeTabId: 99,
        activeFrameId: 3,
        recoverByTimestamp: null,
        message: null,
      })
      .mockReturnValueOnce({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_123",
        viewerCount: 1,
        sourceLabel: "Moved source",
        activeTabId: 99,
        activeFrameId: 3,
        recoverByTimestamp: null,
        message: null,
      });
    const forwardInboundSignal = createForwardInboundSignalHandler({
      runtime: {
        getSnapshot,
        shouldRefreshHostIce: vi.fn().mockReturnValue(true),
        refreshHostIce,
      } as never,
      sendTabMessage,
    });

    const envelope = {
      roomId: "room_123",
      sessionId: "viewer_2",
      role: "viewer" as const,
      messageType: "viewer-joined" as const,
      timestamp: 10,
      payload: {
        viewerSessionId: "viewer_2",
      },
    };

    await forwardInboundSignal(envelope);

    expect(sendTabMessage).toHaveBeenNthCalledWith(
      1,
      99,
      {
        type: "screenmate:update-ice-servers",
        iceServers: [{ urls: ["turn:refreshed.screenmate.dev"] }],
      },
      { frameId: 3 },
    );
    expect(sendTabMessage).toHaveBeenNthCalledWith(
      2,
      99,
      {
        type: "screenmate:signal-inbound",
        envelope,
      },
      { frameId: 3 },
    );
  });

  it("stops forwarding when the attachment disappears during ICE refresh", async () => {
    const sendTabMessage = vi.fn().mockResolvedValue(undefined);
    const forwardInboundSignal = createForwardInboundSignalHandler({
      runtime: {
        getSnapshot: vi
          .fn()
          .mockReturnValueOnce({
            roomLifecycle: "open",
            sourceState: "attached",
            roomId: "room_123",
            viewerCount: 1,
            sourceLabel: "Primary source",
            activeTabId: 42,
            activeFrameId: 7,
            recoverByTimestamp: null,
            message: null,
          })
          .mockReturnValueOnce({
            roomLifecycle: "open",
            sourceState: "missing",
            roomId: "room_123",
            viewerCount: 1,
            sourceLabel: null,
            activeTabId: 42,
            activeFrameId: 7,
            recoverByTimestamp: null,
            message: "No video attached.",
          })
          .mockReturnValueOnce({
            roomLifecycle: "open",
            sourceState: "missing",
            roomId: "room_123",
            viewerCount: 1,
            sourceLabel: null,
            activeTabId: 42,
            activeFrameId: 7,
            recoverByTimestamp: null,
            message: "No video attached.",
          }),
        shouldRefreshHostIce: vi.fn().mockReturnValue(true),
        refreshHostIce: vi.fn().mockResolvedValue({
          iceServers: [{ urls: ["turn:refreshed.screenmate.dev"] }],
          turnCredentialExpiresAt: 200_000,
        }),
      } as never,
      sendTabMessage,
    });

    await forwardInboundSignal({
      roomId: "room_123",
      sessionId: "viewer_2",
      role: "viewer",
      messageType: "viewer-joined",
      timestamp: 10,
      payload: {
        viewerSessionId: "viewer_2",
      },
    });

    expect(sendTabMessage).not.toHaveBeenCalled();
  });

  it("drops late viewer forwarding when ICE refresh resolves stale for a replaced room", async () => {
    const sendTabMessage = vi.fn().mockResolvedValue(undefined);
    const forwardInboundSignal = createForwardInboundSignalHandler({
      runtime: {
        getSnapshot: vi
          .fn()
          .mockReturnValueOnce({
            roomLifecycle: "open",
            sourceState: "attached",
            roomId: "room_123",
            viewerCount: 1,
            sourceLabel: "Primary source",
            activeTabId: 42,
            activeFrameId: 7,
            recoverByTimestamp: null,
            message: null,
          })
          .mockReturnValueOnce({
            roomLifecycle: "open",
            sourceState: "attached",
            roomId: "room_456",
            viewerCount: 1,
            sourceLabel: "Replacement source",
            activeTabId: 99,
            activeFrameId: 3,
            recoverByTimestamp: null,
            message: null,
          }),
        shouldRefreshHostIce: vi.fn().mockReturnValue(true),
        refreshHostIce: vi.fn().mockResolvedValue(null),
      } as never,
      sendTabMessage,
    });

    await forwardInboundSignal({
      roomId: "room_123",
      sessionId: "viewer_2",
      role: "viewer",
      messageType: "viewer-joined",
      timestamp: 10,
      payload: {
        viewerSessionId: "viewer_2",
      },
    });

    expect(sendTabMessage).not.toHaveBeenCalled();
  });

  it("forwards viewer lifecycle and negotiation envelopes to the content runtime", () => {
    expect(
      shouldForwardSignalToContentRuntime({
        roomId: "room_123",
        sessionId: "viewer_1",
        role: "viewer",
        messageType: "viewer-joined",
        timestamp: 10,
        payload: {
          viewerSessionId: "viewer_1",
        },
      }),
    ).toBe(true);
    expect(
      shouldForwardSignalToContentRuntime({
        roomId: "room_123",
        sessionId: "viewer_1",
        role: "viewer",
        messageType: "viewer-left",
        timestamp: 11,
        payload: {
          viewerSessionId: "viewer_1",
        },
      }),
    ).toBe(true);
    expect(
      shouldForwardSignalToContentRuntime({
        roomId: "room_123",
        sessionId: "host_1",
        role: "host",
        messageType: "offer",
        timestamp: 12,
        payload: {
          targetSessionId: "viewer_1",
          sdp: "offer-sdp",
        },
      }),
    ).toBe(false);
  });
});
