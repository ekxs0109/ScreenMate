import { describe, expect, it, vi } from "vitest";
import { createHostRoomRuntime } from "../../entrypoints/background/host-room-runtime";

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

function emitSocketMessage(socket: MockHostSocket, payload: unknown) {
  socket.emit("message", {
    data: JSON.stringify(payload),
  } as unknown as Event);
}

function createDeferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, resolve, reject };
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
          viewerRoster: [
            {
              viewerSessionId: "viewer_1",
              displayName: "Mina",
              online: true,
              connectionType: "direct",
              pingMs: 24,
              joinedAt: 1,
              profileUpdatedAt: 2,
              metricsUpdatedAt: 3,
            },
          ],
          chatMessages: [],
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
          viewerRoster: [
            {
              viewerSessionId: "viewer_1",
              displayName: "Mina",
              online: true,
              connectionType: "direct",
              pingMs: 24,
              joinedAt: 1,
              profileUpdatedAt: 2,
              metricsUpdatedAt: 3,
            },
          ],
          chatMessages: [],
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
      viewerRoster: [],
      chatMessages: [],
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
      viewerRoster: [],
      chatMessages: [],
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
      viewerRoster: [],
      chatMessages: [],
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

  it("restores the persisted TURN credential expiry from storage", async () => {
    const storage = {
      get: vi.fn().mockResolvedValue({
        screenmateHostRoomSession: {
          roomId: "room_123",
          hostSessionId: "host_1",
          hostToken: "host-token",
          signalingUrl: "/rooms/room_123/ws",
          iceServers: [],
          turnCredentialExpiresAt: 100_000,
          activeTabId: 42,
          activeFrameId: 0,
          viewerSessionIds: [],
          viewerCount: 0,
          viewerRoster: [],
          chatMessages: [],
          sourceFingerprint: null,
          recoverByTimestamp: null,
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

    expect(runtime.shouldRefreshHostIce()).toBe(false);
  });

  it("refreshes host ICE when TURN credentials are within the refresh skew and persists the update", async () => {
    const storage = {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn(),
      remove: vi.fn(),
    };
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        iceServers: [{ urls: ["turn:refreshed.screenmate.dev"] }],
        turnCredentialExpiresAt: 500_000,
      }),
    });

    const runtime = createHostRoomRuntime({
      storage,
      now: () => 150_000,
      apiBaseUrl: "http://localhost:8787",
      fetchImpl: fetchImpl as typeof fetch,
    });

    await runtime.startRoom({
      roomId: "room_123",
      hostSessionId: "host_1",
      hostToken: "host-token",
      signalingUrl: "/rooms/room_123/ws",
      iceServers: [{ urls: ["turn:stale.screenmate.dev"] }],
      turnCredentialExpiresAt: 150_500,
      activeTabId: 42,
      activeFrameId: 0,
      viewerSessionIds: [],
      viewerCount: 0,
      viewerRoster: [],
      chatMessages: [],
      sourceFingerprint: null,
      recoverByTimestamp: null,
    });

    expect(runtime.shouldRefreshHostIce()).toBe(true);

    const refreshed = await runtime.refreshHostIce();

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:8787/rooms/room_123/host/ice",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer host-token",
        },
      },
    );
    expect(refreshed).toEqual({
      iceServers: [{ urls: ["turn:refreshed.screenmate.dev"] }],
      turnCredentialExpiresAt: 500_000,
    });
    expect(runtime.getAttachSession()).toEqual({
      roomId: "room_123",
      sessionId: "host_1",
      viewerSessionIds: [],
      iceServers: [{ urls: ["turn:refreshed.screenmate.dev"] }],
    });
    expect(runtime.shouldRefreshHostIce()).toBe(false);
    expect(storage.set).toHaveBeenLastCalledWith({
      screenmateHostRoomSession: expect.objectContaining({
        iceServers: [{ urls: ["turn:refreshed.screenmate.dev"] }],
        turnCredentialExpiresAt: 500_000,
      }),
    });
  });

  it("ignores stale ICE refresh results after the room session changes", async () => {
    const storage = {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn(),
      remove: vi.fn(),
    };
    const deferredRefresh = createDeferredPromise<{
      ok: true;
      json: () => Promise<{
        iceServers: RTCIceServer[];
        turnCredentialExpiresAt: number | null;
      }>;
    }>();
    const fetchImpl = vi.fn().mockReturnValue(deferredRefresh.promise);

    const runtime = createHostRoomRuntime({
      storage,
      now: () => 100_000,
      apiBaseUrl: "http://localhost:8787",
      fetchImpl: fetchImpl as typeof fetch,
    });

    await runtime.startRoom({
      roomId: "room_123",
      hostSessionId: "host_1",
      hostToken: "host-token",
      signalingUrl: "/rooms/room_123/ws",
      iceServers: [{ urls: ["turn:stale.screenmate.dev"] }],
      turnCredentialExpiresAt: 100_500,
      activeTabId: 42,
      activeFrameId: 0,
      viewerSessionIds: [],
      viewerCount: 0,
      viewerRoster: [],
      chatMessages: [],
      sourceFingerprint: null,
      recoverByTimestamp: null,
    });

    const refreshPromise = runtime.refreshHostIce();

    await runtime.startRoom({
      roomId: "room_456",
      hostSessionId: "host_2",
      hostToken: "next-host-token",
      signalingUrl: "/rooms/room_456/ws",
      iceServers: [{ urls: ["turn:replacement.screenmate.dev"] }],
      turnCredentialExpiresAt: 900_000,
      activeTabId: 84,
      activeFrameId: 1,
      viewerSessionIds: [],
      viewerCount: 0,
      viewerRoster: [],
      chatMessages: [],
      sourceFingerprint: null,
      recoverByTimestamp: null,
    });

    deferredRefresh.resolve({
      ok: true,
      json: async () => ({
        iceServers: [{ urls: ["turn:refreshed.screenmate.dev"] }],
        turnCredentialExpiresAt: 500_000,
      }),
    });

    await expect(refreshPromise).resolves.toBeNull();
    expect(runtime.getAttachSession()).toEqual({
      roomId: "room_456",
      sessionId: "host_2",
      viewerSessionIds: [],
      iceServers: [{ urls: ["turn:replacement.screenmate.dev"] }],
    });
    expect(storage.set).toHaveBeenLastCalledWith({
      screenmateHostRoomSession: expect.objectContaining({
        roomId: "room_456",
        hostSessionId: "host_2",
        iceServers: [{ urls: ["turn:replacement.screenmate.dev"] }],
      }),
    });
  });

  it("deduplicates concurrent host ICE refreshes for the same session", async () => {
    const storage = {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn(),
      remove: vi.fn(),
    };
    const deferredRefresh = createDeferredPromise<{
      ok: true;
      json: () => Promise<{
        iceServers: RTCIceServer[];
        turnCredentialExpiresAt: number | null;
      }>;
    }>();
    const fetchImpl = vi.fn().mockReturnValue(deferredRefresh.promise);

    const runtime = createHostRoomRuntime({
      storage,
      now: () => 100_000,
      apiBaseUrl: "http://localhost:8787",
      fetchImpl: fetchImpl as typeof fetch,
    });

    await runtime.startRoom({
      roomId: "room_123",
      hostSessionId: "host_1",
      hostToken: "host-token",
      signalingUrl: "/rooms/room_123/ws",
      iceServers: [{ urls: ["turn:stale.screenmate.dev"] }],
      turnCredentialExpiresAt: 100_500,
      activeTabId: 42,
      activeFrameId: 0,
      viewerSessionIds: [],
      viewerCount: 0,
      viewerRoster: [],
      chatMessages: [],
      sourceFingerprint: null,
      recoverByTimestamp: null,
    });

    const firstRefreshPromise = runtime.refreshHostIce();
    const secondRefreshPromise = runtime.refreshHostIce();

    deferredRefresh.resolve({
      ok: true,
      json: async () => ({
        iceServers: [{ urls: ["turn:refreshed.screenmate.dev"] }],
        turnCredentialExpiresAt: 500_000,
      }),
    });

    await expect(firstRefreshPromise).resolves.toEqual({
      iceServers: [{ urls: ["turn:refreshed.screenmate.dev"] }],
      turnCredentialExpiresAt: 500_000,
    });
    await expect(secondRefreshPromise).resolves.toEqual({
      iceServers: [{ urls: ["turn:refreshed.screenmate.dev"] }],
      turnCredentialExpiresAt: 500_000,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("closes the persisted room when signaling closes before opening", async () => {
    const storage = {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn(),
      remove: vi.fn(),
    };
    const sockets: MockHostSocket[] = [];
    const runtime = createHostRoomRuntime({
      storage,
      now: () => 1_000,
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
      viewerRoster: [],
      chatMessages: [],
      sourceFingerprint: null,
      recoverByTimestamp: null,
    });

    const connectPromise = runtime.connectSignaling(vi.fn());
    sockets[0]?.emit("close");

    expect(await connectPromise).toBe(false);
    expect(runtime.getSnapshot()).toMatchObject({
      roomLifecycle: "closed",
      sourceState: "missing",
      roomId: "room_123",
      message: "Room expired or unavailable.",
    });
    expect(storage.remove).toHaveBeenCalledTimes(1);
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
      viewerRoster: [],
      chatMessages: [],
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

  it("stores room activity messages from signaling in the host snapshot", async () => {
    const storage = {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn(),
      remove: vi.fn(),
    };
    const sockets: MockHostSocket[] = [];
    const onSnapshotUpdated = vi.fn();
    const runtime = createHostRoomRuntime({
      storage,
      onSnapshotUpdated,
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
      viewerRoster: [],
      chatMessages: [],
      sourceFingerprint: null,
      recoverByTimestamp: null,
    });

    const connectPromise = runtime.connectSignaling(vi.fn());
    sockets[0]!.readyState = 1;
    sockets[0]?.emit("open");
    await connectPromise;

    emitSocketMessage(sockets[0]!, {
      roomId: "room_123",
      sessionId: "host_1",
      role: "host",
      messageType: "viewer-roster",
      timestamp: 10,
      payload: {
        viewers: [
          {
            viewerSessionId: "viewer_1",
            displayName: "Mina",
            online: true,
            connectionType: "direct",
            pingMs: 24,
            joinedAt: 1,
            profileUpdatedAt: 2,
            metricsUpdatedAt: 3,
          },
          {
            viewerSessionId: "viewer_2",
            displayName: "Noor",
            online: false,
            connectionType: "relay",
            pingMs: null,
            joinedAt: 4,
            profileUpdatedAt: null,
            metricsUpdatedAt: null,
          },
        ],
      },
    });
    emitSocketMessage(sockets[0]!, {
      roomId: "room_123",
      sessionId: "host_1",
      role: "host",
      messageType: "chat-history",
      timestamp: 11,
      payload: {
        messages: [
          {
            messageId: "msg_1",
            senderSessionId: "viewer_1",
            senderRole: "viewer",
            senderName: "Mina",
            text: "hello room",
            sentAt: 11,
          },
        ],
      },
    });
    emitSocketMessage(sockets[0]!, {
      roomId: "room_123",
      sessionId: "host_1",
      role: "host",
      messageType: "chat-message-created",
      timestamp: 12,
      payload: {
        messageId: "msg_2",
        senderSessionId: "host_1",
        senderRole: "host",
        senderName: "Host",
        text: "hello back",
        sentAt: 12,
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(runtime.getSnapshot()).toMatchObject({
      viewerCount: 1,
      viewerRoster: [
        expect.objectContaining({
          viewerSessionId: "viewer_1",
          displayName: "Mina",
          online: true,
        }),
        expect.objectContaining({
          viewerSessionId: "viewer_2",
          displayName: "Noor",
          online: false,
        }),
      ],
      chatMessages: [
        expect.objectContaining({
          messageId: "msg_1",
          senderRole: "viewer",
          text: "hello room",
        }),
        expect.objectContaining({
          messageId: "msg_2",
          senderRole: "host",
          text: "hello back",
        }),
      ],
    });
    expect(storage.set).toHaveBeenLastCalledWith({
      screenmateHostRoomSession: expect.objectContaining({
        viewerCount: 1,
        viewerRoster: expect.arrayContaining([
          expect.objectContaining({ viewerSessionId: "viewer_1" }),
          expect.objectContaining({ viewerSessionId: "viewer_2" }),
        ]),
        chatMessages: expect.arrayContaining([
          expect.objectContaining({ messageId: "msg_1" }),
          expect.objectContaining({ messageId: "msg_2" }),
        ]),
      }),
    });
    expect(onSnapshotUpdated).toHaveBeenCalledTimes(3);
  });

  it("clears viewer count when signaling sends an empty viewer roster", async () => {
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
      viewerRoster: [
        {
          viewerSessionId: "viewer_1",
          displayName: "Mina",
          online: true,
          connectionType: "direct",
          pingMs: 24,
          joinedAt: 1,
          profileUpdatedAt: 2,
          metricsUpdatedAt: 3,
        },
      ],
      chatMessages: [],
      sourceFingerprint: null,
      recoverByTimestamp: null,
    });

    const connectPromise = runtime.connectSignaling(vi.fn());
    sockets[0]!.readyState = 1;
    sockets[0]?.emit("open");
    await connectPromise;

    emitSocketMessage(sockets[0]!, {
      roomId: "room_123",
      sessionId: "host_1",
      role: "host",
      messageType: "viewer-roster",
      timestamp: 10,
      payload: {
        viewers: [],
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(runtime.getSnapshot()).toMatchObject({
      viewerCount: 0,
      viewerRoster: [],
    });
    expect(storage.set).toHaveBeenLastCalledWith({
      screenmateHostRoomSession: expect.objectContaining({
        viewerSessionIds: [],
        viewerCount: 0,
        viewerRoster: [],
      }),
    });
  });

  it("replaces existing chat messages when canonical chat has the same id", async () => {
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
      viewerRoster: [],
      chatMessages: [],
      sourceFingerprint: null,
      recoverByTimestamp: null,
    });

    const connectPromise = runtime.connectSignaling(vi.fn());
    sockets[0]!.readyState = 1;
    sockets[0]?.emit("open");
    await connectPromise;

    emitSocketMessage(sockets[0]!, {
      roomId: "room_123",
      sessionId: "host_1",
      role: "host",
      messageType: "chat-history",
      timestamp: 11,
      payload: {
        messages: [
          {
            messageId: "msg_1",
            senderSessionId: "viewer_1",
            senderRole: "viewer",
            senderName: "Mina",
            text: "old text",
            sentAt: 11,
          },
        ],
      },
    });
    emitSocketMessage(sockets[0]!, {
      roomId: "room_123",
      sessionId: "host_1",
      role: "host",
      messageType: "chat-message-created",
      timestamp: 12,
      payload: {
        messageId: "msg_1",
        senderSessionId: "viewer_1",
        senderRole: "viewer",
        senderName: "Mina",
        text: "new text",
        sentAt: 12,
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(runtime.getSnapshot().chatMessages).toEqual([
      {
        messageId: "msg_1",
        senderSessionId: "viewer_1",
        senderRole: "viewer",
        senderName: "Mina",
        text: "new text",
        sentAt: 12,
      },
    ]);
  });

  it("sends host chat messages over an open signaling socket", async () => {
    const storage = {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn(),
      remove: vi.fn(),
    };
    const sockets: MockHostSocket[] = [];
    const runtime = createHostRoomRuntime({
      storage,
      now: () => 1_710_000_000_000,
      WebSocketImpl: class {
        constructor(_url: string) {
          const socket = new MockHostSocket();
          sockets.push(socket);
          return socket as never;
        }
      } as never,
    });

    expect(runtime.sendHostChatMessage("hello?")).toBe(false);

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
      viewerRoster: [],
      chatMessages: [],
      sourceFingerprint: null,
      recoverByTimestamp: null,
    });

    const connectPromise = runtime.connectSignaling(vi.fn());
    sockets[0]!.readyState = 1;
    sockets[0]?.emit("open");
    await connectPromise;

    expect(runtime.sendHostChatMessage("  hello room  ")).toBe(true);
    expect(runtime.sendHostChatMessage("   ")).toBe(false);

    const sentPayloads = sockets[0]!.send.mock.calls.map(([payload]) =>
      JSON.parse(payload as string),
    );
    expect(sentPayloads).toContainEqual({
      roomId: "room_123",
      sessionId: "host_1",
      role: "host",
      messageType: "chat-message",
      timestamp: 1_710_000_000_000,
      payload: {
        text: "hello room",
      },
    });
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
      viewerRoster: [
        {
          viewerSessionId: "viewer_1",
          displayName: "Mina",
          online: true,
          connectionType: "direct",
          pingMs: 24,
          joinedAt: 1,
          profileUpdatedAt: 2,
          metricsUpdatedAt: 3,
        },
      ],
      chatMessages: [],
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
        viewerRoster: [],
        chatMessages: [],
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

  it("stops sending heartbeats after runtime close tears down signaling", async () => {
    vi.useFakeTimers();
    try {
      const storage = {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn(),
        remove: vi.fn(),
      };
      const sockets: MockHostSocket[] = [];
      const runtime = createHostRoomRuntime({
        storage,
        now: () => 1_710_000_000_000,
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
        viewerRoster: [],
        chatMessages: [],
        sourceFingerprint: null,
        recoverByTimestamp: null,
      });

      const connectPromise = runtime.connectSignaling(vi.fn());
      sockets[0]!.readyState = 1;
      sockets[0]?.emit("open");
      await connectPromise;

      await vi.advanceTimersByTimeAsync(20_000);

      const heartbeatsBeforeClose = sockets[0]!.send.mock.calls
        .map(([payload]) => JSON.parse(payload as string))
        .filter((payload) => payload.messageType === "heartbeat").length;

      await runtime.close("Room closed.");
      await vi.advanceTimersByTimeAsync(40_000);

      const heartbeatsAfterClose = sockets[0]!.send.mock.calls
        .map(([payload]) => JSON.parse(payload as string))
        .filter((payload) => payload.messageType === "heartbeat").length;

      expect(heartbeatsBeforeClose).toBe(1);
      expect(heartbeatsAfterClose).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops heartbeats on socket close and restarts sequence from 1 after reconnect", async () => {
    vi.useFakeTimers();
    try {
      const storage = {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn(),
        remove: vi.fn(),
      };
      const sockets: MockHostSocket[] = [];
      const runtime = createHostRoomRuntime({
        storage,
        now: () => 1_710_000_000_000,
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
        viewerRoster: [],
        chatMessages: [],
        sourceFingerprint: null,
        recoverByTimestamp: null,
      });

      const connectPromise1 = runtime.connectSignaling(vi.fn());
      sockets[0]!.readyState = 1;
      sockets[0]?.emit("open");
      await connectPromise1;

      await vi.advanceTimersByTimeAsync(20_000);

      sockets[0]!.readyState = 3;
      sockets[0]?.emit("close");
      await vi.advanceTimersByTimeAsync(40_000);

      const firstSocketHeartbeats = sockets[0]!.send.mock.calls
        .map(([payload]) => JSON.parse(payload as string))
        .filter((payload) => payload.messageType === "heartbeat");
      expect(firstSocketHeartbeats).toHaveLength(1);
      expect(firstSocketHeartbeats[0]).toEqual(
        expect.objectContaining({
          payload: {
            sequence: 1,
          },
        }),
      );

      const connectPromise2 = runtime.connectSignaling(vi.fn());
      sockets[1]!.readyState = 1;
      sockets[1]?.emit("open");
      await connectPromise2;

      await vi.advanceTimersByTimeAsync(20_000);

      const secondSocketHeartbeats = sockets[1]!.send.mock.calls
        .map(([payload]) => JSON.parse(payload as string))
        .filter((payload) => payload.messageType === "heartbeat");
      expect(secondSocketHeartbeats).toEqual([
        expect.objectContaining({
          roomId: "room_123",
          sessionId: "host_1",
          role: "host",
          messageType: "heartbeat",
          payload: {
            sequence: 1,
          },
        }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
