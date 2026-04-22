import { describe, expect, it, vi } from "vitest";
import { ViewerSession } from "../src/viewer-session";

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
}

class FakePeerConnection {
  connectionState = "new";
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
      now: () => 42,
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
    expect(JSON.parse(socket.sentMessages[0])).toMatchObject({
      roomId: "room_demo",
      sessionId: "viewer_1",
      role: "viewer",
      messageType: "answer",
      payload: {
        targetSessionId: "host_1",
        sdp: "viewer-answer",
      },
    });

    peer.emitTrack({ id: "stream_demo" } as never);

    expect(session.getSnapshot()).toMatchObject({
      status: "connected",
      roomId: "room_demo",
      sessionId: "viewer_1",
      hostSessionId: "host_1",
    });
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
      endedReason: "The host ended the room.",
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
      endedReason: null,
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
      endedReason: null,
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
      endedReason: null,
    });
    expect(secondPeer.remoteDescription).toEqual({
      type: "offer",
      sdp: "reattach-offer",
    });
  });
});
