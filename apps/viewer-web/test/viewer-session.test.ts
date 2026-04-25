import { afterEach, describe, expect, it, vi } from "vitest";
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

  async getStats() {
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

describe("ViewerSession", () => {
  afterEach(() => {
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
