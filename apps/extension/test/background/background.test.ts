import { describe, expect, it, vi } from "vitest";
import {
  createAttachmentRoutingState,
  createHostMessageHandler,
  followActiveTabVideoOnce,
  createForwardInboundSignalHandler,
  createInternalHostNetworkHandler,
  createHostRuntimeMessageListener,
  markRemovedTabAttachmentOwner,
  notifyAttachedContentChat,
  shouldForwardSignalToContentRuntime,
  isScreenMateViewerUrl,
  type HostMessage,
} from "../../entrypoints/background";
import { createHostRoomSnapshot } from "../../entrypoints/background/host-room-snapshot";
import { VideoSourceCache } from "../../entrypoints/background/video-source-cache";

type TestTabMessage =
  | HostMessage
  | { type: "screenmate:detach-source"; hideChat?: boolean }
  | { type: "screenmate:attach-source"; videoId: string; roomSession?: unknown };

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
  it("prepares screen capture by asking offscreen to call getDisplayMedia", async () => {
    const ensureOffscreenDocument = vi.fn().mockResolvedValue(undefined);
    const sendOffscreenMessage = vi.fn().mockResolvedValue({
      sourceLabel: "Shared screen",
      fingerprint: {
        primaryUrl: "screenmate://display-media",
        pageUrl: "chrome-extension://demo/offscreen.html",
        elementId: "screenmate-offscreen-display",
        label: "Shared screen",
        visibleIndex: 0,
      },
    });
    const createRoom = vi.fn();
    const handler = createHostMessageHandler(createHandlerDependencies({
      createRoom,
      ensureOffscreenDocument,
      sendOffscreenMessage,
    }));

    const result = await handler({
      type: "screenmate:prepare-screen-source",
      captureType: "screen",
    });

    expect(ensureOffscreenDocument).toHaveBeenCalledTimes(1);
    expect(sendOffscreenMessage).toHaveBeenCalledWith({
      type: "screenmate:offscreen-prepare-display-media",
      captureType: "screen",
    });
    expect(createRoom).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "prepared-source",
      kind: "screen",
      ready: true,
      label: "Shared screen",
      captureType: "screen",
    });
  });

  it("attaches a prepared screen source immediately when a room is already open", async () => {
    const ensureOffscreenDocument = vi.fn().mockResolvedValue(undefined);
    const sendOffscreenMessage = vi
      .fn()
      .mockResolvedValueOnce({
        sourceLabel: "Shared screen",
        fingerprint: {
          primaryUrl: "screenmate://display-media",
          pageUrl: "chrome-extension://demo/offscreen.html",
          elementId: "screenmate-offscreen-display",
          label: "Shared screen",
          visibleIndex: 0,
        },
      })
      .mockResolvedValueOnce({
        sourceLabel: "Shared screen",
        fingerprint: {
          primaryUrl: "screenmate://display-media",
          pageUrl: "chrome-extension://demo/offscreen.html",
          elementId: "screenmate-offscreen-display",
          label: "Shared screen",
          visibleIndex: 0,
        },
      });
    const followActiveTabVideoStateStorage = {
      getValue: vi.fn().mockResolvedValue({ enabled: true }),
      setValue: vi.fn().mockResolvedValue(undefined),
    };
    const runtime = {
      ...createHandlerDependencies().runtime,
      getSnapshot: vi.fn().mockReturnValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "unattached",
        roomId: "room_123",
      })),
      getAttachSession: vi.fn().mockReturnValue({
        roomId: "room_123",
        sessionId: "host_1",
        viewerSessionIds: ["viewer_1"],
        iceServers: [],
      }),
      setAttachedSource: vi.fn().mockResolvedValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_123",
        sourceLabel: "Shared screen",
        activeTabId: -1,
        activeFrameId: -1,
      })),
    };
    const handler = createHostMessageHandler(createHandlerDependencies({
      ensureOffscreenDocument,
      followActiveTabVideoStateStorage,
      runtime: runtime as never,
      sendOffscreenMessage,
    }));

    const result = await handler({
      type: "screenmate:prepare-screen-source",
      captureType: "screen",
    });

    expect(sendOffscreenMessage).toHaveBeenNthCalledWith(1, {
      type: "screenmate:offscreen-prepare-display-media",
      captureType: "screen",
    });
    expect(sendOffscreenMessage).toHaveBeenNthCalledWith(2, {
      type: "screenmate:offscreen-attach-display-media",
      roomSession: {
        roomId: "room_123",
        sessionId: "host_1",
        viewerSessionIds: ["viewer_1"],
        iceServers: [],
      },
      sourceLabel: "Shared screen",
    });
    expect(followActiveTabVideoStateStorage.setValue).toHaveBeenCalledWith({
      enabled: false,
    });
    expect(runtime.setAttachedSource).toHaveBeenCalledWith("Shared screen", {
      primaryUrl: "screenmate://display-media",
      pageUrl: "chrome-extension://demo/offscreen.html",
      elementId: "screenmate-offscreen-display",
      label: "Shared screen",
      visibleIndex: 0,
      frameId: -1,
      tabId: -1,
    });
    expect(result).toMatchObject({
      status: "prepared-source",
      kind: "screen",
      ready: true,
      label: "Shared screen",
    });
  });

  it("recognizes ScreenMate viewer room URLs across localhost aliases", () => {
    expect(
      isScreenMateViewerUrl(
        "http://127.0.0.1:4173/rooms/room_123",
        "http://localhost:4173",
      ),
    ).toBe(true);
    expect(
      isScreenMateViewerUrl(
        "https://www.bilibili.com/video/BV123",
        "http://localhost:4173",
      ),
    ).toBe(false);
  });

  it("does not treat unrelated local dev room URLs as viewer pages when the configured viewer origin differs", () => {
    expect(
      isScreenMateViewerUrl(
        "http://127.0.0.1:4173/rooms/room_ROybTx25",
        "https://viewer.screenmate.example",
      ),
    ).toBe(false);
  });

  it("ignores content-ready videos from pages that self-identify as the ScreenMate viewer", async () => {
    const videoCache = new VideoSourceCache();
    await videoCache.setForTab(84, [
      {
        id: "screenmate-video-old",
        label: "stale viewer playback",
        tabId: 84,
        frameId: 0,
        isVisible: true,
        visibleArea: 640_000,
      },
    ]);
    const handler = createHostMessageHandler(createHandlerDependencies({
      queryCurrentWindowTabs: vi.fn().mockResolvedValue([
        { id: 84, url: "https://example.test/rooms/room_123" },
      ]),
      videoCache,
    }));

    const result = await handler({
      type: "screenmate:content-ready",
      frameId: 0,
      tabId: 84,
      screenmatePageKind: "viewer",
      videos: [
        {
          id: "screenmate-video-1",
          label: "viewer playback",
          tabId: 84,
          frameId: 0,
          isVisible: true,
          visibleArea: 640_000,
        },
      ],
    });

    expect(result).toMatchObject({
      roomLifecycle: "idle",
      sourceState: "unattached",
    });
    expect(videoCache.getForTab(84)).toEqual([]);
  });

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

  it("excludes ScreenMate viewer tabs from video sniff scans", async () => {
    const setValue = vi.fn().mockResolvedValue(undefined);
    const videoCache = new VideoSourceCache({
      getValue: vi.fn().mockResolvedValue(null),
      setValue,
    });
    const queryCurrentWindowTabs = vi.fn().mockResolvedValue([
      { id: 42, url: "https://www.bilibili.com/video/BV123" },
      { id: 84, url: "http://127.0.0.1:4173/rooms/room_123" },
    ]);
    const sendTabMessage = vi.fn().mockResolvedValue([
      {
        id: "screenmate-video-1",
        label: "source",
      },
    ]);
    const handler = createHostMessageHandler(createHandlerDependencies({
      queryCurrentWindowTabs,
      sendTabMessage,
      videoCache,
      viewerBaseUrl: "http://localhost:4173",
    }));

    const result = await handler({
      type: "screenmate:list-videos",
      refresh: true,
    });

    expect(Array.isArray(result) ? result : []).toHaveLength(1);
    expect(sendTabMessage).toHaveBeenCalledTimes(1);
    expect(sendTabMessage).toHaveBeenCalledWith(
      42,
      { type: "screenmate:list-videos" },
      { frameId: 0 },
    );
    expect(setValue).toHaveBeenCalledTimes(2);
    expect(setValue.mock.calls[0]?.[0]).toMatchObject({
      status: "refreshing",
      tabs: [{ tabId: 42, url: "https://www.bilibili.com/video/BV123" }],
      videos: [],
    });
    expect(setValue.mock.calls[0]?.[0].tabs).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tabId: 84 }),
      ]),
    );
    expect(setValue.mock.calls[1]?.[0]).toMatchObject({
      status: "success",
      tabs: [{ tabId: 42, url: "https://www.bilibili.com/video/BV123" }],
    });
  });

  it("routes popup chat messages through the host runtime", async () => {
    const setAttachedSource = vi.fn().mockResolvedValue({
      roomLifecycle: "open",
      sourceState: "attached",
      roomId: "room_123",
      viewerCount: 1,
      viewerRoster: [],
      chatMessages: [],
      sourceLabel: "demo.mp4",
      activeTabId: -1,
      activeFrameId: -1,
      recoverByTimestamp: null,
      message: null,
    });
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

  it("pushes room chat updates to the attached content chat widget", async () => {
    const sendTabMessage = vi.fn().mockResolvedValue({ ok: true });

    const result = await notifyAttachedContentChat({
      snapshot: createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_123",
        activeTabId: 42,
        activeFrameId: 5,
        chatMessages: [
          {
            messageId: "msg_1",
            senderSessionId: "viewer_1",
            senderRole: "viewer",
            senderName: "Alice",
            text: "hello host",
            sentAt: 123,
          },
        ],
      }),
      sendTabMessage,
    });

    expect(result).toBe(true);
    expect(sendTabMessage).toHaveBeenCalledWith(
      42,
      {
        type: "screenmate:update-chat-messages",
        messages: [
          {
            messageId: "msg_1",
            senderSessionId: "viewer_1",
            senderRole: "viewer",
            senderName: "Alice",
            text: "hello host",
            sentAt: 123,
          },
        ],
      },
      { frameId: 5 },
    );
  });

  it("does not push content chat updates for offscreen sources", async () => {
    const sendTabMessage = vi.fn().mockResolvedValue({ ok: true });

    const result = await notifyAttachedContentChat({
      snapshot: createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_123",
        activeTabId: -1,
        activeFrameId: -1,
      }),
      sendTabMessage,
    });

    expect(result).toBe(false);
    expect(sendTabMessage).not.toHaveBeenCalled();
  });

  it("routes popup room password saves through the host runtime", async () => {
    const snapshot = createHostRoomSnapshot({
      roomLifecycle: "open",
      sourceState: "attached",
      roomId: "room_123",
    });
    const runtime = {
      ...createHandlerDependencies().runtime,
      setRoomPassword: vi.fn().mockResolvedValue({
        ok: true,
        snapshot,
        error: null,
      }),
    };
    const handler = createHostMessageHandler(createHandlerDependencies({
      runtime: runtime as never,
    }));

    const result = await handler({
      type: "screenmate:set-room-password",
      password: "letmein",
    });

    expect(runtime.setRoomPassword).toHaveBeenCalledWith("letmein");
    expect(result).toEqual({
      ok: true,
      snapshot,
      error: null,
    });
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

  it("does not refresh a fresh sniff cache just because a ScreenMate viewer tab is open", async () => {
    const persistedVideos = [
      {
        id: "persisted-video",
        label: "Persisted Video",
        tabId: 42,
        frameId: 0,
      },
    ];
    const sendTabMessage = vi.fn();
    const setValue = vi.fn();
    const videoCache = new VideoSourceCache({
      getValue: vi.fn().mockResolvedValue({
        tabs: [
          {
            tabId: 42,
            title: "Cached tab",
            url: "https://example.com/watch",
          },
        ],
        videos: persistedVideos,
        status: "success",
        isScanning: false,
        updatedAt: Date.now(),
        startedAt: null,
        refreshId: null,
        error: null,
      }),
      setValue,
    });
    const handler = createHostMessageHandler(createHandlerDependencies({
      queryCurrentWindowTabs: vi.fn().mockResolvedValue([
        { id: 42, title: "Cached tab", url: "https://example.com/watch" },
        { id: 84, title: "Viewer", url: "http://127.0.0.1:4173/rooms/room_123" },
      ]),
      sendTabMessage,
      videoCache,
      viewerBaseUrl: "http://localhost:4173",
    }));

    const result = await handler({ type: "screenmate:ensure-video-sniff-state" });

    expect(result).toMatchObject({
      tabs: [
        {
          tabId: 42,
          title: "Cached tab",
          url: "https://example.com/watch",
        },
      ],
      videos: persistedVideos,
      status: "success",
    });
    expect(sendTabMessage).not.toHaveBeenCalled();
    expect(setValue).not.toHaveBeenCalled();
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

  it("refreshes cached tab metadata when content-ready arrives after an SPA navigation", async () => {
    const setValue = vi.fn();
    const videoCache = new VideoSourceCache({
      getValue: vi.fn().mockResolvedValue({
        tabs: [
          {
            tabId: 42,
            title: "Old video title",
            url: "https://example.com/watch/old",
          },
        ],
        videos: [
          {
            id: "old-video",
            label: "Old Video",
            tabId: 42,
            tabTitle: "Old video title",
            frameId: 0,
          },
        ],
        status: "success",
        isScanning: false,
        updatedAt: 123,
        startedAt: null,
        refreshId: null,
        error: null,
      }),
      setValue,
    });
    const handler = createHostMessageHandler(createHandlerDependencies({
      queryCurrentWindowTabs: vi.fn().mockResolvedValue([
        {
          id: 42,
          title: "New video title",
          url: "https://example.com/watch/new",
        },
      ]),
      videoCache,
    }));

    await handler({
      type: "screenmate:content-ready",
      tabId: 42,
      frameId: 0,
      videos: [
        {
          id: "new-video",
          label: "New Video",
          frameId: 0,
        },
      ],
    });

    expect(setValue).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tabs: [
          {
            tabId: 42,
            title: "New video title",
            url: "https://example.com/watch/new",
          },
        ],
        videos: [
          {
            id: "new-video",
            label: "New Video",
            tabId: 42,
            tabTitle: "New video title",
            frameId: 0,
          },
        ],
      }),
    );
  });

  it("ignores content-ready sniff results from ScreenMate viewer tabs", async () => {
    const setValue = vi.fn();
    const videoCache = new VideoSourceCache({
      getValue: vi.fn().mockResolvedValue(null),
      setValue,
    });
    const runtime = {
      ...createHandlerDependencies().runtime,
      getSnapshot: vi.fn().mockReturnValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_123",
      })),
    };
    const handler = createHostMessageHandler(createHandlerDependencies({
      queryCurrentWindowTabs: vi.fn().mockResolvedValue([
        { id: 84, url: "http://127.0.0.1:4173/rooms/room_Lf7vK1RJ" },
      ]),
      runtime: runtime as never,
      videoCache,
      viewerBaseUrl: "http://localhost:4173",
    }));

    await handler({
      type: "screenmate:content-ready",
      tabId: 84,
      frameId: 0,
      videos: [
        {
          id: "viewer-client-video",
          label: "ScreenMate client playback",
          frameId: 0,
        },
      ],
    });

    expect(setValue).not.toHaveBeenCalled();
    expect(runtime.markMissing).not.toHaveBeenCalled();
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

  it("marks the room recovering when the attached source tab is closed", async () => {
    const markRecovering = vi.fn().mockResolvedValue(createHostRoomSnapshot({
      roomLifecycle: "degraded",
      sourceState: "recovering",
      roomId: "room_123",
      activeTabId: 42,
      activeFrameId: 0,
      message: "content-invalidated",
    }));
    const runtime = {
      getSnapshot: vi.fn().mockReturnValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_123",
        activeTabId: 42,
        activeFrameId: 0,
      })),
      markRecovering,
    };

    await markRemovedTabAttachmentOwner({ runtime: runtime as never }, 42);

    expect(markRecovering).toHaveBeenCalledWith("content-invalidated");
  });

  it("does not mark recovering when a non-source tab is closed", async () => {
    const markRecovering = vi.fn();
    const runtime = {
      getSnapshot: vi.fn().mockReturnValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_123",
        activeTabId: 42,
        activeFrameId: 0,
      })),
      markRecovering,
    };

    await markRemovedTabAttachmentOwner({ runtime: runtime as never }, 84);

    expect(markRecovering).not.toHaveBeenCalled();
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

  it("returns an explicit room message before looking for an active tab when no room is open", async () => {
    const queryActiveTabId = vi.fn().mockResolvedValue(null);
    const handler = createHostMessageHandler(createHandlerDependencies({
      queryActiveTabId,
    }));

    const result = await handler({
      type: "screenmate:start-sharing",
      source: { kind: "active-tab-video" },
    });

    expect(result).toBeDefined();
    if (
      !result ||
      Array.isArray(result) ||
      "ok" in result ||
      "status" in result ||
      "enabled" in result
    ) {
      throw new Error("Expected a snapshot result");
    }

    expect(result.roomLifecycle).toBe("idle");
    expect(result.message).toBe("Create a sync room first.");
    expect(result.roomId).toBeNull();
    expect(queryActiveTabId).not.toHaveBeenCalled();
  });

  it("ignores unrelated runtime messages", async () => {
    const handler = createHostMessageHandler(createHandlerDependencies());

    const result = await handler({ type: "screenmate:other" } as unknown as HostMessage);

    expect(result).toBeUndefined();
  });

  it("prepares and starts a local offscreen source in an existing room", async () => {
    const ensureOffscreenDocument = vi.fn().mockResolvedValue(undefined);
    const sendOffscreenMessage = vi.fn().mockResolvedValue({
      sourceLabel: "demo.mp4",
      fingerprint: {
        primaryUrl: "screenmate://local-file/local-demo",
        pageUrl: "chrome-extension://demo/offscreen.html",
        elementId: "screenmate-offscreen-local-video",
        label: "demo.mp4",
        visibleIndex: 0,
      },
    });
    const setAttachedSource = vi.fn().mockResolvedValue({
      roomLifecycle: "open",
      sourceState: "attached",
      roomId: "room_123",
      viewerCount: 1,
      viewerRoster: [],
      chatMessages: [],
      sourceLabel: "demo.mp4",
      activeTabId: -1,
      activeFrameId: -1,
      recoverByTimestamp: null,
      message: null,
    });
    const runtime = {
      ...createHandlerDependencies().runtime,
      getSnapshot: vi.fn().mockReturnValue({
        roomLifecycle: "open",
        sourceState: "unattached",
        roomId: "room_123",
        viewerCount: 0,
        viewerRoster: [],
        chatMessages: [],
        sourceLabel: null,
        activeTabId: 42,
        activeFrameId: 0,
        recoverByTimestamp: null,
        message: null,
      }),
      getAttachSession: vi.fn().mockReturnValue({
        roomId: "room_123",
        sessionId: "host_1",
        viewerSessionIds: ["viewer_1"],
        iceServers: [],
      }),
      setAttachedSource,
    } as never;
    const handler = createHostMessageHandler(createHandlerDependencies({
      ensureOffscreenDocument,
      runtime,
      sendOffscreenMessage,
    }));

    const prepared = await handler({
      type: "screenmate:prepare-local-file-source",
      fileId: "local-demo",
      metadata: {
        id: "local-demo",
        name: "demo.mp4",
        size: 4,
        type: "video/mp4",
        updatedAt: 123,
      },
    });
    const result = await handler({
      type: "screenmate:start-sharing",
      source: { kind: "prepared-offscreen", sourceType: "upload" },
    });

    expect(prepared).toMatchObject({
      status: "prepared-source",
      kind: "upload",
      ready: true,
      label: "demo.mp4",
    });
    expect(ensureOffscreenDocument).toHaveBeenCalledTimes(1);
    expect(sendOffscreenMessage).toHaveBeenCalledWith({
      type: "screenmate:offscreen-attach-local-file",
      roomSession: {
        roomId: "room_123",
        sessionId: "host_1",
        viewerSessionIds: ["viewer_1"],
        iceServers: [],
      },
      fileId: "local-demo",
      metadata: {
        id: "local-demo",
        name: "demo.mp4",
        size: 4,
        type: "video/mp4",
        updatedAt: 123,
      },
    });
    expect(setAttachedSource).toHaveBeenCalledWith("demo.mp4", {
      primaryUrl: "screenmate://local-file/local-demo",
      pageUrl: "chrome-extension://demo/offscreen.html",
      elementId: "screenmate-offscreen-local-video",
      label: "demo.mp4",
      visibleIndex: 0,
      tabId: -1,
      frameId: -1,
    });
    expect(result).toMatchObject({
      roomLifecycle: "open",
      sourceState: "attached",
      activeTabId: -1,
      activeFrameId: -1,
    });
  });

  it("starts a local offscreen source from inline file metadata without relying on volatile prepared state", async () => {
    const ensureOffscreenDocument = vi.fn().mockResolvedValue(undefined);
    const sendOffscreenMessage = vi.fn().mockResolvedValue({
      sourceLabel: "demo.mp4",
      fingerprint: {
        primaryUrl: "screenmate://local-file/local-demo",
        pageUrl: "chrome-extension://demo/offscreen.html",
        elementId: "screenmate-offscreen-local-video",
        label: "demo.mp4",
        visibleIndex: 0,
      },
    });
    const setAttachedSource = vi.fn().mockResolvedValue(createHostRoomSnapshot({
      roomLifecycle: "open",
      sourceState: "attached",
      roomId: "room_123",
      sourceLabel: "demo.mp4",
      activeTabId: -1,
      activeFrameId: -1,
    }));
    const runtime = {
      ...createHandlerDependencies().runtime,
      getSnapshot: vi.fn().mockReturnValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_123",
        sourceLabel: "https://example.com/old-page-video.mp4",
        activeTabId: 42,
        activeFrameId: 0,
      })),
      getAttachSession: vi.fn().mockReturnValue({
        roomId: "room_123",
        sessionId: "host_1",
        viewerSessionIds: ["viewer_1"],
        iceServers: [],
      }),
      setAttachedSource,
    } as never;
    const handler = createHostMessageHandler(createHandlerDependencies({
      ensureOffscreenDocument,
      runtime,
      sendOffscreenMessage,
      sendTabMessage: vi.fn().mockResolvedValue({ ok: true }),
    }));

    const result = await handler({
      type: "screenmate:start-sharing",
      source: {
        kind: "prepared-offscreen",
        sourceType: "upload",
        label: "demo.mp4",
        fileId: "local-demo",
        metadata: {
          id: "local-demo",
          name: "demo.mp4",
          size: 4,
          type: "video/mp4",
          updatedAt: 123,
        },
      },
    });

    expect(sendOffscreenMessage).toHaveBeenCalledWith({
      type: "screenmate:offscreen-attach-local-file",
      roomSession: {
        roomId: "room_123",
        sessionId: "host_1",
        viewerSessionIds: ["viewer_1"],
        iceServers: [],
      },
      fileId: "local-demo",
      metadata: {
        id: "local-demo",
        name: "demo.mp4",
        size: 4,
        type: "video/mp4",
        updatedAt: 123,
      },
    });
    expect(result).toMatchObject({
      roomLifecycle: "open",
      sourceState: "attached",
      activeTabId: -1,
      activeFrameId: -1,
    });
  });

  it("forwards playbackRate in sync-local-playback to offscreen", async () => {
    const sendOffscreenMessage = vi.fn().mockResolvedValue({ ok: true });
    const runtime = {
      ...createHandlerDependencies().runtime,
      getSnapshot: vi.fn().mockReturnValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_123",
        sourceLabel: "demo.mp4",
        activeTabId: -1,
        activeFrameId: -1,
      })),
      getAttachSession: vi.fn().mockReturnValue({
        roomId: "room_123",
        sessionId: "host_1",
        viewerSessionIds: ["viewer_1"],
        iceServers: [],
      }),
    } as never;
    const handler = createHostMessageHandler(
      createHandlerDependencies({ runtime, sendOffscreenMessage }),
    );

    await handler({
      type: "screenmate:sync-local-playback",
      action: "ratechange",
      currentTime: 10,
      playbackRate: 2,
    });

    expect(sendOffscreenMessage).toHaveBeenCalledWith({
      type: "screenmate:offscreen-local-playback-control",
      action: "ratechange",
      currentTime: 10,
      playbackRate: 2,
    });
  });

  it("surfaces local offscreen attach failures from the offscreen document", async () => {
    const attachError =
      "Local video file could not be loaded. The browser may not support this file format or codec.";
    const ensureOffscreenDocument = vi.fn().mockResolvedValue(undefined);
    const sendOffscreenMessage = vi.fn().mockResolvedValue({
      ok: false,
      error: attachError,
    });
    const setAttachedSource = vi.fn();
    const markMissing = vi.fn().mockReturnValue(createHostRoomSnapshot({
      roomLifecycle: "open",
      sourceState: "missing",
      roomId: "room_123",
      sourceLabel: "Shared browser tab",
      activeTabId: -1,
      activeFrameId: -1,
      message: attachError,
    }));
    const runtime = {
      ...createHandlerDependencies().runtime,
      getSnapshot: vi.fn().mockReturnValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_123",
        sourceLabel: "Shared browser tab",
        activeTabId: -1,
        activeFrameId: -1,
      })),
      getAttachSession: vi.fn().mockReturnValue({
        roomId: "room_123",
        sessionId: "host_1",
        viewerSessionIds: ["viewer_1"],
        iceServers: [],
      }),
      markMissing,
      setAttachedSource,
    } as never;
    const handler = createHostMessageHandler(createHandlerDependencies({
      ensureOffscreenDocument,
      runtime,
      sendOffscreenMessage,
    }));

    const result = await handler({
      type: "screenmate:start-sharing",
      source: {
        kind: "prepared-offscreen",
        sourceType: "upload",
        label: "demo.mkv",
        fileId: "local-demo",
        metadata: {
          id: "local-demo",
          name: "demo.mkv",
          size: 4,
          type: "video/x-matroska",
          updatedAt: 123,
        },
      },
    });

    expect(sendOffscreenMessage).toHaveBeenCalledWith({
      type: "screenmate:offscreen-attach-local-file",
      roomSession: {
        roomId: "room_123",
        sessionId: "host_1",
        viewerSessionIds: ["viewer_1"],
        iceServers: [],
      },
      fileId: "local-demo",
      metadata: {
        id: "local-demo",
        name: "demo.mkv",
        size: 4,
        type: "video/x-matroska",
        updatedAt: 123,
      },
    });
    expect(markMissing).toHaveBeenCalledWith(attachError);
    expect(setAttachedSource).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      sourceState: "missing",
      message: attachError,
    });
  });

  it("times out when the local offscreen attach request does not answer", async () => {
    vi.useFakeTimers();
    try {
      const ensureOffscreenDocument = vi.fn().mockResolvedValue(undefined);
      const sendOffscreenMessage = vi.fn(
        () => new Promise<never>(() => {}),
      );
      const setAttachedSource = vi.fn();
      const markMissing = vi.fn().mockReturnValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "missing",
        roomId: "room_123",
        sourceLabel: null,
        activeTabId: -1,
        activeFrameId: -1,
        message: "Offscreen local source did not respond before the timeout.",
      }));
      const runtime = {
        ...createHandlerDependencies().runtime,
        getSnapshot: vi.fn().mockReturnValue(createHostRoomSnapshot({
          roomLifecycle: "open",
          sourceState: "unattached",
          roomId: "room_123",
        })),
        getAttachSession: vi.fn().mockReturnValue({
          roomId: "room_123",
          sessionId: "host_1",
          viewerSessionIds: ["viewer_1"],
          iceServers: [],
        }),
        markMissing,
        setAttachedSource,
      } as never;
      const handler = createHostMessageHandler(createHandlerDependencies({
        ensureOffscreenDocument,
        runtime,
        sendOffscreenMessage,
      }));

      const resultPromise = handler({
        type: "screenmate:start-sharing",
        source: {
          kind: "prepared-offscreen",
          sourceType: "upload",
          label: "demo.mp4",
          fileId: "local-demo",
          metadata: {
            id: "local-demo",
            name: "demo.mp4",
            size: 4,
            type: "video/mp4",
            updatedAt: 123,
          },
        },
      });

      await vi.advanceTimersByTimeAsync(10_001);
      expect(markMissing).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(65_000);
      const result = await resultPromise;

      expect(sendOffscreenMessage).toHaveBeenCalledWith({
        type: "screenmate:offscreen-attach-local-file",
        roomSession: {
          roomId: "room_123",
          sessionId: "host_1",
          viewerSessionIds: ["viewer_1"],
          iceServers: [],
        },
        fileId: "local-demo",
        metadata: {
          id: "local-demo",
          name: "demo.mp4",
          size: 4,
          type: "video/mp4",
          updatedAt: 123,
        },
      });
      expect(markMissing).toHaveBeenCalledWith(
        "Offscreen local source did not respond before the timeout.",
      );
      expect(setAttachedSource).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        sourceState: "missing",
        message: "Offscreen local source did not respond before the timeout.",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts a player local source from the current player video", async () => {
    const sendPlayerMessage = vi.fn().mockResolvedValue({
      sourceLabel: "demo.mp4",
      fingerprint: {
        primaryUrl: "screenmate://player-local-video",
        pageUrl: "chrome-extension://demo/player.html",
        elementId: "screenmate-player-local-video",
        label: "demo.mp4",
        visibleIndex: 0,
      },
    });
    const setAttachedSource = vi.fn().mockResolvedValue(createHostRoomSnapshot({
      roomLifecycle: "open",
      sourceState: "attached",
      roomId: "room_123",
      sourceLabel: "demo.mp4",
      activeTabId: -2,
      activeFrameId: -1,
    }));
    const runtime = {
      ...createHandlerDependencies().runtime,
      getSnapshot: vi.fn().mockReturnValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "unattached",
        roomId: "room_123",
      })),
      getAttachSession: vi.fn().mockReturnValue({
        roomId: "room_123",
        sessionId: "host_1",
        viewerSessionIds: ["viewer_1"],
        iceServers: [{ urls: ["stun:stun.screenmate.dev"] }],
      }),
      setAttachedSource,
    } as never;
    const handler = createHostMessageHandler(createHandlerDependencies({
      runtime,
      sendPlayerMessage,
    }));

    const result = await handler({
      type: "screenmate:start-sharing",
      source: {
        kind: "player-local-video",
        label: "demo.mp4",
      },
    });

    expect(sendPlayerMessage).toHaveBeenCalledWith({
      type: "screenmate:player-attach-local-video",
      roomSession: {
        roomId: "room_123",
        sessionId: "host_1",
        viewerSessionIds: ["viewer_1"],
        iceServers: [{ urls: ["stun:stun.screenmate.dev"] }],
      },
      sourceLabel: "demo.mp4",
    });
    expect(setAttachedSource).toHaveBeenCalledWith("demo.mp4", {
      primaryUrl: "screenmate://player-local-video",
      pageUrl: "chrome-extension://demo/player.html",
      elementId: "screenmate-player-local-video",
      label: "demo.mp4",
      visibleIndex: 0,
      tabId: -2,
      frameId: -1,
    });
    expect(result).toMatchObject({
      sourceState: "attached",
      sourceLabel: "demo.mp4",
      activeTabId: -2,
      activeFrameId: -1,
    });
  });

  it("waits for slower player local source attach responses", async () => {
    vi.useFakeTimers();
    try {
      const playerAttachResponse = {
        sourceLabel: "mounted-demo.mp4",
        fingerprint: {
          primaryUrl: "screenmate://player-local-video",
          pageUrl: "chrome-extension://demo/player.html",
          elementId: "screenmate-player-local-video",
          label: "mounted-demo.mp4",
          visibleIndex: 0,
        },
      };
      const sendPlayerMessage = vi.fn(
        () =>
          new Promise<typeof playerAttachResponse>((resolve) => {
            setTimeout(() => resolve(playerAttachResponse), 15_000);
          }),
      );
      const markMissing = vi.fn();
      const setAttachedSource = vi.fn().mockResolvedValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_123",
        sourceLabel: "mounted-demo.mp4",
        activeTabId: -2,
        activeFrameId: -1,
      }));
      const runtime = {
        ...createHandlerDependencies().runtime,
        getSnapshot: vi.fn().mockReturnValue(createHostRoomSnapshot({
          roomLifecycle: "open",
          sourceState: "unattached",
          roomId: "room_123",
        })),
        getAttachSession: vi.fn().mockReturnValue({
          roomId: "room_123",
          sessionId: "host_1",
          viewerSessionIds: ["viewer_1"],
          iceServers: [],
        }),
        markMissing,
        setAttachedSource,
      } as never;
      const handler = createHostMessageHandler(createHandlerDependencies({
        runtime,
        sendPlayerMessage,
      }));

      const resultPromise = handler({
        type: "screenmate:start-sharing",
        source: {
          kind: "player-local-video",
          label: "mounted-demo.mp4",
        },
      });

      await vi.advanceTimersByTimeAsync(15_001);
      const result = await resultPromise;

      expect(markMissing).not.toHaveBeenCalled();
      expect(setAttachedSource).toHaveBeenCalledWith("mounted-demo.mp4", {
        primaryUrl: "screenmate://player-local-video",
        pageUrl: "chrome-extension://demo/player.html",
        elementId: "screenmate-player-local-video",
        label: "mounted-demo.mp4",
        visibleIndex: 0,
        tabId: -2,
        frameId: -1,
      });
      expect(result).toMatchObject({
        sourceState: "attached",
        sourceLabel: "mounted-demo.mp4",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("renegotiates player local sources for viewers learned while attaching", async () => {
    const sendPlayerMessage = vi.fn().mockResolvedValue({
      sourceLabel: "mounted-demo.mp4",
      fingerprint: {
        primaryUrl: "screenmate://player-local-video",
        pageUrl: "chrome-extension://demo/player.html",
        elementId: "screenmate-player-local-video",
        label: "mounted-demo.mp4",
        visibleIndex: 0,
      },
    });
    const getAttachSession = vi
      .fn()
      .mockReturnValueOnce({
        roomId: "room_123",
        sessionId: "host_1",
        viewerSessionIds: [],
        iceServers: [],
      })
      .mockReturnValue({
        roomId: "room_123",
        sessionId: "host_1",
        viewerSessionIds: ["viewer_1"],
        iceServers: [],
      });
    const runtime = {
      ...createHandlerDependencies().runtime,
      getSnapshot: vi.fn().mockReturnValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "unattached",
        roomId: "room_123",
      })),
      getAttachSession,
      setAttachedSource: vi.fn().mockResolvedValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_123",
        sourceLabel: "mounted-demo.mp4",
        activeTabId: -2,
        activeFrameId: -1,
        viewerCount: 1,
      })),
    } as never;
    const handler = createHostMessageHandler(createHandlerDependencies({
      runtime,
      sendPlayerMessage,
    }));

    await handler({
      type: "screenmate:start-sharing",
      source: {
        kind: "player-local-video",
        label: "mounted-demo.mp4",
      },
    });

    expect(sendPlayerMessage).toHaveBeenNthCalledWith(1, {
      type: "screenmate:player-attach-local-video",
      roomSession: {
        roomId: "room_123",
        sessionId: "host_1",
        viewerSessionIds: [],
        iceServers: [],
      },
      sourceLabel: "mounted-demo.mp4",
    });
    expect(sendPlayerMessage).toHaveBeenNthCalledWith(2, {
      type: "screenmate:player-signal-inbound",
      envelope: expect.objectContaining({
        roomId: "room_123",
        sessionId: "viewer_1",
        role: "viewer",
        messageType: "viewer-joined",
        payload: {
          viewerSessionId: "viewer_1",
        },
      }),
    });
  });

  it("detaches the previous offscreen source before attaching the player local source", async () => {
    const sendOffscreenMessage = vi.fn().mockResolvedValue({ ok: true });
    const sendPlayerMessage = vi.fn().mockResolvedValue({
      sourceLabel: "demo.mp4",
      fingerprint: {
        primaryUrl: "screenmate://player-local-video",
        pageUrl: "chrome-extension://demo/player.html",
        elementId: "screenmate-player-local-video",
        label: "demo.mp4",
        visibleIndex: 0,
      },
    });
    const runtime = {
      ...createHandlerDependencies().runtime,
      getSnapshot: vi.fn().mockReturnValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_123",
        sourceLabel: "Shared browser tab",
        activeTabId: -1,
        activeFrameId: -1,
      })),
      getAttachSession: vi.fn().mockReturnValue({
        roomId: "room_123",
        sessionId: "host_1",
        viewerSessionIds: [],
        iceServers: [],
      }),
      setAttachedSource: vi.fn().mockResolvedValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_123",
        sourceLabel: "demo.mp4",
        activeTabId: -2,
        activeFrameId: -1,
      })),
    } as never;
    const handler = createHostMessageHandler(createHandlerDependencies({
      runtime,
      sendOffscreenMessage,
      sendPlayerMessage,
    }));

    await handler({
      type: "screenmate:start-sharing",
      source: {
        kind: "player-local-video",
        label: "demo.mp4",
      },
    });

    expect(sendOffscreenMessage).toHaveBeenCalledWith({
      type: "screenmate:offscreen-detach-source",
    });
    expect(
      sendOffscreenMessage.mock.invocationCallOrder[0],
    ).toBeLessThan(sendPlayerMessage.mock.invocationCallOrder[0] ?? 0);
  });

  it("starts a prepared screen source without passing a legacy desktop stream id", async () => {
    const ensureOffscreenDocument = vi.fn().mockResolvedValue(undefined);
    const sendOffscreenMessage = vi
      .fn()
      .mockResolvedValueOnce({
        sourceLabel: "Shared screen",
        fingerprint: {
          primaryUrl: "screenmate://display-media",
          pageUrl: "chrome-extension://demo/offscreen.html",
          elementId: "screenmate-offscreen-display",
          label: "Shared screen",
          visibleIndex: 0,
        },
      })
      .mockResolvedValueOnce({
        sourceLabel: "Shared screen",
        fingerprint: {
          primaryUrl: "screenmate://display-media",
          pageUrl: "chrome-extension://demo/offscreen.html",
          elementId: "screenmate-offscreen-display",
          label: "Shared screen",
          visibleIndex: 0,
        },
      });
    const setAttachedSource = vi.fn().mockResolvedValue({
      roomLifecycle: "open",
      sourceState: "attached",
      roomId: "room_123",
      viewerCount: 1,
      viewerRoster: [],
      chatMessages: [],
      sourceLabel: "Shared screen",
      activeTabId: -1,
      activeFrameId: -1,
      recoverByTimestamp: null,
      message: null,
    });
    const runtime = {
      ...createHandlerDependencies().runtime,
      getSnapshot: vi.fn().mockReturnValue({
        roomLifecycle: "open",
        sourceState: "unattached",
        roomId: "room_123",
        viewerCount: 0,
        viewerRoster: [],
        chatMessages: [],
        sourceLabel: null,
        activeTabId: 42,
        activeFrameId: 0,
        recoverByTimestamp: null,
        message: null,
      }),
      getAttachSession: vi.fn().mockReturnValue({
        roomId: "room_123",
        sessionId: "host_1",
        viewerSessionIds: ["viewer_1"],
        iceServers: [],
      }),
      setAttachedSource,
    } as never;
    const handler = createHostMessageHandler(createHandlerDependencies({
      ensureOffscreenDocument,
      runtime,
      sendOffscreenMessage,
    }));

    const prepared = await handler({
      type: "screenmate:prepare-screen-source",
      captureType: "screen",
    });

    expect(prepared).toMatchObject({
      status: "prepared-source",
      kind: "screen",
      ready: true,
      label: "Shared screen",
      captureType: "screen",
    });
    expect(ensureOffscreenDocument).toHaveBeenCalledTimes(2);
    expect(sendOffscreenMessage).toHaveBeenNthCalledWith(1, {
      type: "screenmate:offscreen-prepare-display-media",
      captureType: "screen",
    });
    expect(sendOffscreenMessage).toHaveBeenNthCalledWith(2, {
      type: "screenmate:offscreen-attach-display-media",
      roomSession: {
        roomId: "room_123",
        sessionId: "host_1",
        viewerSessionIds: ["viewer_1"],
        iceServers: [],
      },
      sourceLabel: "Shared screen",
    });
    expect(setAttachedSource).toHaveBeenCalledWith("Shared screen", {
      primaryUrl: "screenmate://display-media",
      pageUrl: "chrome-extension://demo/offscreen.html",
      elementId: "screenmate-offscreen-display",
      label: "Shared screen",
      visibleIndex: 0,
      tabId: -1,
      frameId: -1,
    });
  });

  it("restores a prepared screen source from offscreen before starting", async () => {
    const ensureOffscreenDocument = vi.fn().mockResolvedValue(undefined);
    const sendOffscreenMessage = vi
      .fn()
      .mockResolvedValueOnce({
        sourceLabel: "Shared screen",
        fingerprint: {
          primaryUrl: "screenmate://display-media",
          pageUrl: "chrome-extension://demo/offscreen.html",
          elementId: "screenmate-offscreen-display",
          label: "Shared screen",
          visibleIndex: 0,
        },
      })
      .mockResolvedValueOnce({
        sourceLabel: "Shared screen",
        fingerprint: {
          primaryUrl: "screenmate://display-media",
          pageUrl: "chrome-extension://demo/offscreen.html",
          elementId: "screenmate-offscreen-display",
          label: "Shared screen",
          visibleIndex: 0,
        },
      });
    const runtime = {
      ...createHandlerDependencies().runtime,
      getSnapshot: vi.fn().mockReturnValue({
        roomLifecycle: "open",
        sourceState: "unattached",
        roomId: "room_123",
        viewerCount: 0,
        viewerRoster: [],
        chatMessages: [],
        sourceLabel: null,
        activeTabId: 42,
        activeFrameId: 0,
        recoverByTimestamp: null,
        message: null,
      }),
      getAttachSession: vi.fn().mockReturnValue({
        roomId: "room_123",
        sessionId: "host_1",
        viewerSessionIds: [],
        iceServers: [],
      }),
      setAttachedSource: vi.fn().mockResolvedValue({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_123",
        sourceLabel: "Shared screen",
        activeTabId: -1,
        activeFrameId: -1,
      }),
    } as never;
    const handler = createHostMessageHandler(createHandlerDependencies({
      ensureOffscreenDocument,
      preparedSourceState: {
        status: "prepared-source",
        kind: null,
        ready: false,
        label: null,
        metadata: null,
        error: null,
      },
      runtime,
      sendOffscreenMessage,
    }));

    const result = await handler({
      type: "screenmate:start-sharing",
      source: { kind: "prepared-offscreen", sourceType: "screen" },
    });

    expect(sendOffscreenMessage).toHaveBeenNthCalledWith(1, {
      type: "screenmate:offscreen-get-prepared-display-media-state",
    });
    expect(sendOffscreenMessage).toHaveBeenNthCalledWith(2, {
      type: "screenmate:offscreen-attach-display-media",
      roomSession: {
        roomId: "room_123",
        sessionId: "host_1",
        viewerSessionIds: [],
        iceServers: [],
      },
      sourceLabel: "Shared screen",
    });
    expect(result).toMatchObject({
      sourceState: "attached",
      activeTabId: -1,
      activeFrameId: -1,
    });
  });

  it("proxies local playback state requests to the offscreen source owner", async () => {
    const ensureOffscreenDocument = vi.fn().mockResolvedValue(undefined);
    const sendOffscreenMessage = vi.fn().mockResolvedValue({
      status: "local-playback-state",
      active: true,
      currentTime: 42,
      duration: 120,
      paused: false,
      playbackRate: 1,
      sourceLabel: "demo.mp4",
    });
    const handler = createHostMessageHandler(createHandlerDependencies({
      ensureOffscreenDocument,
      sendOffscreenMessage,
    }));

    const result = await handler({
      type: "screenmate:get-local-playback-state",
    });

    expect(ensureOffscreenDocument).toHaveBeenCalledTimes(1);
    expect(sendOffscreenMessage).toHaveBeenCalledWith({
      type: "screenmate:offscreen-get-local-playback-state",
    });
    expect(result).toEqual({
      status: "local-playback-state",
      active: true,
      currentTime: 42,
      duration: 120,
      paused: false,
      playbackRate: 1,
      sourceLabel: "demo.mp4",
    });
  });

  it("disables automatic follow before attaching a prepared screen source", async () => {
    const ensureOffscreenDocument = vi.fn().mockResolvedValue(undefined);
    const sendOffscreenMessage = vi.fn().mockResolvedValue({
      sourceLabel: "Shared screen",
      fingerprint: {
        primaryUrl: "screenmate://display-media",
        pageUrl: "chrome-extension://demo/offscreen.html",
        elementId: "screenmate-offscreen-display",
        label: "Shared screen",
        visibleIndex: 0,
      },
    });
    const followActiveTabVideoStateStorage = {
      getValue: vi.fn().mockResolvedValue({ enabled: true }),
      setValue: vi.fn().mockResolvedValue(undefined),
    };
    const runtime = {
      ...createHandlerDependencies().runtime,
      getSnapshot: vi.fn().mockReturnValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_123",
        sourceLabel: "https://example.com/old-page-video.mp4",
        activeTabId: 42,
        activeFrameId: 0,
      })),
      getAttachSession: vi.fn().mockReturnValue({
        roomId: "room_123",
        sessionId: "host_1",
        viewerSessionIds: [],
        iceServers: [],
      }),
      setAttachedSource: vi.fn().mockResolvedValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_123",
        sourceLabel: "Shared screen",
        activeTabId: -1,
        activeFrameId: -1,
      })),
    } as never;
    const sendTabMessage = vi.fn().mockResolvedValue({ ok: true });
    const handler = createHostMessageHandler(createHandlerDependencies({
      ensureOffscreenDocument,
      followActiveTabVideoStateStorage,
      preparedSourceState: {
        status: "prepared-source",
        kind: "screen",
        ready: true,
        label: "Shared screen",
        metadata: null,
        captureType: "screen",
        error: null,
      },
      runtime,
      sendOffscreenMessage,
      sendTabMessage,
    }));

    await handler({
      type: "screenmate:start-sharing",
      source: { kind: "prepared-offscreen", sourceType: "screen" },
    });

    expect(followActiveTabVideoStateStorage.setValue).toHaveBeenCalledWith({
      enabled: false,
    });
    expect(
      followActiveTabVideoStateStorage.setValue.mock.invocationCallOrder[0],
    ).toBeLessThan(sendOffscreenMessage.mock.invocationCallOrder[0] ?? 0);
  });

  it("does not let an in-flight automatic follow overwrite a manual screen attachment", async () => {
    let releaseListVideos!: () => void;
    let markListVideosStarted!: () => void;
    const listVideosStarted = new Promise<void>((resolve) => {
      markListVideosStarted = resolve;
    });
    const listVideosGate = new Promise<void>((resolve) => {
      releaseListVideos = resolve;
    });
    let currentSnapshot = createHostRoomSnapshot({
      roomLifecycle: "open",
      sourceState: "attached",
      roomId: "room_123",
      sourceLabel: "https://example.com/old-page-video.mp4",
      activeTabId: 42,
      activeFrameId: 0,
    });
    const runtime = {
      ...createHandlerDependencies().runtime,
      getSnapshot: vi.fn(() => currentSnapshot),
      getAttachSession: vi.fn().mockReturnValue({
        roomId: "room_123",
        sessionId: "host_1",
        viewerSessionIds: [],
        iceServers: [],
      }),
      getSourceFingerprint: vi.fn().mockReturnValue(null),
      setAttachedSource: vi.fn().mockImplementation(
        async (
          sourceLabel: string,
          fingerprint: { tabId: number; frameId: number },
        ) => {
          currentSnapshot = createHostRoomSnapshot({
            roomLifecycle: "open",
            sourceState: "attached",
            roomId: "room_123",
            sourceLabel,
            activeTabId: fingerprint.tabId,
            activeFrameId: fingerprint.frameId,
          });
          return currentSnapshot;
        },
      ),
    };
    const followActiveTabVideoStateStorage = {
      getValue: vi.fn().mockResolvedValue({ enabled: true }),
      setValue: vi.fn().mockResolvedValue(undefined),
    };
    const ensureOffscreenDocument = vi.fn().mockResolvedValue(undefined);
    const sendOffscreenMessage = vi.fn().mockResolvedValue({
      sourceLabel: "Shared screen",
      fingerprint: {
        primaryUrl: "screenmate://display-media",
        pageUrl: "chrome-extension://demo/offscreen.html",
        elementId: "screenmate-offscreen-display",
        label: "Shared screen",
        visibleIndex: 0,
      },
    });
    const sendTabMessage = vi.fn().mockImplementation(
      async (
        _tabId: number,
        message: TestTabMessage,
      ) => {
        if (message.type === "screenmate:list-videos") {
          markListVideosStarted();
          await listVideosGate;
          return [
            {
              id: "screenmate-video-1",
              label: "playing",
              isPlaying: true,
              isVisible: true,
              visibleArea: 640_000,
              fingerprint: {
                primaryUrl: "https://example.com/playing.mp4",
                pageUrl: "https://example.com/watch",
                elementId: "playing",
                label: "playing",
                visibleIndex: 0,
              },
            },
          ];
        }

        if (message.type === "screenmate:attach-source") {
          return {
            sourceLabel: "playing",
            fingerprint: {
              primaryUrl: "https://example.com/playing.mp4",
              pageUrl: "https://example.com/watch",
              elementId: "playing",
              label: "playing",
              visibleIndex: 0,
            },
          };
        }

        return { ok: true };
      },
    );
    const dependencies = createHandlerDependencies({
      ensureOffscreenDocument,
      followActiveTabVideoStateStorage,
      preparedSourceState: {
        status: "prepared-source",
        kind: "screen",
        ready: true,
        label: "Shared screen",
        metadata: null,
        captureType: "screen",
        error: null,
      },
      runtime,
      sendOffscreenMessage,
      sendTabMessage,
    });
    const handler = createHostMessageHandler(dependencies);

    const followPromise = followActiveTabVideoOnce(dependencies, 42);
    await listVideosStarted;
    const screenResult = await handler({
      type: "screenmate:start-sharing",
      source: { kind: "prepared-offscreen", sourceType: "screen" },
    });
    releaseListVideos();
    await followPromise;

    expect(screenResult).toMatchObject({
      sourceState: "attached",
      activeTabId: -1,
      activeFrameId: -1,
    });
    expect(
      sendTabMessage.mock.calls.filter(
        ([, message]) => message.type === "screenmate:attach-source",
      ),
    ).toHaveLength(0);
    expect(runtime.setAttachedSource).toHaveBeenCalledTimes(1);
    expect(runtime.setAttachedSource).toHaveBeenCalledWith(
      "Shared screen",
      expect.objectContaining({
        tabId: -1,
        frameId: -1,
      }),
    );
  });

  it("clears the prepared screen state after it becomes the active offscreen source", async () => {
    const ensureOffscreenDocument = vi.fn().mockResolvedValue(undefined);
    const sendOffscreenMessage = vi
      .fn()
      .mockResolvedValueOnce({
        sourceLabel: "Shared screen",
        fingerprint: {
          primaryUrl: "screenmate://display-media",
          pageUrl: "chrome-extension://demo/offscreen.html",
          elementId: "screenmate-offscreen-display",
          label: "Shared screen",
          visibleIndex: 0,
        },
      })
      .mockResolvedValueOnce({
        sourceLabel: "Shared screen",
        fingerprint: {
          primaryUrl: "screenmate://display-media",
          pageUrl: "chrome-extension://demo/offscreen.html",
          elementId: "screenmate-offscreen-display",
          label: "Shared screen",
          visibleIndex: 0,
        },
      })
      .mockResolvedValueOnce(undefined);
    const runtime = {
      ...createHandlerDependencies().runtime,
      getSnapshot: vi.fn().mockReturnValue({
        roomLifecycle: "open",
        sourceState: "unattached",
        roomId: "room_123",
        viewerCount: 0,
        viewerRoster: [],
        chatMessages: [],
        sourceLabel: null,
        activeTabId: 42,
        activeFrameId: 0,
        recoverByTimestamp: null,
        message: null,
      }),
      getAttachSession: vi.fn().mockReturnValue({
        roomId: "room_123",
        sessionId: "host_1",
        viewerSessionIds: [],
        iceServers: [],
      }),
      setAttachedSource: vi.fn().mockResolvedValue({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_123",
        sourceLabel: "Shared screen",
        activeTabId: -1,
        activeFrameId: -1,
      }),
    } as never;
    const handler = createHostMessageHandler(createHandlerDependencies({
      ensureOffscreenDocument,
      runtime,
      sendOffscreenMessage,
    }));

    await handler({
      type: "screenmate:prepare-screen-source",
      captureType: "screen",
    });
    await handler({
      type: "screenmate:start-sharing",
      source: { kind: "prepared-offscreen", sourceType: "screen" },
    });
    const preparedState = await handler({
      type: "screenmate:get-prepared-source-state",
    });

    expect(preparedState).toEqual({
      status: "prepared-source",
      kind: null,
      ready: false,
      label: null,
      metadata: null,
      error: null,
    });
  });

  it("clears a prepared source without detaching an active offscreen stream", async () => {
    const ensureOffscreenDocument = vi.fn().mockResolvedValue(undefined);
    const sendOffscreenMessage = vi.fn().mockResolvedValue({ ok: true });
    const runtime = {
      ...createHandlerDependencies().runtime,
      getSnapshot: vi.fn().mockReturnValue({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_123",
        sourceLabel: "Shared screen",
        activeTabId: -1,
        activeFrameId: -1,
      }),
    } as never;
    const handler = createHostMessageHandler(createHandlerDependencies({
      ensureOffscreenDocument,
      preparedSourceState: {
        status: "prepared-source",
        kind: "screen",
        ready: true,
        label: "Shared screen",
        metadata: null,
        captureType: "screen",
        error: null,
      },
      runtime,
      sendOffscreenMessage,
    }));

    const result = await handler({
      type: "screenmate:clear-prepared-source-state",
    });

    expect(sendOffscreenMessage).toHaveBeenCalledWith({
      type: "screenmate:offscreen-clear-prepared-source",
    });
    expect(result).toEqual({
      status: "prepared-source",
      kind: null,
      ready: false,
      label: null,
      metadata: null,
      error: null,
    });
  });

  it("stores disabled active-tab follow state without attaching a source", async () => {
    let stored = { enabled: true };
    const followActiveTabVideoStateStorage = {
      getValue: vi.fn(async () => stored),
      setValue: vi.fn(async (next: { enabled: boolean }) => {
        stored = next;
      }),
    };
    const queryActiveTabId = vi.fn().mockResolvedValue(42);
    const sendTabMessage = vi.fn();
    const handler = createHostMessageHandler(createHandlerDependencies({
      followActiveTabVideoStateStorage,
      queryActiveTabId,
      sendTabMessage,
    }));

    await expect(handler({
      type: "screenmate:get-follow-active-tab-video-state",
    })).resolves.toEqual({ enabled: true });
    await expect(handler({
      type: "screenmate:set-follow-active-tab-video",
      enabled: false,
    })).resolves.toEqual({ enabled: false });

    expect(followActiveTabVideoStateStorage.setValue).toHaveBeenCalledWith({
      enabled: false,
    });
    expect(queryActiveTabId).not.toHaveBeenCalled();
    expect(sendTabMessage).not.toHaveBeenCalled();
  });

  it("starts following the current active tab when automatic follow is turned on", async () => {
    const runtime = {
      ...createHandlerDependencies().runtime,
      getAttachSession: vi.fn().mockReturnValue({
        roomId: "room_123",
        sessionId: "host_1",
        viewerSessionIds: [],
        iceServers: [],
      }),
      getSnapshot: vi.fn().mockReturnValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "missing",
        roomId: "room_123",
        activeTabId: null,
        activeFrameId: null,
      })),
      getSourceFingerprint: vi.fn().mockReturnValue(null),
      setAttachedSource: vi.fn().mockResolvedValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_123",
        sourceLabel: "ready-video",
        activeTabId: 42,
        activeFrameId: 0,
      })),
    };
    const queryActiveTabId = vi.fn().mockResolvedValue(42);
    const sendTabMessage = vi.fn().mockImplementation(
      async (
        _tabId: number,
        message: TestTabMessage,
      ) => {
        if (message.type === "screenmate:list-videos") {
          return [
            {
              id: "screenmate-video-ready",
              label: "ready-video",
              isPlaying: true,
              isVisible: true,
              visibleArea: 640_000,
              fingerprint: {
                primaryUrl: "https://example.com/ready.mp4",
                pageUrl: "https://example.com/watch",
                elementId: "ready",
                label: "ready-video",
                visibleIndex: 0,
              },
            },
          ];
        }

        if (message.type === "screenmate:attach-source") {
          return {
            sourceLabel: "ready-video",
            fingerprint: {
              primaryUrl: "https://example.com/ready.mp4",
              pageUrl: "https://example.com/watch",
              elementId: "ready",
              label: "ready-video",
              visibleIndex: 0,
            },
          };
        }

        return { ok: true };
      },
    );
    const followActiveTabVideoStateStorage = {
      getValue: vi.fn().mockResolvedValue({ enabled: false }),
      setValue: vi.fn().mockResolvedValue(undefined),
    };
    const handler = createHostMessageHandler(createHandlerDependencies({
      followActiveTabVideoStateStorage,
      queryActiveTabId,
      runtime: runtime as never,
      sendTabMessage,
    }));

    await expect(handler({
      type: "screenmate:set-follow-active-tab-video",
      enabled: true,
    })).resolves.toEqual({ enabled: true });

    expect(followActiveTabVideoStateStorage.setValue).toHaveBeenCalledWith({
      enabled: true,
    });
    expect(queryActiveTabId).toHaveBeenCalled();
    expect(sendTabMessage).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        type: "screenmate:attach-source",
        videoId: "screenmate-video-ready",
      }),
      { frameId: 0 },
    );
    expect(runtime.setAttachedSource).toHaveBeenCalledWith(
      "ready-video",
      expect.objectContaining({
        frameId: 0,
        tabId: 42,
      }),
    );
  });

  it("detaches the current source when automatic follow is turned off", async () => {
    const runtime = {
      ...createHandlerDependencies().runtime,
      getSnapshot: vi.fn().mockReturnValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_123",
        activeTabId: 42,
        activeFrameId: 0,
        sourceLabel: "playing",
      })),
      markMissing: vi.fn().mockResolvedValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "missing",
        roomId: "room_123",
        activeTabId: 42,
        activeFrameId: 0,
        message: "No video attached.",
      })),
    };
    const sendTabMessage = vi.fn().mockResolvedValue({ ok: true });
    const followActiveTabVideoStateStorage = {
      getValue: vi.fn().mockResolvedValue({ enabled: true }),
      setValue: vi.fn().mockResolvedValue(undefined),
    };
    const handler = createHostMessageHandler(createHandlerDependencies({
      followActiveTabVideoStateStorage,
      runtime: runtime as never,
      sendTabMessage,
    }));

    await expect(handler({
      type: "screenmate:set-follow-active-tab-video",
      enabled: false,
    })).resolves.toEqual({ enabled: false });

    expect(sendTabMessage).toHaveBeenCalledWith(
      42,
      { type: "screenmate:detach-source" },
      { frameId: 0 },
    );
    expect(runtime.markMissing).toHaveBeenCalledWith("No video attached.");
  });

  it("creates a room session without attaching a source", async () => {
    const createRoom = vi.fn().mockResolvedValue({
      roomId: "room_123",
      hostSessionId: "host_1",
      hostToken: "host-token",
      signalingUrl: "/rooms/room_123/ws",
      iceServers: [{ urls: ["stun:stun.screenmate.dev"] }],
    });
    const runtime = {
      connectSignaling: vi.fn().mockResolvedValue(true),
      getSnapshot: vi.fn().mockReturnValue(createHostRoomSnapshot()),
      startRoom: vi.fn().mockResolvedValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "unattached",
        roomId: "room_123",
        activeTabId: null,
        activeFrameId: null,
      })),
    };
    const followActiveTabVideoStateStorage = {
      getValue: vi.fn().mockResolvedValue({ enabled: true }),
      setValue: vi.fn().mockResolvedValue(undefined),
    };
    const handler = createHostMessageHandler(createHandlerDependencies({
      createRoom,
      followActiveTabVideoStateStorage,
      runtime: runtime as never,
    }));

    const result = await handler({
      type: "screenmate:create-room-session",
    });

    expect(createRoom).toHaveBeenCalledWith("http://localhost:8787");
    expect(followActiveTabVideoStateStorage.setValue).toHaveBeenCalledWith({
      enabled: false,
    });
    expect(
      followActiveTabVideoStateStorage.setValue.mock.invocationCallOrder[0],
    ).toBeLessThan(runtime.startRoom.mock.invocationCallOrder[0] ?? 0);
    expect(runtime.startRoom).toHaveBeenCalledWith(
      expect.objectContaining({
        activeFrameId: null,
        activeTabId: null,
        roomId: "room_123",
        sourceFingerprint: null,
      }),
    );
    expect(runtime.connectSignaling).toHaveBeenCalled();
    expect(result).toMatchObject({
      roomLifecycle: "open",
      roomId: "room_123",
      sourceState: "unattached",
    });
  });

  it("does not create a room implicitly when starting a selected source", async () => {
    const createRoom = vi.fn();
    const runtime = {
      ...createHandlerDependencies().runtime,
      getSnapshot: vi.fn().mockReturnValue(createHostRoomSnapshot()),
    };
    const sendTabMessage = vi.fn();
    const handler = createHostMessageHandler(createHandlerDependencies({
      createRoom,
      runtime: runtime as never,
      sendTabMessage,
    }));

    const result = await handler({
      type: "screenmate:start-sharing",
      source: {
        kind: "tab-video",
        tabId: 42,
        frameId: 7,
        videoId: "screenmate-video-1",
      },
    });

    expect(createRoom).not.toHaveBeenCalled();
    expect(sendTabMessage).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      roomLifecycle: "idle",
      roomId: null,
      sourceState: "unattached",
      message: "Create a sync room first.",
    });
  });

  it("attaches the requested source in an existing room", async () => {
    const createRoom = vi.fn();
    const runtime = {
      connectSignaling: vi.fn().mockResolvedValue(true),
      getSnapshot: vi.fn().mockReturnValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "unattached",
        roomId: "room_123",
        activeTabId: null,
        activeFrameId: null,
      })),
      getAttachSession: vi.fn().mockReturnValue({
        roomId: "room_123",
        sessionId: "host_1",
        viewerSessionIds: [],
        iceServers: [{ urls: ["stun:stun.screenmate.dev"] }],
      }),
      setAttachedSource: vi.fn().mockResolvedValue({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_123",
        viewerCount: 0,
        sourceLabel: "Video 1",
        activeTabId: 42,
        activeFrameId: 7,
        recoverByTimestamp: null,
        message: null,
      }),
    };
    const sendTabMessage = vi.fn().mockResolvedValue({
      sourceLabel: "Video 1",
      fingerprint: {
        primaryUrl: "https://example.com/video.mp4",
        elementId: "video-1",
        label: "Video 1",
        visibleIndex: 0,
      },
    });
    const handler = createHostMessageHandler(createHandlerDependencies({
      createRoom,
      runtime: runtime as never,
      sendTabMessage,
    }));

    const result = await handler({
      type: "screenmate:start-sharing",
      source: {
        kind: "tab-video",
        tabId: 42,
        frameId: 7,
        videoId: "screenmate-video-1",
      },
    });

    expect(createRoom).not.toHaveBeenCalled();
    expect(runtime.connectSignaling).not.toHaveBeenCalled();
    expect(sendTabMessage).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        type: "screenmate:attach-source",
        videoId: "screenmate-video-1",
      }),
      { frameId: 7 },
    );
    expect(result).toMatchObject({
      roomLifecycle: "open",
      roomId: "room_123",
      sourceState: "attached",
    });
  });

  it("attaches the active tab video in an existing room", async () => {
    const runtime = {
      ...createHandlerDependencies().runtime,
      getAttachSession: vi.fn().mockReturnValue({
        roomId: "room_123",
        sessionId: "host_1",
        viewerSessionIds: [],
        iceServers: [],
      }),
      getSnapshot: vi
        .fn()
        .mockReturnValue(createHostRoomSnapshot({
          roomLifecycle: "open",
          sourceState: "unattached",
          roomId: "room_123",
          activeTabId: null,
          activeFrameId: null,
        })),
      getSourceFingerprint: vi.fn().mockReturnValue(null),
      startRoom: vi.fn(),
      connectSignaling: vi.fn().mockResolvedValue(true),
    };
    const sendTabMessage = vi.fn().mockImplementation(
      async (
        _tabId: number,
        message: TestTabMessage,
      ) => {
        if (message.type === "screenmate:list-videos") {
          return [
            {
              id: "screenmate-video-1",
              label: "playing",
              isPlaying: true,
              isVisible: true,
              visibleArea: 640_000,
              fingerprint: {
                primaryUrl: "https://example.com/playing.mp4",
                pageUrl: "https://example.com/watch",
                elementId: "playing",
                label: "playing",
                visibleIndex: 0,
              },
            },
          ];
        }

        if (message.type === "screenmate:attach-source") {
          return {
            sourceLabel: "playing",
            fingerprint: {
              primaryUrl: "https://example.com/playing.mp4",
              pageUrl: "https://example.com/watch",
              elementId: "playing",
              label: "playing",
              visibleIndex: 0,
            },
          };
        }

        return { ok: true };
      },
    );
    const handler = createHostMessageHandler(createHandlerDependencies({
      runtime: runtime as never,
      sendTabMessage,
    }));

    await handler({
      type: "screenmate:start-sharing",
      source: { kind: "active-tab-video" },
    });

    expect(runtime.startRoom).not.toHaveBeenCalled();
    expect(sendTabMessage).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        type: "screenmate:attach-source",
        videoId: "screenmate-video-1",
      }),
      { frameId: 0 },
    );
  });

  it("retries automatic follow from content-ready when an earlier active-tab scan is still in flight", async () => {
    let releaseFirstListVideos!: () => void;
    let markFirstListVideosStarted!: () => void;
    const firstListVideosStarted = new Promise<void>((resolve) => {
      markFirstListVideosStarted = resolve;
    });
    const firstListVideosGate = new Promise<void>((resolve) => {
      releaseFirstListVideos = resolve;
    });
    const runtime = {
      ...createHandlerDependencies().runtime,
      getAttachSession: vi.fn().mockReturnValue({
        roomId: "room_123",
        sessionId: "host_1",
        viewerSessionIds: [],
        iceServers: [],
      }),
      getSnapshot: vi.fn().mockReturnValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "missing",
        roomId: "room_123",
        activeTabId: 42,
        activeFrameId: 0,
      })),
      getSourceFingerprint: vi.fn().mockReturnValue(null),
      markMissing: vi.fn().mockResolvedValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "missing",
        roomId: "room_123",
        activeTabId: 42,
        activeFrameId: 0,
      })),
      setAttachedSource: vi.fn().mockResolvedValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_123",
        sourceLabel: "ready-video",
        activeTabId: 42,
        activeFrameId: 0,
      })),
    };
    let listVideosCallCount = 0;
    const sendTabMessage = vi.fn().mockImplementation(
      async (
        _tabId: number,
        message: TestTabMessage,
      ) => {
        if (message.type === "screenmate:list-videos") {
          listVideosCallCount += 1;
          if (listVideosCallCount === 1) {
            markFirstListVideosStarted();
            await firstListVideosGate;
            return [];
          }

          return [
            {
              id: "screenmate-video-ready",
              label: "ready-video",
              isPlaying: true,
              isVisible: true,
              visibleArea: 640_000,
              fingerprint: {
                primaryUrl: "https://example.com/ready.mp4",
                pageUrl: "https://example.com/watch",
                elementId: "ready",
                label: "ready-video",
                visibleIndex: 0,
              },
            },
          ];
        }

        if (message.type === "screenmate:attach-source") {
          return {
            sourceLabel: "ready-video",
            fingerprint: {
              primaryUrl: "https://example.com/ready.mp4",
              pageUrl: "https://example.com/watch",
              elementId: "ready",
              label: "ready-video",
              visibleIndex: 0,
            },
          };
        }

        return { ok: true };
      },
    );
    const dependencies = createHandlerDependencies({
      followActiveTabVideoStateStorage: {
        getValue: vi.fn().mockResolvedValue({ enabled: true }),
        setValue: vi.fn().mockResolvedValue(undefined),
      },
      queryActiveTabId: vi.fn().mockResolvedValue(42),
      runtime: runtime as never,
      sendTabMessage,
    });
    const handler = createHostMessageHandler(dependencies);

    const staleFollow = followActiveTabVideoOnce(dependencies, 42);
    await firstListVideosStarted;
    const readyFollow = handler({
      type: "screenmate:content-ready",
      frameId: 0,
      tabId: 42,
      videos: [
        {
          id: "screenmate-video-ready",
          label: "ready-video",
          frameId: 0,
          fingerprint: {
            primaryUrl: "https://example.com/ready.mp4",
            pageUrl: "https://example.com/watch",
            elementId: "ready",
            label: "ready-video",
            visibleIndex: 0,
          },
        },
      ],
    });

    releaseFirstListVideos();
    await Promise.all([readyFollow, staleFollow]);

    expect(sendTabMessage).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        type: "screenmate:attach-source",
        videoId: "screenmate-video-ready",
      }),
      { frameId: 0 },
    );
    expect(runtime.setAttachedSource).toHaveBeenCalledWith(
      "ready-video",
      expect.objectContaining({
        frameId: 0,
        tabId: 42,
      }),
    );
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
      type: "screenmate:start-sharing",
      source: {
        kind: "tab-video",
        tabId: 99,
        frameId: 7,
        videoId: "screenmate-video-2",
      },
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
      type: "screenmate:start-sharing",
      source: {
        kind: "tab-video",
        tabId: 42,
        frameId: 0,
        videoId: "screenmate-video-2",
      },
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
      { type: "screenmate:detach-source", hideChat: true },
      { frameId: 7 },
    );
    expect(close).toHaveBeenCalledWith("Room closed.");
    expect(result).toMatchObject({
      roomLifecycle: "closed",
      roomId: "room_123",
    });
  });

  it("best-effort detaches the current source without closing the room", async () => {
    const sendOffscreenMessage = vi.fn().mockResolvedValue({ ok: true });
    const markMissing = vi.fn().mockResolvedValue(createHostRoomSnapshot({
      roomLifecycle: "open",
      sourceState: "missing",
      roomId: "room_123",
      activeTabId: -1,
      activeFrameId: -1,
      message: "No video attached.",
    }));
    const close = vi.fn();
    const handler = createHostMessageHandler(createHandlerDependencies({
      runtime: {
        ...createHandlerDependencies().runtime,
        close,
        getSnapshot: vi.fn().mockReturnValue(createHostRoomSnapshot({
          roomLifecycle: "open",
          sourceState: "attached",
          roomId: "room_123",
          sourceLabel: "Shared browser tab",
          activeTabId: -1,
          activeFrameId: -1,
        })),
        markMissing,
      } as never,
      sendOffscreenMessage,
    }));

    const result = await handler({ type: "screenmate:stop-source" });

    expect(sendOffscreenMessage).toHaveBeenCalledWith({
      type: "screenmate:offscreen-detach-source",
    });
    expect(markMissing).toHaveBeenCalledWith("No video attached.");
    expect(close).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      roomLifecycle: "open",
      sourceState: "missing",
      roomId: "room_123",
    });
  });

  it("best-effort detaches the previous owner before attaching in a different frame", async () => {
    const sendTabMessage = vi.fn().mockImplementation(
      async (
        _tabId: number,
        tabMessage: TestTabMessage,
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
      type: "screenmate:start-sharing",
      source: {
        kind: "tab-video",
        tabId: 42,
        frameId: 7,
        videoId: "screenmate-video-2",
      },
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

  it("allows pending attachment content to send offers before ownership is committed", async () => {
    const sendSignal = vi.fn();
    let handler: ReturnType<typeof createHostMessageHandler>;
    const sendTabMessage = vi.fn().mockImplementation(
      async (
        _tabId: number,
        tabMessage: TestTabMessage,
      ) => {
        if (tabMessage.type === "screenmate:attach-source") {
          await handler({
            type: "screenmate:signal-outbound",
            tabId: 99,
            frameId: 7,
            envelope: {
              roomId: "room_123",
              sessionId: "host_1",
              role: "host",
              messageType: "offer",
              timestamp: 10,
              payload: {
                targetSessionId: "viewer_1",
                sdp: "offer-sdp",
              },
            },
          } as HostMessage);

          return {
            sourceLabel: "https://example.com/next.mp4",
            fingerprint: {
              primaryUrl: "https://example.com/next.mp4",
              elementId: "next",
              label: "https://example.com/next.mp4",
              visibleIndex: 0,
            },
          };
        }

        return { ok: true };
      },
    );

    handler = createHostMessageHandler({
      createRoom: vi.fn(),
      forwardInboundSignal: vi.fn(),
      queryActiveTabId: vi.fn().mockResolvedValue(99),
      queryFrameIds: vi.fn().mockResolvedValue([7]),
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
        sendSignal,
        setAttachedSource: vi.fn().mockResolvedValue(createHostRoomSnapshot({
          roomLifecycle: "open",
          sourceState: "attached",
          roomId: "room_123",
          activeTabId: 99,
          activeFrameId: 7,
        })),
      } as never,
    });

    await handler({
      type: "screenmate:start-sharing",
      source: {
        kind: "tab-video",
        tabId: 99,
        frameId: 7,
        videoId: "screenmate-video-2",
      },
    });

    expect(sendSignal).toHaveBeenCalledWith(expect.objectContaining({
      messageType: "offer",
      payload: expect.objectContaining({
        targetSessionId: "viewer_1",
        sdp: "offer-sdp",
      }),
    }));
  });

  it("routes viewer answers to the pending attachment before ownership is committed", async () => {
    const routingState = createAttachmentRoutingState();
    const sendTabMessage = vi.fn().mockResolvedValue(undefined);
    const forwardInboundSignal = createForwardInboundSignalHandler({
      attachmentRoutingState: routingState,
      runtime: {
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
        shouldRefreshHostIce: vi.fn().mockReturnValue(false),
      } as never,
      sendTabMessage,
    });
    let handler: ReturnType<typeof createHostMessageHandler>;
    const attachSendTabMessage = vi.fn().mockImplementation(
      async (
        tabId: number,
        tabMessage: TestTabMessage,
        options?: { frameId?: number },
      ) => {
        if (tabMessage.type === "screenmate:attach-source") {
          await forwardInboundSignal({
            roomId: "room_123",
            sessionId: "viewer_1",
            role: "viewer",
            messageType: "answer",
            timestamp: 11,
            payload: {
              targetSessionId: "host_1",
              sdp: "answer-sdp",
            },
          });

          return {
            sourceLabel: "https://example.com/next.mp4",
            fingerprint: {
              primaryUrl: "https://example.com/next.mp4",
              elementId: "next",
              label: "https://example.com/next.mp4",
              visibleIndex: 0,
            },
          };
        }

        return sendTabMessage(tabId, tabMessage, options);
      },
    );

    handler = createHostMessageHandler({
      attachmentRoutingState: routingState,
      createRoom: vi.fn(),
      forwardInboundSignal: vi.fn(),
      queryActiveTabId: vi.fn().mockResolvedValue(99),
      queryFrameIds: vi.fn().mockResolvedValue([7]),
      sendTabMessage: attachSendTabMessage,
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
        setAttachedSource: vi.fn().mockResolvedValue(createHostRoomSnapshot({
          roomLifecycle: "open",
          sourceState: "attached",
          roomId: "room_123",
          activeTabId: 99,
          activeFrameId: 7,
        })),
      } as never,
    });

    await handler({
      type: "screenmate:start-sharing",
      source: {
        kind: "tab-video",
        tabId: 99,
        frameId: 7,
        videoId: "screenmate-video-2",
      },
    });

    expect(sendTabMessage).toHaveBeenCalledWith(
      99,
      {
        type: "screenmate:signal-inbound",
        envelope: expect.objectContaining({
          messageType: "answer",
          payload: expect.objectContaining({ sdp: "answer-sdp" }),
        }),
      },
      { frameId: 7 },
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

  it("updates room access through the extension background network context", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        roomId: "room_123",
        requiresPassword: true,
      }),
    });
    const handler = createInternalHostNetworkHandler({
      fetchImpl: fetchImpl as typeof fetch,
    });

    const result = await handler({
      type: "screenmate:set-room-access",
      apiBaseUrl: "http://localhost:8787",
      roomId: "room_123",
      hostToken: "host-token",
      password: "letmein",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:8787/rooms/room_123/access",
      {
        method: "PUT",
        headers: {
          Authorization: "Bearer host-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ password: "letmein" }),
      },
    );
    expect(result).toEqual({
      roomId: "room_123",
      requiresPassword: true,
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

  it("forwards viewer-joined signals to the player local attachment owner", async () => {
    const sendTabMessage = vi.fn();
    const sendPlayerMessage = vi.fn().mockResolvedValue({ ok: true });
    const forwardInboundSignal = createForwardInboundSignalHandler({
      runtime: {
        getSnapshot: vi.fn().mockReturnValue({
          roomLifecycle: "open",
          sourceState: "attached",
          roomId: "room_123",
          viewerCount: 1,
          sourceLabel: "demo.mp4",
          activeTabId: -2,
          activeFrameId: -1,
          recoverByTimestamp: null,
          message: null,
        }),
        shouldRefreshHostIce: vi.fn().mockReturnValue(false),
        refreshHostIce: vi.fn(),
      } as never,
      sendTabMessage,
      sendPlayerMessage,
    });
    const envelope = {
      roomId: "room_123",
      sessionId: "viewer_1",
      role: "viewer" as const,
      messageType: "viewer-joined" as const,
      timestamp: 10,
      payload: {
        viewerSessionId: "viewer_1",
      },
    };

    await forwardInboundSignal(envelope);

    expect(sendTabMessage).not.toHaveBeenCalled();
    expect(sendPlayerMessage).toHaveBeenCalledWith({
      type: "screenmate:player-signal-inbound",
      envelope,
    });
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

describe("followActiveTabVideoOnce", () => {
  it("attaches the best playing visible video from the active tab", async () => {
    const runtime = {
      ...createHandlerDependencies().runtime,
      getSnapshot: vi.fn().mockReturnValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_123",
        activeTabId: 7,
        activeFrameId: 0,
      })),
      getAttachSession: vi.fn().mockReturnValue({
        roomId: "room_123",
        sessionId: "host_1",
        viewerSessionIds: ["viewer_1"],
        iceServers: [],
      }),
      getSourceFingerprint: vi.fn().mockReturnValue({
        tabId: 7,
        frameId: 0,
        primaryUrl: "https://example.com/old.mp4",
        pageUrl: "https://example.com/old",
        elementId: "old",
        label: "old",
        visibleIndex: 0,
      }),
    };
    const sendTabMessage = vi.fn().mockImplementation(
      async (
        _tabId: number,
        message: TestTabMessage,
        options?: { frameId?: number },
      ) => {
        if (message.type === "screenmate:list-videos" && options?.frameId === 0) {
          return [
            {
              id: "large-paused",
              label: "large",
              isPlaying: false,
              isVisible: true,
              visibleArea: 640_000,
              fingerprint: {
                primaryUrl: "https://example.com/large.mp4",
                pageUrl: "https://example.com/watch",
                elementId: "large",
                label: "large",
                visibleIndex: 0,
              },
            },
          ];
        }

        if (message.type === "screenmate:list-videos" && options?.frameId === 5) {
          return [
            {
              id: "small-playing",
              label: "playing",
              isPlaying: true,
              isVisible: true,
              visibleArea: 57_600,
              fingerprint: {
                primaryUrl: "https://example.com/playing.mp4",
                pageUrl: "https://example.com/watch",
                elementId: "playing",
                label: "playing",
                visibleIndex: 0,
              },
            },
          ];
        }

        if (message.type === "screenmate:attach-source") {
          return {
            sourceLabel: "playing",
            fingerprint: {
              primaryUrl: "https://example.com/playing.mp4",
              pageUrl: "https://example.com/watch",
              elementId: "playing",
              label: "playing",
              visibleIndex: 0,
            },
          };
        }

        return { ok: true };
      },
    );
    const dependencies = createHandlerDependencies({
      queryFrameIds: vi.fn().mockResolvedValue([0, 5]),
      runtime: runtime as never,
      sendTabMessage,
    });

    await followActiveTabVideoOnce(dependencies, 7);

    expect(sendTabMessage).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        type: "screenmate:attach-source",
        videoId: "small-playing",
      }),
      { frameId: 5 },
    );
    expect(runtime.setAttachedSource).toHaveBeenCalledWith("playing", {
      primaryUrl: "https://example.com/playing.mp4",
      pageUrl: "https://example.com/watch",
      elementId: "playing",
      label: "playing",
      visibleIndex: 0,
      frameId: 5,
      tabId: 7,
    });
  });

  it("keeps the current source when the active tab has no videos", async () => {
    const runtime = {
      ...createHandlerDependencies().runtime,
      getSnapshot: vi.fn().mockReturnValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_123",
        activeTabId: 42,
        activeFrameId: 0,
      })),
    };
    const sendTabMessage = vi.fn().mockResolvedValue([]);
    const dependencies = createHandlerDependencies({
      runtime: runtime as never,
      sendTabMessage,
    });

    await followActiveTabVideoOnce(dependencies, 84);

    expect(sendTabMessage).not.toHaveBeenCalledWith(
      42,
      { type: "screenmate:detach-source" },
      { frameId: 0 },
    );
    expect(runtime.markMissing).not.toHaveBeenCalled();
  });

  it("keeps the current source when the active tab content script is not reachable", async () => {
    const runtime = {
      ...createHandlerDependencies().runtime,
      getSnapshot: vi.fn().mockReturnValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_123",
        activeTabId: 42,
        activeFrameId: 0,
      })),
    };
    const sendTabMessage = vi.fn().mockRejectedValue(
      new Error("Could not establish connection. Receiving end does not exist."),
    );
    const dependencies = createHandlerDependencies({
      runtime: runtime as never,
      sendTabMessage,
    });

    await followActiveTabVideoOnce(dependencies, 84);

    expect(sendTabMessage).not.toHaveBeenCalledWith(
      42,
      { type: "screenmate:detach-source" },
      { frameId: 0 },
    );
    expect(runtime.markMissing).not.toHaveBeenCalled();
  });

  it("keeps the current source when the active tab is not a scannable web page", async () => {
    const runtime = {
      ...createHandlerDependencies().runtime,
      getSnapshot: vi.fn().mockReturnValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_123",
        activeTabId: 42,
        activeFrameId: 0,
      })),
    };
    const sendTabMessage = vi.fn();
    const dependencies = createHandlerDependencies({
      queryCurrentWindowTabs: vi.fn().mockResolvedValue([
        { id: 84, url: "chrome://extensions/" },
      ]),
      runtime: runtime as never,
      sendTabMessage,
    });

    await followActiveTabVideoOnce(dependencies, 84);

    expect(sendTabMessage).not.toHaveBeenCalledWith(
      84,
      expect.objectContaining({ type: "screenmate:list-videos" }),
      expect.anything(),
    );
    expect(sendTabMessage).not.toHaveBeenCalledWith(
      42,
      { type: "screenmate:detach-source" },
      { frameId: 0 },
    );
    expect(runtime.markMissing).not.toHaveBeenCalled();
  });

  it("does not detach the current source when the active tab is the ScreenMate viewer", async () => {
    const runtime = {
      ...createHandlerDependencies().runtime,
      getSnapshot: vi.fn().mockReturnValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_123",
        activeTabId: 42,
        activeFrameId: 0,
      })),
    };
    const sendTabMessage = vi.fn().mockResolvedValue([
      {
        id: "screenmate-video-1",
        label: "viewer playback",
        isVisible: true,
        visibleArea: 640_000,
      },
    ]);
    const dependencies = createHandlerDependencies({
      queryCurrentWindowTabs: vi.fn().mockResolvedValue([
        { id: 84, url: "http://127.0.0.1:4173/rooms/room_123" },
      ]),
      runtime: runtime as never,
      sendTabMessage,
      viewerBaseUrl: "http://localhost:4173",
    });

    await followActiveTabVideoOnce(dependencies, 84);

    expect(sendTabMessage).not.toHaveBeenCalledWith(
      42,
      { type: "screenmate:detach-source" },
      { frameId: 0 },
    );
    expect(sendTabMessage).not.toHaveBeenCalledWith(
      84,
      expect.objectContaining({ type: "screenmate:attach-source" }),
      expect.anything(),
    );
    expect(runtime.markMissing).not.toHaveBeenCalled();
  });

  it("uses another active window tab as the automatic source when the focused tab is the viewer", async () => {
    const runtime = {
      ...createHandlerDependencies().runtime,
      getAttachSession: vi.fn().mockReturnValue({
        roomId: "room_123",
        sessionId: "host_1",
        viewerSessionIds: ["viewer_1"],
        iceServers: [],
      }),
      getSnapshot: vi.fn().mockReturnValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "missing",
        roomId: "room_123",
        activeTabId: null,
        activeFrameId: null,
      })),
      getSourceFingerprint: vi.fn().mockReturnValue(null),
      setAttachedSource: vi.fn().mockResolvedValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_123",
        sourceLabel: "bilibili",
        activeTabId: 42,
        activeFrameId: 0,
      })),
    };
    const sendTabMessage = vi.fn().mockImplementation(
      async (
        tabId: number,
        message: TestTabMessage,
      ) => {
        if (message.type === "screenmate:list-videos" && tabId === 42) {
          return [
            {
              id: "screenmate-video-1",
              label: "bilibili",
              isPlaying: true,
              isVisible: true,
              visibleArea: 640_000,
              fingerprint: {
                primaryUrl: "blob:https://www.bilibili.com/source",
                pageUrl: "https://www.bilibili.com/video/BV123",
                elementId: "screenmate-video-1",
                label: "bilibili",
                visibleIndex: 0,
              },
            },
          ];
        }

        if (message.type === "screenmate:attach-source") {
          return {
            sourceLabel: "bilibili",
            fingerprint: {
              primaryUrl: "blob:https://www.bilibili.com/source",
              pageUrl: "https://www.bilibili.com/video/BV123",
              elementId: "screenmate-video-1",
              label: "bilibili",
              visibleIndex: 0,
            },
          };
        }

        return [];
      },
    );
    const dependencies = createHandlerDependencies({
      queryActiveTabCandidates: vi.fn().mockResolvedValue([
        {
          id: 84,
          title: "ScreenMate room",
          url: "http://127.0.0.1:4173/rooms/room_123",
          isLastFocused: true,
        },
        {
          id: 42,
          title: "Bilibili",
          url: "https://www.bilibili.com/video/BV123",
        },
      ]),
      queryCurrentWindowTabs: vi.fn().mockResolvedValue([
        { id: 84, url: "http://127.0.0.1:4173/rooms/room_123" },
        { id: 42, url: "https://www.bilibili.com/video/BV123" },
      ]),
      runtime: runtime as never,
      sendTabMessage,
      viewerBaseUrl: "http://localhost:4173",
    });

    await followActiveTabVideoOnce(dependencies, 84);

    expect(sendTabMessage).not.toHaveBeenCalledWith(
      84,
      expect.objectContaining({ type: "screenmate:list-videos" }),
      expect.anything(),
    );
    expect(sendTabMessage).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        type: "screenmate:attach-source",
        videoId: "screenmate-video-1",
      }),
      { frameId: 0 },
    );
    expect(runtime.setAttachedSource).toHaveBeenCalledWith(
      "bilibili",
      expect.objectContaining({
        tabId: 42,
      }),
    );
  });

  it("does not reattach when the best active tab video matches the current source", async () => {
    const fingerprint = {
      tabId: 42,
      frameId: 0,
      primaryUrl: "https://example.com/current.mp4",
      pageUrl: "https://example.com/watch",
      elementId: "current",
      label: "current",
      visibleIndex: 0,
    };
    const runtime = {
      ...createHandlerDependencies().runtime,
      getSnapshot: vi.fn().mockReturnValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_123",
        activeTabId: 42,
        activeFrameId: 0,
      })),
      getSourceFingerprint: vi.fn().mockReturnValue(fingerprint),
    };
    const sendTabMessage = vi.fn().mockResolvedValue([
      {
        id: "current",
        label: "current",
        isPlaying: true,
        isVisible: true,
        visibleArea: 640_000,
        fingerprint,
      },
    ]);
    const dependencies = createHandlerDependencies({
      runtime: runtime as never,
      sendTabMessage,
    });

    await followActiveTabVideoOnce(dependencies, 42);

    expect(sendTabMessage).not.toHaveBeenCalledWith(
      42,
      expect.objectContaining({ type: "screenmate:attach-source" }),
      expect.anything(),
    );
    expect(runtime.setAttachedSource).not.toHaveBeenCalled();
  });

  it("reattaches a matching active-tab video when the current source is missing", async () => {
    const fingerprint = {
      tabId: 42,
      frameId: 0,
      primaryUrl: "https://example.com/current.mp4",
      pageUrl: "https://example.com/watch",
      elementId: "current",
      label: "current",
      visibleIndex: 0,
    };
    const runtime = {
      ...createHandlerDependencies().runtime,
      getSnapshot: vi.fn().mockReturnValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "missing",
        roomId: "room_123",
        activeTabId: 42,
        activeFrameId: 0,
      })),
      getAttachSession: vi.fn().mockReturnValue({
        roomId: "room_123",
        sessionId: "host_1",
        viewerSessionIds: [],
        iceServers: [],
      }),
      getSourceFingerprint: vi.fn().mockReturnValue(fingerprint),
      setAttachedSource: vi.fn().mockResolvedValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_123",
        sourceLabel: "current",
        activeTabId: 42,
        activeFrameId: 0,
      })),
    };
    const sendTabMessage = vi.fn().mockImplementation(
      async (
        _tabId: number,
        message: TestTabMessage,
      ) => {
        if (message.type === "screenmate:list-videos") {
          return [
            {
              id: "current",
              label: "current",
              isPlaying: true,
              isVisible: true,
              visibleArea: 640_000,
              fingerprint,
            },
          ];
        }

        if (message.type === "screenmate:attach-source") {
          return {
            sourceLabel: "current",
            fingerprint,
          };
        }

        return { ok: true };
      },
    );
    const dependencies = createHandlerDependencies({
      runtime: runtime as never,
      sendTabMessage,
    });

    await followActiveTabVideoOnce(dependencies, 42);

    expect(sendTabMessage).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        type: "screenmate:attach-source",
        videoId: "current",
      }),
      { frameId: 0 },
    );
    expect(runtime.setAttachedSource).toHaveBeenCalledWith("current", {
      ...fingerprint,
      frameId: 0,
      tabId: 42,
    });
  });

  it("joins an in-flight automatic follow instead of attaching twice", async () => {
    let releaseListVideos!: () => void;
    const listVideosGate = new Promise<void>((resolve) => {
      releaseListVideos = resolve;
    });
    const runtime = {
      ...createHandlerDependencies().runtime,
      getSnapshot: vi.fn().mockReturnValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_123",
        activeTabId: 42,
        activeFrameId: 0,
      })),
      getAttachSession: vi.fn().mockReturnValue({
        roomId: "room_123",
        sessionId: "host_1",
        viewerSessionIds: ["viewer_1"],
        iceServers: [],
      }),
      getSourceFingerprint: vi.fn().mockReturnValue(null),
    };
    const sendTabMessage = vi.fn().mockImplementation(
      async (
        _tabId: number,
        message: TestTabMessage,
      ) => {
        if (message.type === "screenmate:list-videos") {
          await listVideosGate;
          return [
            {
              id: "screenmate-video-1",
              label: "playing",
              isPlaying: true,
              isVisible: true,
              visibleArea: 640_000,
              fingerprint: {
                primaryUrl: "https://example.com/playing.mp4",
                pageUrl: "https://example.com/watch",
                elementId: "playing",
                label: "playing",
                visibleIndex: 0,
              },
            },
          ];
        }

        if (message.type === "screenmate:attach-source") {
          return {
            sourceLabel: "playing",
            fingerprint: {
              primaryUrl: "https://example.com/playing.mp4",
              pageUrl: "https://example.com/watch",
              elementId: "playing",
              label: "playing",
              visibleIndex: 0,
            },
          };
        }

        return { ok: true };
      },
    );
    const dependencies = createHandlerDependencies({
      runtime: runtime as never,
      sendTabMessage,
    });

    const firstFollow = followActiveTabVideoOnce(dependencies, 42);
    const secondFollow = followActiveTabVideoOnce(dependencies, 42);
    releaseListVideos();
    await Promise.all([firstFollow, secondFollow]);

    expect(
      sendTabMessage.mock.calls.filter(
        ([, message]) => message.type === "screenmate:list-videos",
      ),
    ).toHaveLength(1);
    expect(
      sendTabMessage.mock.calls.filter(
        ([, message]) => message.type === "screenmate:attach-source",
      ),
    ).toHaveLength(1);
  });

  it("starts a new automatic follow when the requested active tab changes", async () => {
    let releaseFirstListVideos!: () => void;
    let markFirstListVideosStarted!: () => void;
    const firstListVideosStarted = new Promise<void>((resolve) => {
      markFirstListVideosStarted = resolve;
    });
    const firstListVideosGate = new Promise<void>((resolve) => {
      releaseFirstListVideos = resolve;
    });
    const runtime = {
      ...createHandlerDependencies().runtime,
      getSnapshot: vi.fn().mockReturnValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_123",
        activeTabId: 42,
        activeFrameId: 0,
      })),
      getAttachSession: vi.fn().mockReturnValue({
        roomId: "room_123",
        sessionId: "host_1",
        viewerSessionIds: [],
        iceServers: [],
      }),
      getSourceFingerprint: vi.fn().mockReturnValue(null),
      markMissing: vi.fn().mockResolvedValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "missing",
        roomId: "room_123",
      })),
      setAttachedSource: vi.fn().mockResolvedValue(createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_123",
        sourceLabel: "next",
        activeTabId: 84,
        activeFrameId: 0,
      })),
    };
    const sendTabMessage = vi.fn().mockImplementation(
      async (
        tabId: number,
        message: TestTabMessage,
      ) => {
        if (message.type === "screenmate:list-videos" && tabId === 42) {
          markFirstListVideosStarted();
          await firstListVideosGate;
          return [
            {
              id: "old-video",
              label: "old",
              isPlaying: true,
              isVisible: true,
              visibleArea: 640_000,
            },
          ];
        }

        if (message.type === "screenmate:list-videos" && tabId === 84) {
          return [
            {
              id: "next-video",
              label: "next",
              isPlaying: true,
              isVisible: true,
              visibleArea: 640_000,
              fingerprint: {
                primaryUrl: "https://example.com/next.mp4",
                pageUrl: "https://example.com/watch",
                elementId: "next",
                label: "next",
                visibleIndex: 0,
              },
            },
          ];
        }

        if (message.type === "screenmate:attach-source") {
          return {
            sourceLabel: "next",
            fingerprint: {
              primaryUrl: "https://example.com/next.mp4",
              pageUrl: "https://example.com/watch",
              elementId: "next",
              label: "next",
              visibleIndex: 0,
            },
          };
        }

        return { ok: true };
      },
    );
    const dependencies = createHandlerDependencies({
      runtime: runtime as never,
      sendTabMessage,
    });

    const staleFollow = followActiveTabVideoOnce(dependencies, 42);
    await firstListVideosStarted;
    const nextFollow = followActiveTabVideoOnce(dependencies, 84);
    releaseFirstListVideos();
    await Promise.all([staleFollow, nextFollow]);

    expect(sendTabMessage).toHaveBeenCalledWith(
      84,
      expect.objectContaining({
        type: "screenmate:attach-source",
        videoId: "next-video",
      }),
      { frameId: 0 },
    );
    expect(sendTabMessage).not.toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        type: "screenmate:attach-source",
        videoId: "old-video",
      }),
      expect.anything(),
    );
    expect(runtime.setAttachedSource).toHaveBeenCalledWith(
      "next",
      expect.objectContaining({
        tabId: 84,
      }),
    );
  });
});
