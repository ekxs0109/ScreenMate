import { describe, expect, it } from "vitest";
import { RoomState } from "../src/do/room-object";

class TestSocket {
  private peer: TestSocket | null = null;
  private readonly listeners = {
    message: new Set<(event: { data: unknown }) => void>(),
    close: new Set<(event: { code?: number; reason?: string }) => void>(),
  };
  readonly messages: unknown[] = [];
  closeReason: string | null = null;

  setPeer(peer: TestSocket) {
    this.peer = peer;
  }

  accept() {}

  addEventListener(
    type: "message" | "close",
    listener: (event: { data?: unknown; code?: number; reason?: string }) => void,
  ) {
    this.listeners[type].add(listener as never);
  }

  send(data: string) {
    this.peer?.dispatchMessage(data);
  }

  close(_code?: number, reason?: string) {
    this.closeReason = reason ?? null;
    this.dispatchClose({ reason });
    if (this.peer && this.peer.closeReason === null) {
      this.peer.closeReason = reason ?? null;
      this.peer.dispatchClose({ reason });
    }
  }

  private dispatchMessage(data: string) {
    const parsed = JSON.parse(data);
    this.messages.push(parsed);

    for (const listener of this.listeners.message) {
      listener({ data });
    }
  }

  private dispatchClose(event: { code?: number; reason?: string }) {
    for (const listener of this.listeners.close) {
      listener(event);
    }
  }
}

function createSocketPair() {
  const client = new TestSocket();
  const server = new TestSocket();
  client.setPeer(server);
  server.setPeer(client);

  return { client, server };
}

describe("RoomState", () => {
  it("reports a newly created room with a missing source as degraded", () => {
    const room = new RoomState({
      roomId: "room_demo",
      hostSessionId: "host_1",
      createdAt: 1,
      expiresAt: Number.MAX_SAFE_INTEGER,
      closedAt: null,
      closedReason: null,
    });

    expect(room.initialize()).toEqual({
      roomId: "room_demo",
      hostSessionId: "host_1",
      hostConnected: false,
      viewerCount: 0,
      state: "degraded",
      sourceState: "missing",
    });
  });

  it("tracks host and viewer presence and reports a missing source until the host publishes room state", () => {
    const room = new RoomState({
      roomId: "room_demo",
      hostSessionId: "host_1",
      createdAt: 1,
      expiresAt: Number.MAX_SAFE_INTEGER,
      closedAt: null,
      closedReason: null,
    });

    room.registerSession("host_1", "host");
    room.registerSession("viewer_1", "viewer");

    expect(room.getStateSnapshot()).toEqual({
      roomId: "room_demo",
      hostSessionId: "host_1",
      hostConnected: true,
      viewerCount: 1,
      state: "degraded",
      sourceState: "missing",
    });
  });

  it("stores host source state updates and broadcasts them in room-state envelopes", () => {
    const room = new RoomState({
      roomId: "room_demo",
      hostSessionId: "host_1",
      createdAt: 1,
      expiresAt: Number.MAX_SAFE_INTEGER,
      closedAt: null,
      closedReason: null,
    });
    const host = createSocketPair();
    const viewer = createSocketPair();
    const hostConnection = {
      roomId: "room_demo",
      role: "host" as const,
      sessionId: "host_1",
      socket: host.server,
    };
    const viewerConnection = {
      roomId: "room_demo",
      role: "viewer" as const,
      sessionId: "viewer_1",
      socket: viewer.server,
    };

    room.connectSession(hostConnection);
    room.connectSession(viewerConnection);
    room.handleSocketMessage(
      hostConnection,
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

    expect(room.getStateSnapshot()).toEqual({
      roomId: "room_demo",
      hostSessionId: "host_1",
      hostConnected: true,
      viewerCount: 1,
      state: "degraded",
      sourceState: "recovering",
    });
    expect(
      viewer.client.messages.filter(
        (message) => (message as { messageType: string }).messageType === "room-state",
      ).at(-1),
    ).toMatchObject({
      messageType: "room-state",
      payload: {
        state: "degraded",
        sourceState: "recovering",
        viewerCount: 1,
      },
    });
  });

  it("broadcasts viewer presence and relays offer/answer/ice messages to the target session", () => {
    const room = new RoomState({
      roomId: "room_demo",
      hostSessionId: "host_1",
      createdAt: 1,
      expiresAt: Number.MAX_SAFE_INTEGER,
      closedAt: null,
      closedReason: null,
    });
    const host = createSocketPair();
    const viewer = createSocketPair();
    const hostConnection = {
      roomId: "room_demo",
      role: "host" as const,
      sessionId: "host_1",
      socket: host.server,
    };
    const viewerConnection = {
      roomId: "room_demo",
      role: "viewer" as const,
      sessionId: "viewer_1",
      socket: viewer.server,
    };

    room.connectSession(hostConnection);
    room.connectSession(viewerConnection);

    expect(
      host.client.messages.some(
        (message) =>
          (message as { messageType: string }).messageType === "viewer-joined",
      ),
    ).toBe(true);
    expect(
      viewer.client.messages.some(
        (message) =>
          (message as { messageType: string }).messageType === "host-connected",
      ),
    ).toBe(true);

    room.handleSocketMessage(
      hostConnection,
      JSON.stringify({
        roomId: "room_demo",
        sessionId: "host_1",
        role: "host",
        messageType: "offer",
        timestamp: 10,
        payload: { targetSessionId: "viewer_1", sdp: "host-offer" },
      }),
    );

    expect(
      viewer.client.messages.find(
        (message) => (message as { messageType: string }).messageType === "offer",
      ),
    ).toMatchObject({
      sessionId: "host_1",
      payload: { targetSessionId: "viewer_1", sdp: "host-offer" },
    });

    room.handleSocketMessage(
      viewerConnection,
      JSON.stringify({
        roomId: "room_demo",
        sessionId: "viewer_1",
        role: "viewer",
        messageType: "answer",
        timestamp: 11,
        payload: { targetSessionId: "host_1", sdp: "viewer-answer" },
      }),
    );
    room.handleSocketMessage(
      viewerConnection,
      JSON.stringify({
        roomId: "room_demo",
        sessionId: "viewer_1",
        role: "viewer",
        messageType: "ice-candidate",
        timestamp: 12,
        payload: {
          targetSessionId: "host_1",
          candidate: "candidate:1",
          sdpMid: "0",
          sdpMLineIndex: 0,
        },
      }),
    );

    expect(
      host.client.messages.find(
        (message) => (message as { messageType: string }).messageType === "answer",
      ),
    ).toMatchObject({
      sessionId: "viewer_1",
      payload: { targetSessionId: "host_1", sdp: "viewer-answer" },
    });
    expect(
      host.client.messages.find(
        (message) =>
          (message as { messageType: string }).messageType === "ice-candidate",
      ),
    ).toMatchObject({
      payload: {
        targetSessionId: "host_1",
        candidate: "candidate:1",
      },
    });
  });

  it("closes the room and notifies viewers when the host disconnects", async () => {
    let closedReason: string | null = null;
    const room = new RoomState(
      {
        roomId: "room_demo",
        hostSessionId: "host_1",
        createdAt: 1,
        expiresAt: Number.MAX_SAFE_INTEGER,
        closedAt: null,
        closedReason: null,
      },
      {
        onClose: async ({ reason }) => {
          closedReason = reason;
        },
      },
    );
    const host = createSocketPair();
    const viewer = createSocketPair();

    room.connectSession({
      roomId: "room_demo",
      role: "host",
      sessionId: "host_1",
      socket: host.server,
    });
    room.connectSession({
      roomId: "room_demo",
      role: "viewer",
      sessionId: "viewer_1",
      socket: viewer.server,
    });

    room.disconnectSession("host_1", "host");
    await Promise.resolve();

    expect(closedReason).toBe("host-left");
    expect(room.getStateSnapshot()).toEqual({
      roomId: "room_demo",
      hostSessionId: "host_1",
      hostConnected: false,
      viewerCount: 0,
      state: "closed",
      sourceState: "missing",
    });
    expect(
      viewer.client.messages.some(
        (message) => (message as { messageType: string }).messageType === "room-closed",
      ),
    ).toBe(true);
    expect(viewer.client.closeReason).toBe("room-closed");
  });
});
