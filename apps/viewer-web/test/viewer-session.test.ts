import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ViewerSession } from "../src/viewer-session";

// @ts-expect-error initialDisplayName is required for viewer identity wiring.
const viewerSessionOptionsMissingDisplayName: ConstructorParameters<typeof ViewerSession>[0] = {
  apiBaseUrl: "https://api.example",
};
void viewerSessionOptionsMissingDisplayName;

class FakeWebSocket {
  static readonly OPEN = 1;
  readyState = FakeWebSocket.OPEN;
  readonly sentMessages: string[] = [];
  private readonly listeners = {
    open: new Set<() => void>(),
    message: new Set<(event: { data: string }) => void>(),
    close: new Set<(event: { reason?: string }) => void>(),
    error: new Set<() => void>(),
  };

  constructor(private readonly closeBehavior: "emit" | "defer" = "emit") {}

  addEventListener(
    type: "open" | "message" | "close" | "error",
    listener: (() => void) | ((event: { data: string }) => void) | ((event: { reason?: string }) => void),
  ) {
    this.listeners[type].add(listener as never);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = 3;
    if (this.closeBehavior === "defer") {
      return;
    }

    for (const listener of this.listeners.close) {
      listener({ reason: "closed" });
    }
  }

  emitOpen() {
    for (const listener of this.listeners.open) {
      listener();
    }
  }

  emitMessage(data: string) {
    for (const listener of this.listeners.message) {
      listener({ data });
    }
  }

  emitClose() {
    for (const listener of this.listeners.close) {
      listener({ reason: "closed" });
    }
  }

  emitError() {
    for (const listener of this.listeners.error) {
      listener();
    }
  }
}

class FakePeerConnection {
  connectionState = "new";
  iceConnectionState = "new";
  iceGatheringState = "new";
  localDescription: { type: string; sdp: string } | null = null;
  remoteDescription: { type: string; sdp: string } | null = null;
  onicecandidate: ((event: { candidate: RTCIceCandidate | null }) => void) | null =
    null;
  ontrack:
    | ((event: { streams: MediaStream[] }) => void)
    | null = null;
  onconnectionstatechange: (() => void) | null = null;

  async setRemoteDescription(description: { type: string; sdp: string }) {
    this.remoteDescription = description;
  }

  async createAnswer() {
    return { type: "answer", sdp: "viewer-answer" } as RTCSessionDescriptionInit;
  }

  async setLocalDescription(description: { type?: string; sdp?: string | null }) {
    this.localDescription = {
      type: description.type ?? "answer",
      sdp: description.sdp ?? "",
    };
  }

  async addIceCandidate() {
    return;
  }

  async getStats(): Promise<Map<string, Record<string, unknown>>> {
    return new Map([
      [
        "local_1",
        {
          id: "local_1",
          type: "local-candidate",
          candidateType: "relay",
        },
      ],
      [
        "pair_1",
        {
          id: "pair_1",
          type: "candidate-pair",
          selected: true,
          localCandidateId: "local_1",
          currentRoundTripTime: 0.024,
        },
      ],
    ]);
  }

  close() {
    this.connectionState = "closed";
  }

  emitTrack(stream: MediaStream) {
    this.connectionState = "connected";
    this.ontrack?.({ streams: [stream] });
    this.onconnectionstatechange?.();
  }
}

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

describe("ViewerSession", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: createMemoryStorage(),
    });
  });

  afterEach(() => {
    sessionStorage.clear();
    vi.useRealTimers();
  });

  it("joins a room, answers a host offer, and transitions to connected", async () => {
    const socket = new FakeWebSocket();
    const peer = new FakePeerConnection();
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();

      if (url.endsWith("/rooms/room_demo") && !init?.method) {
        return Response.json({
          roomId: "room_demo",
          state: "hosting",
          sourceState: "missing",
          hostConnected: true,
          hostSessionId: null,
          viewerCount: 0,
        });
      }

      if (url.endsWith("/rooms/room_demo/join") && init?.method === "POST") {
        return Response.json({
          roomId: "room_demo",
          sessionId: "viewer_1",
          viewerToken: "viewer-token",
          wsUrl: "ws://signal.example/rooms/room_demo/ws",
          iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }],
        });
      }

      throw new Error(`unexpected request: ${url}`);
    });
    const session = new ViewerSession({
      apiBaseUrl: "https://api.example",
      fetchFn,
      createWebSocket: () => socket as never,
      createPeerConnection: () => peer as never,
      initialDisplayName: "Mina",
      now: () => 42,
      metricsIntervalMs: 60_000,
    });

    await session.join("room_demo");
    socket.emitOpen();
    socket.emitMessage(
      JSON.stringify({
        roomId: "room_demo",
        sessionId: "host_1",
        role: "host",
        messageType: "offer",
        timestamp: 10,
        payload: { targetSessionId: "viewer_1", sdp: "host-offer" },
      }),
    );
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(peer.remoteDescription).toEqual({
      type: "offer",
      sdp: "host-offer",
    });
    expect(peer.localDescription).toEqual({
      type: "answer",
      sdp: "viewer-answer",
    });
    expect(socket.sentMessages.map((message) => JSON.parse(message))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          roomId: "room_demo",
          sessionId: "viewer_1",
          role: "viewer",
          messageType: "answer",
          payload: {
            targetSessionId: "host_1",
            sdp: "viewer-answer",
          },
        }),
      ]),
    );

    peer.emitTrack({ id: "stream_demo" } as never);

    expect(session.getSnapshot()).toMatchObject({
      status: "connected",
      roomId: "room_demo",
      sessionId: "viewer_1",
      hostSessionId: "host_1",
    });
  });

  it("sends the viewer password when joining a protected room", async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();

      if (url.endsWith("/rooms/room_demo") && !init?.method) {
        return Response.json({
          roomId: "room_demo",
          state: "hosting",
          sourceState: "missing",
          hostConnected: true,
          hostSessionId: null,
          viewerCount: 0,
          requiresPassword: true,
        });
      }

      if (url.endsWith("/rooms/room_demo/join") && init?.method === "POST") {
        expect(init.headers).toMatchObject({
          "content-type": "application/json",
        });
        expect(init.body).toBe(JSON.stringify({ password: "letmein" }));
        return Response.json({
          roomId: "room_demo",
          sessionId: "viewer_1",
          viewerToken: "viewer-token",
          wsUrl: "ws://signal.example/rooms/room_demo/ws",
          iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }],
        });
      }

      throw new Error(`unexpected request: ${url}`);
    });
    const session = new ViewerSession({
      apiBaseUrl: "https://api.example",
      fetchFn,
      createWebSocket: () => new FakeWebSocket() as never,
      createPeerConnection: () => new FakePeerConnection() as never,
      initialDisplayName: "Mina",
      metricsIntervalMs: 60_000,
    });

    await session.join("room_demo", "letmein");

    expect(fetchFn).toHaveBeenCalledWith(
      new URL("https://api.example/rooms/room_demo/join"),
      expect.objectContaining({
        body: JSON.stringify({ password: "letmein" }),
      }),
    );
  });

  it("reuses a stored viewer token and display name when rejoining the same room", async () => {
    sessionStorage.setItem(
      "screenmate.viewerSession.room_demo",
      JSON.stringify({
        displayName: "Stored Mina",
        sessionId: "viewer_existing",
        viewerToken: "previous-token",
      }),
    );
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();

      if (url.endsWith("/rooms/room_demo") && !init?.method) {
        return Response.json({
          roomId: "room_demo",
          state: "hosting",
          sourceState: "missing",
          hostConnected: true,
          hostSessionId: "host_1",
          viewerCount: 0,
        });
      }

      if (url.endsWith("/rooms/room_demo/join") && init?.method === "POST") {
        expect(init.body).toBe(
          JSON.stringify({
            password: "",
            previousViewerToken: "previous-token",
          }),
        );

        return Response.json({
          roomId: "room_demo",
          sessionId: "viewer_existing",
          viewerToken: "next-token",
          wsUrl: "ws://signal.example/rooms/room_demo/ws",
          iceServers: [],
        });
      }

      throw new Error(`unexpected request: ${url}`);
    });
    const session = new ViewerSession({
      apiBaseUrl: "https://api.example",
      fetchFn,
      createWebSocket: () => new FakeWebSocket() as never,
      createPeerConnection: () => new FakePeerConnection() as never,
      initialDisplayName: "Random Name",
      metricsIntervalMs: 60_000,
    });

    await session.join("room_demo");

    expect(session.getSnapshot()).toMatchObject({
      displayName: "Stored Mina",
      sessionId: "viewer_existing",
    });
    expect(
      JSON.parse(
        sessionStorage.getItem("screenmate.viewerSession.room_demo") ?? "{}",
      ),
    ).toMatchObject({
      displayName: "Stored Mina",
      sessionId: "viewer_existing",
      viewerToken: "next-token",
    });
  });

  it("surfaces password-required errors without forgetting the room id", async () => {
    const session = new ViewerSession({
      apiBaseUrl: "https://api.example",
      fetchFn: async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();

        if (url.endsWith("/rooms/room_demo") && !init?.method) {
          return Response.json({
            roomId: "room_demo",
            state: "hosting",
            sourceState: "missing",
            hostConnected: true,
            hostSessionId: null,
            viewerCount: 0,
            requiresPassword: true,
          });
        }

        if (url.endsWith("/rooms/room_demo/join") && init?.method === "POST") {
          return Response.json({ error: "ROOM_PASSWORD_REQUIRED" }, { status: 403 });
        }

        throw new Error(`unexpected request: ${url}`);
      },
      createWebSocket: () => new FakeWebSocket() as never,
      createPeerConnection: () => new FakePeerConnection() as never,
      initialDisplayName: "Mina",
      metricsIntervalMs: 60_000,
    });

    await session.join("room_demo");

    expect(session.getSnapshot()).toMatchObject({
      roomId: "room_demo",
      status: "error",
      errorCode: "ROOM_PASSWORD_REQUIRED",
    });
  });

  it("sends viewer-profile when the signaling socket opens", async () => {
    const socket = new FakeWebSocket();
    const peer = new FakePeerConnection();
    const session = new ViewerSession({
      apiBaseUrl: "https://api.example",
      fetchFn: createJoinFetch(),
      createWebSocket: () => socket as never,
      createPeerConnection: () => peer as never,
      initialDisplayName: "Mina",
      metricsIntervalMs: 60_000,
    });

    await session.join("room_demo");
    socket.emitOpen();

    expect(socket.sentMessages.map((message) => JSON.parse(message))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          messageType: "viewer-profile",
          payload: {
            viewerSessionId: "viewer_1",
            displayName: "Mina",
          },
        }),
      ]),
    );
  });

  it("uses pre-join display name updates when sending viewer-profile", async () => {
    const socket = new FakeWebSocket();
    const peer = new FakePeerConnection();
    const session = new ViewerSession({
      apiBaseUrl: "https://api.example",
      fetchFn: createJoinFetch(),
      createWebSocket: () => socket as never,
      createPeerConnection: () => peer as never,
      initialDisplayName: "Mina",
      metricsIntervalMs: 60_000,
    });

    session.updateDisplayName("Noa");
    await session.join("room_demo");
    socket.emitOpen();

    expect(socket.sentMessages.map((message) => JSON.parse(message))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          messageType: "viewer-profile",
          payload: {
            viewerSessionId: "viewer_1",
            displayName: "Noa",
          },
        }),
      ]),
    );
  });

  it("redacts token-bearing signaling URLs in session logs", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const socket = new FakeWebSocket();
    const peer = new FakePeerConnection();
    const session = new ViewerSession({
      apiBaseUrl: "https://api.example",
      fetchFn: createJoinFetch({
        wsUrl: "ws://signal.example/rooms/room_demo/ws?token=server-secret",
      }),
      createWebSocket: () => socket as never,
      createPeerConnection: () => peer as never,
      initialDisplayName: "Mina",
      metricsIntervalMs: 60_000,
    });

    await session.join("room_demo");

    const logs = consoleLog.mock.calls
      .map((call) => JSON.stringify(call))
      .join("\n");
    consoleLog.mockRestore();

    expect(logs).not.toContain("server-secret");
    expect(logs).toContain("token=%5Bredacted%5D");
  });

  it("stores roster, chat history, and created chat messages in the snapshot", async () => {
    const socket = new FakeWebSocket();
    const peer = new FakePeerConnection();
    const session = new ViewerSession({
      apiBaseUrl: "https://api.example",
      fetchFn: createJoinFetch(),
      createWebSocket: () => socket as never,
      createPeerConnection: () => peer as never,
      initialDisplayName: "Mina",
      metricsIntervalMs: 60_000,
    });

    await session.join("room_demo");
    socket.emitOpen();
    socket.emitMessage(
      JSON.stringify({
        roomId: "room_demo",
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
              connectionType: "relay",
              pingMs: 24,
              joinedAt: 1,
              profileUpdatedAt: 2,
              metricsUpdatedAt: 3,
            },
          ],
        },
      }),
    );
    socket.emitMessage(
      JSON.stringify({
        roomId: "room_demo",
        sessionId: "host_1",
        role: "host",
        messageType: "chat-history",
        timestamp: 11,
        payload: {
          messages: [
            {
              messageId: "msg_1",
              senderSessionId: "host_1",
              senderRole: "host",
              senderName: "Host",
              text: "Welcome",
              sentAt: 11,
            },
          ],
        },
      }),
    );
    socket.emitMessage(
      JSON.stringify({
        roomId: "room_demo",
        sessionId: "host_1",
        role: "host",
        messageType: "chat-message-created",
        timestamp: 12,
        payload: {
          messageId: "msg_2",
          senderSessionId: "viewer_1",
          senderRole: "viewer",
          senderName: "Mina",
          text: "Hi",
          sentAt: 12,
        },
      }),
    );

    expect(session.getSnapshot()).toMatchObject({
      viewerRoster: [
        expect.objectContaining({
          viewerSessionId: "viewer_1",
          displayName: "Mina",
          connectionType: "relay",
          pingMs: 24,
        }),
      ],
      chatMessages: [
        expect.objectContaining({ text: "Welcome" }),
        expect.objectContaining({ text: "Hi" }),
      ],
    });
  });

  it("sends display name updates and chat messages", async () => {
    const socket = new FakeWebSocket();
    const peer = new FakePeerConnection();
    const session = new ViewerSession({
      apiBaseUrl: "https://api.example",
      fetchFn: createJoinFetch(),
      createWebSocket: () => socket as never,
      createPeerConnection: () => peer as never,
      initialDisplayName: "Mina",
      metricsIntervalMs: 60_000,
    });

    await session.join("room_demo");
    socket.emitOpen();
    session.updateDisplayName("Noa");
    const sent = session.sendChatMessage("hello host");

    expect(sent).toBe(true);
    expect(socket.sentMessages.map((message) => JSON.parse(message))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          messageType: "viewer-profile",
          payload: {
            viewerSessionId: "viewer_1",
            displayName: "Noa",
          },
        }),
        expect.objectContaining({
          messageType: "chat-message",
          payload: {
            text: "hello host",
          },
        }),
      ]),
    );
  });

  it("keeps the session alive when metrics collection fails and clears the timer on teardown", async () => {
    vi.useFakeTimers();
    const socket = new FakeWebSocket();
    const peer = new FakePeerConnection();
    peer.getStats = async () => {
      throw new Error("stats unavailable");
    };
    const session = new ViewerSession({
      apiBaseUrl: "https://api.example",
      fetchFn: createJoinFetch(),
      createWebSocket: () => socket as never,
      createPeerConnection: () => peer as never,
      initialDisplayName: "Mina",
      metricsIntervalMs: 100,
    });

    await session.join("room_demo");
    socket.emitOpen();
    await vi.runOnlyPendingTimersAsync();

    expect(session.getSnapshot()).toMatchObject({
      status: "waiting",
      errorCode: null,
      endedReasonCode: null,
    });

    const sentBeforeDestroy = socket.sentMessages.length;
    session.destroy();
    await vi.advanceTimersByTimeAsync(500);

    expect(socket.sentMessages).toHaveLength(sentBeforeDestroy);
  });

  it("stores the negotiated viewer video codec from peer stats", async () => {
    const socket = new FakeWebSocket();
    const peer = new FakePeerConnection();
    peer.getStats = async () =>
      new Map([
        [
          "codec_1",
          {
            id: "codec_1",
            type: "codec",
            mimeType: "video/AV1",
          },
        ],
        [
          "inbound_1",
          {
            id: "inbound_1",
            type: "inbound-rtp",
            kind: "video",
            codecId: "codec_1",
          },
        ],
        [
          "local_1",
          {
            id: "local_1",
            type: "local-candidate",
            candidateType: "host",
          },
        ],
        [
          "pair_1",
          {
            id: "pair_1",
            type: "candidate-pair",
            selected: true,
            localCandidateId: "local_1",
            currentRoundTripTime: 0.012,
          },
        ],
      ]);
    const session = new ViewerSession({
      apiBaseUrl: "https://api.example",
      fetchFn: createJoinFetch(),
      createWebSocket: () => socket as never,
      createPeerConnection: () => peer as never,
      initialDisplayName: "Mina",
      metricsIntervalMs: 60_000,
    });

    await session.join("room_demo");
    socket.emitOpen();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(session.getSnapshot()).toMatchObject({
      localConnectionType: "direct",
      localPingMs: 12,
      localVideoCodec: "AV1",
    });
  });

  it("stops metrics sampling when the signaling socket closes", async () => {
    vi.useFakeTimers();
    const socket = new FakeWebSocket();
    const peer = new FakePeerConnection();
    const getStats = vi.spyOn(peer, "getStats");
    const session = new ViewerSession({
      apiBaseUrl: "https://api.example",
      fetchFn: createJoinFetch(),
      createWebSocket: () => socket as never,
      createPeerConnection: () => peer as never,
      initialDisplayName: "Mina",
      metricsIntervalMs: 100,
    });

    await session.join("room_demo");
    socket.emitOpen();
    await Promise.resolve();
    expect(getStats).toHaveBeenCalledTimes(1);

    socket.emitClose();
    await vi.advanceTimersByTimeAsync(500);

    expect(getStats).toHaveBeenCalledTimes(1);
  });

  it("stops metrics sampling when the signaling socket errors", async () => {
    vi.useFakeTimers();
    const socket = new FakeWebSocket();
    const peer = new FakePeerConnection();
    const getStats = vi.spyOn(peer, "getStats");
    const session = new ViewerSession({
      apiBaseUrl: "https://api.example",
      fetchFn: createJoinFetch(),
      createWebSocket: () => socket as never,
      createPeerConnection: () => peer as never,
      initialDisplayName: "Mina",
      metricsIntervalMs: 100,
    });

    await session.join("room_demo");
    socket.emitOpen();
    await Promise.resolve();
    expect(getStats).toHaveBeenCalledTimes(1);

    socket.emitError();
    await vi.advanceTimersByTimeAsync(500);

    expect(getStats).toHaveBeenCalledTimes(1);
  });

  it("preserves updated display name through destroy and rejoin", async () => {
    const firstSocket = new FakeWebSocket();
    const secondSocket = new FakeWebSocket();
    const sockets = [firstSocket, secondSocket];
    const session = new ViewerSession({
      apiBaseUrl: "https://api.example",
      fetchFn: createJoinFetch(),
      createWebSocket: () => sockets.shift() as never,
      createPeerConnection: () => new FakePeerConnection() as never,
      initialDisplayName: "Mina",
      metricsIntervalMs: 60_000,
    });

    await session.join("room_demo");
    firstSocket.emitOpen();
    session.updateDisplayName("Noa");
    session.destroy();

    await session.join("room_demo");
    secondSocket.emitOpen();

    expect(secondSocket.sentMessages.map((message) => JSON.parse(message))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          messageType: "viewer-profile",
          payload: {
            viewerSessionId: "viewer_1",
            displayName: "Noa",
          },
        }),
      ]),
    );
  });

  it("ignores deferred close from a destroyed socket", async () => {
    const socket = new FakeWebSocket("defer");
    const session = new ViewerSession({
      apiBaseUrl: "https://api.example",
      fetchFn: createJoinFetch(),
      createWebSocket: () => socket as never,
      createPeerConnection: () => new FakePeerConnection() as never,
      initialDisplayName: "Mina",
      metricsIntervalMs: 60_000,
    });

    await session.join("room_demo");
    socket.emitOpen();
    session.updateDisplayName("Noa");
    session.destroy();

    expect(session.getSnapshot()).toMatchObject({
      status: "idle",
      displayName: "Noa",
      endedReasonCode: null,
      errorCode: null,
    });

    socket.emitClose();

    expect(session.getSnapshot()).toMatchObject({
      status: "idle",
      displayName: "Noa",
      endedReasonCode: null,
      errorCode: null,
    });
  });

  it("ignores stale socket callbacks after rejoining with a new socket", async () => {
    vi.useFakeTimers();
    const oldSocket = new FakeWebSocket("defer");
    const newSocket = new FakeWebSocket();
    const sockets = [oldSocket, newSocket];
    const oldPeer = new FakePeerConnection();
    const newPeer = new FakePeerConnection();
    const newGetStats = vi.spyOn(newPeer, "getStats");
    const peers = [oldPeer, newPeer];
    const session = new ViewerSession({
      apiBaseUrl: "https://api.example",
      fetchFn: createJoinFetch(),
      createWebSocket: () => sockets.shift() as never,
      createPeerConnection: () => peers.shift() as never,
      initialDisplayName: "Mina",
      metricsIntervalMs: 100,
    });

    await session.join("room_demo");
    oldSocket.emitOpen();
    session.destroy();
    await session.join("room_demo");
    newSocket.emitOpen();
    await Promise.resolve();

    expect(newGetStats).toHaveBeenCalledTimes(1);

    oldSocket.emitClose();
    oldSocket.emitError();
    oldSocket.emitOpen();
    await vi.advanceTimersByTimeAsync(250);

    expect(session.getSnapshot()).toMatchObject({
      status: "waiting",
      errorCode: null,
      endedReasonCode: null,
    });
    expect(newGetStats.mock.calls.length).toBeGreaterThan(1);
  });

  it("ignores a pending join after destroy", async () => {
    const roomState = createDeferred<Response>();
    const socket = new FakeWebSocket();
    const createWebSocket = vi.fn(() => socket as never);
    const session = new ViewerSession({
      apiBaseUrl: "https://api.example",
      fetchFn: async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();

        if (url.endsWith("/rooms/room_demo") && !init?.method) {
          return roomState.promise;
        }

        if (url.endsWith("/rooms/room_demo/join") && init?.method === "POST") {
          return Response.json({
            roomId: "room_demo",
            sessionId: "viewer_1",
            viewerToken: "viewer-token",
            wsUrl: "ws://signal.example/rooms/room_demo/ws",
            iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }],
          });
        }

        throw new Error(`unexpected request: ${url}`);
      },
      createWebSocket,
      createPeerConnection: () => new FakePeerConnection() as never,
      initialDisplayName: "Mina",
      metricsIntervalMs: 60_000,
    });

    const joinPromise = session.join("room_demo");
    await Promise.resolve();
    session.updateDisplayName("Noa");
    session.destroy();

    roomState.resolve(
      Response.json({
        roomId: "room_demo",
        state: "hosting",
        sourceState: "missing",
        hostConnected: true,
        hostSessionId: null,
        viewerCount: 0,
      }),
    );
    await joinPromise;

    expect(session.getSnapshot()).toMatchObject({
      status: "idle",
      displayName: "Noa",
      roomId: null,
      sessionId: null,
    });
    expect(createWebSocket).not.toHaveBeenCalled();
  });

  it("keeps the newest join when an older pending join resolves later", async () => {
    const roomAState = createDeferred<Response>();
    const roomAJoin = createDeferred<Response>();
    const sockets: FakeWebSocket[] = [];
    const session = new ViewerSession({
      apiBaseUrl: "https://api.example",
      fetchFn: async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();

        if (url.endsWith("/rooms/room_a") && !init?.method) {
          return roomAState.promise;
        }

        if (url.endsWith("/rooms/room_a/join") && init?.method === "POST") {
          return roomAJoin.promise;
        }

        if (url.endsWith("/rooms/room_b") && !init?.method) {
          return Response.json({
            roomId: "room_b",
            state: "hosting",
            sourceState: "missing",
            hostConnected: true,
            hostSessionId: null,
            viewerCount: 0,
          });
        }

        if (url.endsWith("/rooms/room_b/join") && init?.method === "POST") {
          return Response.json({
            roomId: "room_b",
            sessionId: "viewer_b",
            viewerToken: "viewer-token-b",
            wsUrl: "ws://signal.example/rooms/room_b/ws",
            iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }],
          });
        }

        throw new Error(`unexpected request: ${url}`);
      },
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket as never;
      },
      createPeerConnection: () => new FakePeerConnection() as never,
      initialDisplayName: "Mina",
      metricsIntervalMs: 60_000,
    });

    const firstJoin = session.join("room_a");
    await Promise.resolve();
    const secondJoin = session.join("room_b");
    await secondJoin;
    sockets[0]?.emitOpen();

    roomAState.resolve(
      Response.json({
        roomId: "room_a",
        state: "hosting",
        sourceState: "missing",
        hostConnected: true,
        hostSessionId: null,
        viewerCount: 0,
      }),
    );
    roomAJoin.resolve(
      Response.json({
        roomId: "room_a",
        sessionId: "viewer_a",
        viewerToken: "viewer-token-a",
        wsUrl: "ws://signal.example/rooms/room_a/ws",
        iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }],
      }),
    );
    await firstJoin;

    expect(session.getSnapshot()).toMatchObject({
      status: "waiting",
      roomId: "room_b",
      sessionId: "viewer_b",
    });
    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.sentMessages.map((message) => JSON.parse(message))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          roomId: "room_b",
          sessionId: "viewer_b",
          messageType: "viewer-profile",
        }),
      ]),
    );
  });

  it("does not send stale peer answers through a new socket after rejoin", async () => {
    const oldSocket = new FakeWebSocket("defer");
    const newSocket = new FakeWebSocket();
    const sockets = [oldSocket, newSocket];
    const initialOldPeer = new FakePeerConnection();
    const answeringOldPeer = new FakePeerConnection();
    const newPeer = new FakePeerConnection();
    const peers = [initialOldPeer, answeringOldPeer, newPeer];
    const answer = createDeferred<RTCSessionDescriptionInit>();
    answeringOldPeer.createAnswer = () => answer.promise;
    const session = new ViewerSession({
      apiBaseUrl: "https://api.example",
      fetchFn: createJoinFetch(),
      createWebSocket: () => sockets.shift() as never,
      createPeerConnection: () => peers.shift() as never,
      initialDisplayName: "Mina",
      metricsIntervalMs: 60_000,
    });

    await session.join("room_demo");
    oldSocket.emitOpen();
    oldSocket.emitMessage(
      JSON.stringify({
        roomId: "room_demo",
        sessionId: "host_1",
        role: "host",
        messageType: "offer",
        timestamp: 10,
        payload: { targetSessionId: "viewer_1", sdp: "host-offer" },
      }),
    );
    await Promise.resolve();

    session.destroy();
    await session.join("room_demo");
    newSocket.emitOpen();
    const answerMessagesBeforeAnswer = newSocket.sentMessages
      .map((message) => JSON.parse(message))
      .filter((message) => message.messageType === "answer").length;

    answer.resolve({ type: "answer", sdp: "old-answer" });
    await Promise.resolve();
    await Promise.resolve();

    const parsedNewSocketMessages = newSocket.sentMessages.map((message) =>
      JSON.parse(message),
    );
    expect(
      parsedNewSocketMessages.filter((message) => message.messageType === "answer"),
    ).toHaveLength(answerMessagesBeforeAnswer);
    expect(parsedNewSocketMessages).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          messageType: "answer",
          payload: expect.objectContaining({
            sdp: "old-answer",
          }),
        }),
      ]),
    );
  });

  it("caps overlong display names before sending viewer-profile", async () => {
    const socket = new FakeWebSocket();
    const session = new ViewerSession({
      apiBaseUrl: "https://api.example",
      fetchFn: createJoinFetch(),
      createWebSocket: () => socket as never,
      createPeerConnection: () => new FakePeerConnection() as never,
      initialDisplayName: "Mina",
      metricsIntervalMs: 60_000,
    });

    await session.join("room_demo");
    socket.emitOpen();

    expect(() => session.updateDisplayName("N".repeat(120))).not.toThrow();

    expect(session.getSnapshot().displayName).toHaveLength(80);
    expect(socket.sentMessages.map((message) => JSON.parse(message))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          messageType: "viewer-profile",
          payload: expect.objectContaining({
            displayName: "N".repeat(80),
          }),
        }),
      ]),
    );
  });

  it("caps overlong chat messages before sending", async () => {
    const socket = new FakeWebSocket();
    const session = new ViewerSession({
      apiBaseUrl: "https://api.example",
      fetchFn: createJoinFetch(),
      createWebSocket: () => socket as never,
      createPeerConnection: () => new FakePeerConnection() as never,
      initialDisplayName: "Mina",
      metricsIntervalMs: 60_000,
    });

    await session.join("room_demo");
    socket.emitOpen();

    expect(() => session.sendChatMessage("h".repeat(700))).not.toThrow();
    expect(session.sendChatMessage("h".repeat(700))).toBe(true);

    expect(socket.sentMessages.map((message) => JSON.parse(message))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          messageType: "chat-message",
          payload: {
            text: "h".repeat(500),
          },
        }),
      ]),
    );
  });

  it("moves to an ended state when the room closes", async () => {
    const socket = new FakeWebSocket();
    const peer = new FakePeerConnection();
    const session = new ViewerSession({
      apiBaseUrl: "https://api.example",
      fetchFn: async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();

        if (url.endsWith("/rooms/room_demo") && !init?.method) {
          return Response.json({
            roomId: "room_demo",
            state: "hosting",
            sourceState: "missing",
            hostConnected: true,
            hostSessionId: null,
            viewerCount: 0,
          });
        }

        return Response.json({
          roomId: "room_demo",
          sessionId: "viewer_1",
          viewerToken: "viewer-token",
          wsUrl: "ws://signal.example/rooms/room_demo/ws",
          iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }],
        });
      },
      createWebSocket: () => socket as never,
      createPeerConnection: () => peer as never,
      initialDisplayName: "Mina",
      metricsIntervalMs: 60_000,
    });

    await session.join("room_demo");
    socket.emitOpen();
    socket.emitMessage(
      JSON.stringify({
        roomId: "room_demo",
        sessionId: "host_1",
        role: "host",
        messageType: "room-closed",
        timestamp: 10,
        payload: { reason: "host-left" },
      }),
    );

    expect(session.getSnapshot()).toMatchObject({
      status: "ended",
      endedReasonCode: "HOST_ENDED_ROOM",
    });
  });

  it("stays joined while the host source is recovering and reconnects on a new offer", async () => {
    const socket = new FakeWebSocket();
    const firstPeer = new FakePeerConnection();
    const secondPeer = new FakePeerConnection();
    const peers = [firstPeer, secondPeer];
    const session = new ViewerSession({
      apiBaseUrl: "https://api.example",
      fetchFn: async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();

        if (url.endsWith("/rooms/room_demo") && !init?.method) {
          return Response.json({
            roomId: "room_demo",
            state: "streaming",
            sourceState: "attached",
            hostConnected: true,
            hostSessionId: "host_1",
            viewerCount: 1,
          });
        }

        return Response.json({
          roomId: "room_demo",
          sessionId: "viewer_1",
          viewerToken: "viewer-token",
          wsUrl: "ws://signal.example/rooms/room_demo/ws",
          iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }],
        });
      },
      createWebSocket: () => socket as never,
      createPeerConnection: () => peers.shift() as never,
      initialDisplayName: "Mina",
      metricsIntervalMs: 60_000,
    });

    await session.join("room_demo");
    socket.emitOpen();
    socket.emitMessage(
      JSON.stringify({
        roomId: "room_demo",
        sessionId: "host_1",
        role: "host",
        messageType: "room-state",
        timestamp: 10,
        payload: {
          state: "degraded",
          sourceState: "recovering",
          viewerCount: 1,
        },
      }),
    );

    expect(session.getSnapshot()).toMatchObject({
      roomState: "degraded",
      sourceState: "recovering",
      status: "waiting",
      endedReasonCode: null,
    });

    socket.emitMessage(
      JSON.stringify({
        roomId: "room_demo",
        sessionId: "host_2",
        role: "host",
        messageType: "offer",
        timestamp: 11,
        payload: {
          targetSessionId: "viewer_1",
          sdp: "reattach-offer",
        },
      }),
    );
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(secondPeer.remoteDescription).toEqual({
      type: "offer",
      sdp: "reattach-offer",
    });
  });

  it("stays joined when the room is degraded and the host source is missing", async () => {
    const socket = new FakeWebSocket();
    const peer = new FakePeerConnection();
    const session = new ViewerSession({
      apiBaseUrl: "https://api.example",
      fetchFn: async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();

        if (url.endsWith("/rooms/room_demo") && !init?.method) {
          return Response.json({
            roomId: "room_demo",
            state: "streaming",
            sourceState: "attached",
            hostConnected: true,
            hostSessionId: "host_1",
            viewerCount: 1,
          });
        }

        return Response.json({
          roomId: "room_demo",
          sessionId: "viewer_1",
          viewerToken: "viewer-token",
          wsUrl: "ws://signal.example/rooms/room_demo/ws",
          iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }],
        });
      },
      createWebSocket: () => socket as never,
      createPeerConnection: () => peer as never,
      initialDisplayName: "Mina",
      metricsIntervalMs: 60_000,
    });

    await session.join("room_demo");
    socket.emitOpen();
    socket.emitMessage(
      JSON.stringify({
        roomId: "room_demo",
        sessionId: "host_1",
        role: "host",
        messageType: "offer",
        timestamp: 10,
        payload: {
          targetSessionId: "viewer_1",
          sdp: "host-offer",
        },
      }),
    );
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    peer.emitTrack({ id: "stream_demo" } as never);

    expect(session.getSnapshot()).toMatchObject({
      status: "connected",
      roomState: "streaming",
      sourceState: "attached",
    });

    socket.emitMessage(
      JSON.stringify({
        roomId: "room_demo",
        sessionId: "host_1",
        role: "host",
        messageType: "room-state",
        timestamp: 11,
        payload: {
          state: "degraded",
          sourceState: "missing",
          viewerCount: 1,
        },
      }),
    );

    expect(session.getSnapshot()).toMatchObject({
      status: "waiting",
      roomState: "degraded",
      sourceState: "missing",
      endedReasonCode: null,
    });
  });

  it("does not emit an ended state when replacing a peer during reoffer recovery", async () => {
    const socket = new FakeWebSocket();
    const firstPeer = new FakePeerConnection();
    firstPeer.close = () => {
      firstPeer.connectionState = "closed";
      firstPeer.onconnectionstatechange?.();
    };
    const secondPeer = new FakePeerConnection();
    const peers = [firstPeer, secondPeer];
    const session = new ViewerSession({
      apiBaseUrl: "https://api.example",
      fetchFn: async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();

        if (url.endsWith("/rooms/room_demo") && !init?.method) {
          return Response.json({
            roomId: "room_demo",
            state: "streaming",
            sourceState: "attached",
            hostConnected: true,
            hostSessionId: "host_1",
            viewerCount: 1,
          });
        }

        return Response.json({
          roomId: "room_demo",
          sessionId: "viewer_1",
          viewerToken: "viewer-token",
          wsUrl: "ws://signal.example/rooms/room_demo/ws",
          iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }],
        });
      },
      createWebSocket: () => socket as never,
      createPeerConnection: () => peers.shift() as never,
      initialDisplayName: "Mina",
      metricsIntervalMs: 60_000,
    });
    const statuses: string[] = [];
    session.subscribe((snapshot) => {
      statuses.push(snapshot.status);
    });

    await session.join("room_demo");
    socket.emitOpen();
    statuses.length = 0;

    socket.emitMessage(
      JSON.stringify({
        roomId: "room_demo",
        sessionId: "host_2",
        role: "host",
        messageType: "offer",
        timestamp: 11,
        payload: {
          targetSessionId: "viewer_1",
          sdp: "reattach-offer",
        },
      }),
    );
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(statuses).not.toContain("ended");
    expect(session.getSnapshot()).toMatchObject({
      status: "connecting",
      endedReasonCode: null,
    });
    expect(secondPeer.remoteDescription).toEqual({
      type: "offer",
      sdp: "reattach-offer",
    });
  });
});

function createJoinFetch(
  joinOverrides: Partial<{
    roomId: string;
    sessionId: string;
    viewerToken: string;
    wsUrl: string;
    iceServers: Array<{ urls: string[] }>;
  }> = {},
) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();

    if (url.endsWith("/rooms/room_demo") && !init?.method) {
      return Response.json({
        roomId: "room_demo",
        state: "hosting",
        sourceState: "missing",
        hostConnected: true,
        hostSessionId: null,
        viewerCount: 0,
      });
    }

    if (url.endsWith("/rooms/room_demo/join") && init?.method === "POST") {
      return Response.json({
        roomId: "room_demo",
        sessionId: "viewer_1",
        viewerToken: "viewer-token",
        wsUrl: "ws://signal.example/rooms/room_demo/ws",
        iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }],
        ...joinOverrides,
      });
    }

    throw new Error(`unexpected request: ${url}`);
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}
