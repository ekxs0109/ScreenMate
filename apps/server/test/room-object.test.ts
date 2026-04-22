import { describe, expect, it, vi } from "vitest";
import { RoomObject, RoomState } from "../src/do/room-object";

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

class MemoryStorage {
  private readonly records = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | null> {
    return (this.records.get(key) as T | undefined) ?? null;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.records.set(key, value);
  }
}

function createDurableObjectState(storage = new MemoryStorage()): {
  state: DurableObjectState;
  storage: MemoryStorage;
} {
  return {
    state: { storage } as unknown as DurableObjectState,
    storage,
  };
}

async function sendHostHeartbeat(roomObject: RoomObject, sessionId = "host_1") {
  const roomState = (roomObject as unknown as { roomState: RoomState }).roomState;
  const socket = createSocketPair().server;

  roomState.handleSocketMessage(
    {
      roomId: "room_demo",
      role: "host",
      sessionId,
      socket,
    },
    JSON.stringify({
      roomId: "room_demo",
      sessionId,
      role: "host",
      messageType: "heartbeat",
      timestamp: Date.now(),
      payload: { sequence: 1 },
    }),
  );
  await Promise.resolve();
}

describe("RoomObject", () => {
  it("persists host-heartbeat renewal in DO storage and survives reload", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(100_000);
      const { state, storage } = createDurableObjectState();
      const roomObject = new RoomObject(state, {} as never);

      await roomObject.fetch(
        new Request("https://room.internal/internal/initialize", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            roomId: "room_demo",
            hostSessionId: "host_1",
            createdAt: 0,
            expiresAt: 100_500,
            maxExpiresAt: 5_000_000,
          }),
        }),
      );
      await sendHostHeartbeat(roomObject);

      const storedAfterHeartbeat = await storage.get<{
        expiresAt: number;
        maxExpiresAt: number;
      }>("room-record");

      expect(storedAfterHeartbeat?.expiresAt).toBe(1_900_000);
      expect(storedAfterHeartbeat?.maxExpiresAt).toBe(5_000_000);

      const freshRoomObject = new RoomObject(state, {} as never);
      await freshRoomObject.fetch(
        new Request("https://room.internal/internal/state", { method: "GET" }),
      );

      const loadedRecord = (freshRoomObject as unknown as {
        record: { expiresAt: number; maxExpiresAt: number };
      }).record;

      expect(loadedRecord.expiresAt).toBe(storedAfterHeartbeat?.expiresAt);
      expect(loadedRecord.maxExpiresAt).toBe(storedAfterHeartbeat?.maxExpiresAt);
    } finally {
      vi.useRealTimers();
    }
  });

  it("normalizes legacy records without maxExpiresAt and keeps heartbeat expiry finite", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(60_000);
      const { state, storage } = createDurableObjectState();
      await storage.put("room-record", {
        roomId: "room_demo",
        hostSessionId: "host_1",
        createdAt: 0,
        expiresAt: 120_000,
        closedAt: null,
        closedReason: null,
      });
      const roomObject = new RoomObject(state, {} as never);

      await roomObject.fetch(
        new Request("https://room.internal/internal/state", { method: "GET" }),
      );
      await sendHostHeartbeat(roomObject);

      const normalized = await storage.get<{
        expiresAt: number;
        maxExpiresAt: number;
      }>("room-record");

      expect(Number.isFinite(normalized?.maxExpiresAt)).toBe(true);
      expect(Number.isFinite(normalized?.expiresAt)).toBe(true);
      expect(normalized?.maxExpiresAt).toBeGreaterThanOrEqual(
        normalized?.expiresAt ?? 0,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("clamps renewal to maxExpiresAt when host heartbeat exceeds hard limit", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(100_000);
      const { state, storage } = createDurableObjectState();
      const roomObject = new RoomObject(state, {} as never);

      await roomObject.fetch(
        new Request("https://room.internal/internal/initialize", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            roomId: "room_demo",
            hostSessionId: "host_1",
            createdAt: 0,
            expiresAt: 100_500,
            maxExpiresAt: 101_000,
          }),
        }),
      );
      await sendHostHeartbeat(roomObject);

      const stored = await storage.get<{ expiresAt: number; maxExpiresAt: number }>(
        "room-record",
      );

      expect(stored).toMatchObject({
        expiresAt: 101_000,
        maxExpiresAt: 101_000,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks expired rooms closed when internal state is read", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(200_000);
      const { state, storage } = createDurableObjectState();
      const roomObject = new RoomObject(state, {} as never);

      await roomObject.fetch(
        new Request("https://room.internal/internal/initialize", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            roomId: "room_demo",
            hostSessionId: "host_1",
            createdAt: 0,
            expiresAt: 100_000,
            maxExpiresAt: 5_000_000,
          }),
        }),
      );

      const response = await roomObject.fetch(
        new Request("https://room.internal/internal/state", { method: "GET" }),
      );
      const body = (await response.json()) as {
        state: string;
        sourceState: string;
      };
      const stored = await storage.get<{
        closedReason: string | null;
      }>("room-record");

      expect(body.state).toBe("closed");
      expect(body.sourceState).toBe("missing");
      expect(stored?.closedReason).toBe("expired");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("RoomState", () => {
  it("persists renewal records with maxExpiresAt", () => {
    const persisted: Array<{
      roomId: string;
      hostSessionId: string;
      createdAt: number;
      expiresAt: number;
      maxExpiresAt: number;
      closedAt: number | null;
      closedReason: "host-left" | "expired" | "closed" | null;
    }> = [];
    const room = new RoomState(
      {
        roomId: "room_demo",
        hostSessionId: "host_1",
        createdAt: 100,
        expiresAt: 1_000,
        maxExpiresAt: 2_000,
        closedAt: null,
        closedReason: null,
      },
      {
        now: () => 500,
        onPersist: async (record) => {
          persisted.push(record);
        },
      },
    );

    room.handleSocketMessage(
      {
        roomId: "room_demo",
        role: "host",
        sessionId: "host_1",
        socket: createSocketPair().server,
      },
      JSON.stringify({
        roomId: "room_demo",
        sessionId: "host_1",
        role: "host",
        messageType: "heartbeat",
        timestamp: 500,
        payload: { sequence: 1 },
      }),
    );

    expect(persisted.at(-1)).toMatchObject({
      roomId: "room_demo",
      hostSessionId: "host_1",
      createdAt: 100,
      maxExpiresAt: 2_000,
      closedAt: null,
      closedReason: null,
    });
  });

  it("extends room expiry and persists renewal when host heartbeats near expiry", () => {
    const persisted: Array<{ expiresAt: number }> = [];
    const room = new RoomState(
      {
        roomId: "room_demo",
        hostSessionId: "host_1",
        createdAt: 0,
        expiresAt: 1_000,
        maxExpiresAt: 2_000_000,
        closedAt: null,
        closedReason: null,
      },
      {
        now: () => 1_500,
        onPersist: async (record) => {
          persisted.push({ expiresAt: record.expiresAt });
        },
      },
    );

    room.handleSocketMessage(
      {
        roomId: "room_demo",
        role: "host",
        sessionId: "host_1",
        socket: createSocketPair().server,
      },
      JSON.stringify({
        roomId: "room_demo",
        sessionId: "host_1",
        role: "host",
        messageType: "heartbeat",
        timestamp: 1_500,
        payload: { sequence: 1 },
      }),
    );

    expect(persisted).toEqual([{ expiresAt: 1_801_500 }]);
  });

  it("does not renew or persist expiry when viewer heartbeats", () => {
    const persisted: Array<{ expiresAt: number }> = [];
    const room = new RoomState(
      {
        roomId: "room_demo",
        hostSessionId: "host_1",
        createdAt: 0,
        expiresAt: 1_000,
        maxExpiresAt: 2_000_000,
        closedAt: null,
        closedReason: null,
      },
      {
        now: () => 1_500,
        onPersist: async (record) => {
          persisted.push({ expiresAt: record.expiresAt });
        },
      },
    );

    room.handleSocketMessage(
      {
        roomId: "room_demo",
        role: "viewer",
        sessionId: "viewer_1",
        socket: createSocketPair().server,
      },
      JSON.stringify({
        roomId: "room_demo",
        sessionId: "viewer_1",
        role: "viewer",
        messageType: "heartbeat",
        timestamp: 1_500,
        payload: { sequence: 1 },
      }),
    );

    expect(persisted).toEqual([]);
  });

  it("reports a newly created room with a missing source as degraded", () => {
    const room = new RoomState({
      roomId: "room_demo",
      hostSessionId: "host_1",
      createdAt: 1,
      expiresAt: Number.MAX_SAFE_INTEGER,
      maxExpiresAt: Number.MAX_SAFE_INTEGER,
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
      maxExpiresAt: Number.MAX_SAFE_INTEGER,
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
      maxExpiresAt: Number.MAX_SAFE_INTEGER,
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
      maxExpiresAt: Number.MAX_SAFE_INTEGER,
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
        maxExpiresAt: Number.MAX_SAFE_INTEGER,
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
