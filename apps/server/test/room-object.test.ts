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

async function initializeRoomObject(roomObject: RoomObject) {
  await roomObject.fetch(
    new Request("https://room.internal/internal/initialize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        roomId: "room_demo",
        hostSessionId: "host_1",
        createdAt: Date.now(),
        expiresAt: Date.now() + 3_600_000,
        maxExpiresAt: Date.now() + 43_200_000,
      }),
    }),
  );
}

function connectTestSocket(
  roomState: RoomState,
  input: {
    role: "host" | "viewer";
    sessionId: string;
    client: TestSocket;
  },
) {
  const server = createSocketPair().server;
  server.setPeer(input.client);
  input.client.setPeer(server);
  const connection = {
    roomId: "room_demo",
    role: input.role,
    sessionId: input.sessionId,
    socket: server,
  };
  roomState.connectSession(connection);
  return connection;
}

function getRoomStateInstance(roomObject: RoomObject) {
  return (roomObject as unknown as { roomState: RoomState }).roomState;
}

async function sendEnvelope(
  roomState: RoomState,
  input: {
    role: "host" | "viewer";
    sessionId: string;
    connection: {
      roomId: string;
      role: "host" | "viewer";
      sessionId: string;
      socket: TestSocket;
    };
    messageType: string;
    payload: Record<string, unknown>;
    timestamp?: number;
  },
) {
  await roomState.handleSocketMessage(
    input.connection,
    JSON.stringify({
      roomId: "room_demo",
      sessionId: input.sessionId,
      role: input.role,
      messageType: input.messageType,
      timestamp: input.timestamp ?? 100,
      payload: input.payload,
    }),
  );
}

class MemoryStorage {
  private readonly records = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | null> {
    return (this.records.get(key) as T | undefined) ?? null;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.records.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.records.delete(key);
  }
}

class DelayedActivityStorage extends MemoryStorage {
  private delayActivityPuts = false;
  private roomActivityDeleteCount = 0;
  private deleteWaiter: (() => void) | null = null;
  private readonly delayedPuts: Array<{
    release: () => void;
    completed: Promise<void>;
  }> = [];

  delayRoomActivityPuts() {
    this.delayActivityPuts = true;
  }

  async put<T>(key: string, value: T): Promise<void> {
    if (key !== "room-activity" || !this.delayActivityPuts) {
      await super.put(key, value);
      return;
    }

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const completed = gate.then(() => super.put(key, value));
    this.delayedPuts.push({ release, completed });
    await completed;
  }

  async delete(key: string): Promise<void> {
    await super.delete(key);

    if (key === "room-activity") {
      this.roomActivityDeleteCount += 1;
      this.deleteWaiter?.();
      this.deleteWaiter = null;
    }
  }

  async waitForRoomActivityDelete() {
    if (this.roomActivityDeleteCount > 0) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.deleteWaiter = resolve;
    });
  }

  async releaseDelayedPuts() {
    const delayed = [...this.delayedPuts];
    this.delayedPuts.length = 0;

    for (const put of delayed) {
      put.release();
    }

    await Promise.all(delayed.map((put) => put.completed));
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
  const connection = {
    roomId: "room_demo",
    role: "host" as const,
    sessionId,
    socket,
  };

  roomState.connectSession(connection);
  await roomState.handleSocketMessage(
    connection,
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
  it("ignores stale viewer close events after the same session reconnects", async () => {
    const { state } = createDurableObjectState();
    const roomObject = new RoomObject(state, {} as never);
    await initializeRoomObject(roomObject);
    const roomState = getRoomStateInstance(roomObject);
    const firstViewer = createSocketPair();
    const secondViewer = createSocketPair();
    const host = createSocketPair();

    roomState.connectSession({
      roomId: "room_demo",
      role: "host",
      sessionId: "host_1",
      socket: host.server,
    });
    const firstViewerConnection = {
      roomId: "room_demo",
      role: "viewer",
      sessionId: "viewer_1",
      socket: firstViewer.server,
    } as const;
    roomState.connectSession(firstViewerConnection);
    roomState.connectSession({
      roomId: "room_demo",
      role: "viewer",
      sessionId: "viewer_1",
      socket: secondViewer.server,
    });

    roomState.disconnectSession(firstViewerConnection);

    expect(roomState.getStateSnapshot().viewerCount).toBe(1);
    expect(
      host.client.messages.filter(
        (message) =>
          (message as { messageType?: string }).messageType === "viewer-left",
      ),
    ).toHaveLength(0);
  });

  it("registers a replacement viewer before closing the old socket", async () => {
    const { state } = createDurableObjectState();
    const roomObject = new RoomObject(state, {} as never);
    await initializeRoomObject(roomObject);
    const roomState = getRoomStateInstance(roomObject);
    const firstViewer = createSocketPair();
    const secondViewer = createSocketPair();
    const host = createSocketPair();

    roomState.connectSession({
      roomId: "room_demo",
      role: "host",
      sessionId: "host_1",
      socket: host.server,
    });
    const firstViewerConnection = {
      roomId: "room_demo",
      role: "viewer",
      sessionId: "viewer_1",
      socket: firstViewer.server,
    } as const;
    firstViewer.server.addEventListener("close", () => {
      roomState.disconnectSession(firstViewerConnection);
    });
    roomState.connectSession(firstViewerConnection);

    roomState.connectSession({
      roomId: "room_demo",
      role: "viewer",
      sessionId: "viewer_1",
      socket: secondViewer.server,
    });

    expect(roomState.getStateSnapshot().viewerCount).toBe(1);
    expect(
      host.client.messages.filter(
        (message) =>
          (message as { messageType?: string }).messageType === "viewer-left",
      ),
    ).toHaveLength(0);
  });

  it("ignores stale host close events after the host reconnects", async () => {
    const { state } = createDurableObjectState();
    const roomObject = new RoomObject(state, {} as never);
    await initializeRoomObject(roomObject);
    const roomState = getRoomStateInstance(roomObject);
    const firstHost = createSocketPair();
    const secondHost = createSocketPair();

    const firstHostConnection = {
      roomId: "room_demo",
      role: "host",
      sessionId: "host_1",
      socket: firstHost.server,
    } as const;
    roomState.connectSession(firstHostConnection);
    roomState.connectSession({
      roomId: "room_demo",
      role: "host",
      sessionId: "host_1",
      socket: secondHost.server,
    });

    roomState.disconnectSession(firstHostConnection);

    expect(roomState.getStateSnapshot().state).not.toBe("closed");
    expect(roomState.getStateSnapshot().hostConnected).toBe(true);
  });

  it("registers a replacement host before closing the old socket", async () => {
    const { state } = createDurableObjectState();
    const roomObject = new RoomObject(state, {} as never);
    await initializeRoomObject(roomObject);
    const roomState = getRoomStateInstance(roomObject);
    const firstHost = createSocketPair();
    const secondHost = createSocketPair();

    const firstHostConnection = {
      roomId: "room_demo",
      role: "host",
      sessionId: "host_1",
      socket: firstHost.server,
    } as const;
    firstHost.server.addEventListener("close", () => {
      roomState.disconnectSession(firstHostConnection);
    });
    roomState.connectSession(firstHostConnection);

    roomState.connectSession({
      roomId: "room_demo",
      role: "host",
      sessionId: "host_1",
      socket: secondHost.server,
    });

    expect(roomState.getStateSnapshot().state).not.toBe("closed");
    expect(roomState.getStateSnapshot().hostConnected).toBe(true);
  });

  it("stores viewer profile and metrics and broadcasts roster snapshots", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      const { state } = createDurableObjectState();
      const roomObject = new RoomObject(state, {} as never);
      await initializeRoomObject(roomObject);
      const roomState = getRoomStateInstance(roomObject);
      const host = createSocketPair().client;
      const viewer = createSocketPair().client;

      connectTestSocket(roomState, {
        role: "host",
        sessionId: "host_1",
        client: host,
      });
      const viewerConnection = connectTestSocket(roomState, {
        role: "viewer",
        sessionId: "viewer_1",
        client: viewer,
      });

      await sendEnvelope(roomState, {
        role: "viewer",
        sessionId: "viewer_1",
        connection: viewerConnection,
        messageType: "viewer-profile",
        payload: {
          viewerSessionId: "viewer_1",
          displayName: "Mina",
        },
      });
      await sendEnvelope(roomState, {
        role: "viewer",
        sessionId: "viewer_1",
        connection: viewerConnection,
        messageType: "viewer-metrics",
        payload: {
          viewerSessionId: "viewer_1",
          connectionType: "relay",
          pingMs: 142,
        },
      });

      const rosters = host.messages.filter(
        (message) =>
          (message as { messageType?: string }).messageType === "viewer-roster",
      );
      expect(rosters.at(-1)).toMatchObject({
        messageType: "viewer-roster",
        payload: {
          viewers: [
            {
              viewerSessionId: "viewer_1",
              displayName: "Mina",
              online: true,
              connectionType: "relay",
              pingMs: 142,
            },
          ],
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps room activity deleted after host-left when an activity persist was queued", async () => {
    const storage = new DelayedActivityStorage();
    const { state } = createDurableObjectState(storage);
    const roomObject = new RoomObject(state, {} as never);
    await initializeRoomObject(roomObject);
    const roomState = getRoomStateInstance(roomObject);
    const host = createSocketPair().client;
    const hostConnection = connectTestSocket(roomState, {
      role: "host",
      sessionId: "host_1",
      client: host,
    });

    storage.delayRoomActivityPuts();
    connectTestSocket(roomState, {
      role: "viewer",
      sessionId: "viewer_1",
      client: createSocketPair().client,
    });

    roomState.disconnectSession(hostConnection);
    await storage.waitForRoomActivityDelete();
    await storage.releaseDelayedPuts();

    expect(await storage.get("room-activity")).toBeNull();
  });

  it("keeps room activity deleted after expiry when an activity persist was queued", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      const storage = new DelayedActivityStorage();
      const { state } = createDurableObjectState(storage);
      const roomObject = new RoomObject(state, {} as never);
      await initializeRoomObject(roomObject);
      const roomState = getRoomStateInstance(roomObject);

      storage.delayRoomActivityPuts();
      connectTestSocket(roomState, {
        role: "viewer",
        sessionId: "viewer_1",
        client: createSocketPair().client,
      });

      vi.setSystemTime(Date.now() + 43_200_001);
      await roomState.expireIfNeeded();
      await storage.waitForRoomActivityDelete();
      await storage.releaseDelayedPuts();

      expect(await storage.get("room-activity")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("canonicalizes chat messages and replays chat history to new connections", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(2_000);
      const { state } = createDurableObjectState();
      const roomObject = new RoomObject(state, {} as never);
      await initializeRoomObject(roomObject);
      const roomState = getRoomStateInstance(roomObject);
      const host = createSocketPair().client;
      const viewer = createSocketPair().client;

      connectTestSocket(roomState, {
        role: "host",
        sessionId: "host_1",
        client: host,
      });
      const viewerConnection = connectTestSocket(roomState, {
        role: "viewer",
        sessionId: "viewer_1",
        client: viewer,
      });
      await sendEnvelope(roomState, {
        role: "viewer",
        sessionId: "viewer_1",
        connection: viewerConnection,
        messageType: "viewer-profile",
        payload: {
          viewerSessionId: "viewer_1",
          displayName: "Mina",
        },
      });
      await sendEnvelope(roomState, {
        role: "viewer",
        sessionId: "viewer_1",
        connection: viewerConnection,
        messageType: "chat-message",
        payload: {
          text: "  hello host  ",
        },
      });

      expect(host.messages.at(-1)).toMatchObject({
        messageType: "chat-message-created",
        payload: {
          senderSessionId: "viewer_1",
          senderRole: "viewer",
          senderName: "Mina",
          text: "hello host",
          sentAt: 2_000,
        },
      });

      const secondViewer = createSocketPair().client;
      connectTestSocket(roomState, {
        role: "viewer",
        sessionId: "viewer_2",
        client: secondViewer,
      });

      expect(
        secondViewer.messages.find(
          (message) =>
            (message as { messageType?: string }).messageType === "chat-history",
        ),
      ).toMatchObject({
        messageType: "chat-history",
        payload: {
          messages: [
            {
              senderSessionId: "viewer_1",
              senderRole: "viewer",
              senderName: "Mina",
              text: "hello host",
            },
          ],
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores stale viewer messages after the same session reconnects", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(10_000);
      const { state } = createDurableObjectState();
      const roomObject = new RoomObject(state, {} as never);
      await initializeRoomObject(roomObject);
      const roomState = getRoomStateInstance(roomObject);
      const host = createSocketPair().client;
      const firstViewer = createSocketPair().client;
      const secondViewer = createSocketPair().client;

      connectTestSocket(roomState, {
        role: "host",
        sessionId: "host_1",
        client: host,
      });
      const staleViewerConnection = connectTestSocket(roomState, {
        role: "viewer",
        sessionId: "viewer_1",
        client: firstViewer,
      });
      const currentViewerConnection = connectTestSocket(roomState, {
        role: "viewer",
        sessionId: "viewer_1",
        client: secondViewer,
      });
      await sendEnvelope(roomState, {
        role: "viewer",
        sessionId: "viewer_1",
        connection: currentViewerConnection,
        messageType: "viewer-profile",
        payload: {
          viewerSessionId: "viewer_1",
          displayName: "Current",
        },
      });

      vi.setSystemTime(12_000);
      await sendEnvelope(roomState, {
        role: "viewer",
        sessionId: "viewer_1",
        connection: staleViewerConnection,
        messageType: "viewer-profile",
        payload: {
          viewerSessionId: "viewer_1",
          displayName: "Stale",
        },
      });
      await sendEnvelope(roomState, {
        role: "viewer",
        sessionId: "viewer_1",
        connection: staleViewerConnection,
        messageType: "chat-message",
        payload: { text: "stale chat" },
      });

      const rosters = host.messages.filter(
        (message) =>
          (message as { messageType?: string }).messageType === "viewer-roster",
      ) as Array<{ payload: { viewers: Array<{ displayName: string }> } }>;
      expect(rosters.at(-1)?.payload.viewers[0]?.displayName).toBe("Current");
      expect(
        host.messages.some(
          (message) =>
            (message as { messageType?: string }).messageType ===
              "chat-message-created" &&
            (message as { payload?: { text?: string } }).payload?.text ===
              "stale chat",
        ),
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores stale viewer messages after the replacement disconnects", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(30_000);
      const { state } = createDurableObjectState();
      const roomObject = new RoomObject(state, {} as never);
      await initializeRoomObject(roomObject);
      const roomState = getRoomStateInstance(roomObject);
      const host = createSocketPair().client;
      const firstViewer = createSocketPair().client;
      const secondViewer = createSocketPair().client;

      connectTestSocket(roomState, {
        role: "host",
        sessionId: "host_1",
        client: host,
      });
      const staleViewerConnection = connectTestSocket(roomState, {
        role: "viewer",
        sessionId: "viewer_1",
        client: firstViewer,
      });
      const currentViewerConnection = connectTestSocket(roomState, {
        role: "viewer",
        sessionId: "viewer_1",
        client: secondViewer,
      });
      await sendEnvelope(roomState, {
        role: "viewer",
        sessionId: "viewer_1",
        connection: currentViewerConnection,
        messageType: "viewer-profile",
        payload: {
          viewerSessionId: "viewer_1",
          displayName: "Current",
        },
      });

      roomState.disconnectSession(currentViewerConnection);
      vi.setSystemTime(32_000);
      await sendEnvelope(roomState, {
        role: "viewer",
        sessionId: "viewer_1",
        connection: staleViewerConnection,
        messageType: "viewer-profile",
        payload: {
          viewerSessionId: "viewer_1",
          displayName: "Stale",
        },
      });
      await sendEnvelope(roomState, {
        role: "viewer",
        sessionId: "viewer_1",
        connection: staleViewerConnection,
        messageType: "chat-message",
        payload: { text: "stale after disconnect" },
      });

      const rosters = host.messages.filter(
        (message) =>
          (message as { messageType?: string }).messageType === "viewer-roster",
      ) as Array<{ payload: { viewers: Array<{ displayName: string }> } }>;
      expect(rosters.at(-1)?.payload.viewers[0]?.displayName).toBe("Current");
      expect(
        host.messages.some(
          (message) =>
            (message as { messageType?: string }).messageType ===
              "chat-message-created" &&
            (message as { payload?: { text?: string } }).payload?.text ===
              "stale after disconnect",
        ),
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores stale host messages after the host reconnects", async () => {
    const { state } = createDurableObjectState();
    const roomObject = new RoomObject(state, {} as never);
    await initializeRoomObject(roomObject);
    const roomState = getRoomStateInstance(roomObject);
    const firstHost = createSocketPair().client;
    const secondHost = createSocketPair().client;
    const viewer = createSocketPair().client;

    const staleHostConnection = connectTestSocket(roomState, {
      role: "host",
      sessionId: "host_1",
      client: firstHost,
    });
    connectTestSocket(roomState, {
      role: "host",
      sessionId: "host_1",
      client: secondHost,
    });
    connectTestSocket(roomState, {
      role: "viewer",
      sessionId: "viewer_1",
      client: viewer,
    });

    await sendEnvelope(roomState, {
      role: "host",
      sessionId: "host_1",
      connection: staleHostConnection,
      messageType: "room-state",
      payload: {
        state: "streaming",
        sourceState: "attached",
        viewerCount: 1,
      },
    });
    await sendEnvelope(roomState, {
      role: "host",
      sessionId: "host_1",
      connection: staleHostConnection,
      messageType: "chat-message",
      payload: { text: "stale host chat" },
    });

    expect(roomState.getStateSnapshot().sourceState).toBe("missing");
    expect(
      secondHost.messages.some(
        (message) =>
          (message as { messageType?: string }).messageType ===
            "chat-message-created" &&
          (message as { payload?: { text?: string } }).payload?.text ===
            "stale host chat",
      ),
    ).toBe(false);
  });

  it("ignores stale host messages after the replacement disconnects", async () => {
    const { state } = createDurableObjectState();
    const roomObject = new RoomObject(state, {} as never);
    await initializeRoomObject(roomObject);
    const roomState = getRoomStateInstance(roomObject);
    const firstHost = createSocketPair().client;
    const secondHost = createSocketPair().client;

    const staleHostConnection = connectTestSocket(roomState, {
      role: "host",
      sessionId: "host_1",
      client: firstHost,
    });
    const currentHostConnection = connectTestSocket(roomState, {
      role: "host",
      sessionId: "host_1",
      client: secondHost,
    });

    roomState.disconnectSession(currentHostConnection);
    await sendEnvelope(roomState, {
      role: "host",
      sessionId: "host_1",
      connection: staleHostConnection,
      messageType: "room-state",
      payload: {
        state: "streaming",
        sourceState: "attached",
        viewerCount: 0,
      },
    });
    await sendEnvelope(roomState, {
      role: "host",
      sessionId: "host_1",
      connection: staleHostConnection,
      messageType: "chat-message",
      payload: { text: "stale host after disconnect" },
    });

    expect(roomState.getStateSnapshot()).toMatchObject({
      state: "closed",
      sourceState: "missing",
      hostConnected: false,
    });
    expect(
      secondHost.messages.some(
        (message) =>
          (message as { messageType?: string }).messageType ===
            "chat-message-created" &&
          (message as { payload?: { text?: string } }).payload?.text ===
            "stale host after disconnect",
      ),
    ).toBe(false);
  });

  it("rate-limits host chat messages", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(20_000);
      const { state } = createDurableObjectState();
      const roomObject = new RoomObject(state, {} as never);
      await initializeRoomObject(roomObject);
      const roomState = getRoomStateInstance(roomObject);
      const host = createSocketPair().client;
      const hostConnection = connectTestSocket(roomState, {
        role: "host",
        sessionId: "host_1",
        client: host,
      });

      await sendEnvelope(roomState, {
        role: "host",
        sessionId: "host_1",
        connection: hostConnection,
        messageType: "chat-message",
        payload: { text: "first" },
      });
      await sendEnvelope(roomState, {
        role: "host",
        sessionId: "host_1",
        connection: hostConnection,
        messageType: "chat-message",
        payload: { text: "second" },
      });

      expect(
        host.messages.filter(
          (message) =>
            (message as { messageType?: string }).messageType ===
            "chat-message-created",
        ),
      ).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks disconnected viewers offline while keeping their profile", async () => {
    const { state } = createDurableObjectState();
    const roomObject = new RoomObject(state, {} as never);
    await initializeRoomObject(roomObject);
    const roomState = getRoomStateInstance(roomObject);
    const host = createSocketPair().client;
    const viewer = createSocketPair().client;

    connectTestSocket(roomState, {
      role: "host",
      sessionId: "host_1",
      client: host,
    });
    const viewerConnection = connectTestSocket(roomState, {
      role: "viewer",
      sessionId: "viewer_1",
      client: viewer,
    });
    await sendEnvelope(roomState, {
      role: "viewer",
      sessionId: "viewer_1",
      connection: viewerConnection,
      messageType: "viewer-profile",
      payload: {
        viewerSessionId: "viewer_1",
        displayName: "Mina",
      },
    });

    roomState.disconnectSession(viewerConnection);

    expect(host.messages.at(-1)).toMatchObject({
      messageType: "viewer-roster",
      payload: {
        viewers: [
          {
            viewerSessionId: "viewer_1",
            displayName: "Mina",
            online: false,
          },
        ],
      },
    });
  });

  it("replays persisted room activity after Durable Object reload", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(3_000);
      const { state } = createDurableObjectState();
      const roomObject = new RoomObject(state, {} as never);
      await initializeRoomObject(roomObject);
      const roomState = getRoomStateInstance(roomObject);
      const viewer = createSocketPair().client;
      const viewerConnection = connectTestSocket(roomState, {
        role: "viewer",
        sessionId: "viewer_1",
        client: viewer,
      });

      await sendEnvelope(roomState, {
        role: "viewer",
        sessionId: "viewer_1",
        connection: viewerConnection,
        messageType: "viewer-profile",
        payload: {
          viewerSessionId: "viewer_1",
          displayName: "Mina",
        },
      });
      await sendEnvelope(roomState, {
        role: "viewer",
        sessionId: "viewer_1",
        connection: viewerConnection,
        messageType: "chat-message",
        payload: { text: "persist me" },
      });

      const freshRoomObject = new RoomObject(state, {} as never);
      await freshRoomObject.fetch(
        new Request("https://room.internal/internal/state", { method: "GET" }),
      );
      const freshRoomState = getRoomStateInstance(freshRoomObject);
      const host = createSocketPair().client;
      connectTestSocket(freshRoomState, {
        role: "host",
        sessionId: "host_1",
        client: host,
      });

      expect(
        host.messages.find(
          (message) =>
            (message as { messageType?: string }).messageType === "viewer-roster",
        ),
      ).toMatchObject({
        payload: {
          viewers: [
            expect.objectContaining({
              viewerSessionId: "viewer_1",
              displayName: "Mina",
            }),
          ],
        },
      });
      expect(
        host.messages.find(
          (message) =>
            (message as { messageType?: string }).messageType === "chat-history",
        ),
      ).toMatchObject({
        payload: {
          messages: [expect.objectContaining({ text: "persist me" })],
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects viewer activity for a different viewer session", async () => {
    const { state } = createDurableObjectState();
    const roomObject = new RoomObject(state, {} as never);
    await initializeRoomObject(roomObject);
    const roomState = getRoomStateInstance(roomObject);
    const viewer = createSocketPair().client;
    const viewerConnection = connectTestSocket(roomState, {
      role: "viewer",
      sessionId: "viewer_1",
      client: viewer,
    });

    await sendEnvelope(roomState, {
      role: "viewer",
      sessionId: "viewer_1",
      connection: viewerConnection,
      messageType: "viewer-profile",
      payload: {
        viewerSessionId: "viewer_2",
        displayName: "Mina",
      },
    });

    expect(viewer.closeReason).toBe("session-mismatch");
  });

  it("rejects server-authored activity envelopes from clients", async () => {
    const { state } = createDurableObjectState();
    const roomObject = new RoomObject(state, {} as never);
    await initializeRoomObject(roomObject);
    const roomState = getRoomStateInstance(roomObject);
    const viewer = createSocketPair().client;
    const viewerConnection = connectTestSocket(roomState, {
      role: "viewer",
      sessionId: "viewer_1",
      client: viewer,
    });

    await sendEnvelope(roomState, {
      role: "viewer",
      sessionId: "viewer_1",
      connection: viewerConnection,
      messageType: "chat-message-created",
      payload: {
        messageId: "msg_1",
        senderSessionId: "viewer_1",
        senderRole: "viewer",
        senderName: "Mina",
        text: "spoofed",
        sentAt: 1,
      },
    });

    expect(viewer.closeReason).toBe("message-type-not-allowed");
  });

  it("ignores empty chat without broadcasting or persisting", async () => {
    const { state, storage } = createDurableObjectState();
    const roomObject = new RoomObject(state, {} as never);
    await initializeRoomObject(roomObject);
    const roomState = getRoomStateInstance(roomObject);
    const host = createSocketPair().client;
    const hostConnection = connectTestSocket(roomState, {
      role: "host",
      sessionId: "host_1",
      client: host,
    });
    const activityBefore = await storage.get("room-activity");

    await sendEnvelope(roomState, {
      role: "host",
      sessionId: "host_1",
      connection: hostConnection,
      messageType: "chat-message",
      payload: { text: "   " },
    });

    expect(
      host.messages.some(
        (message) =>
          (message as { messageType?: string }).messageType ===
          "chat-message-created",
        ),
    ).toBe(false);
    expect(await storage.get("room-activity")).toEqual(activityBefore);
  });

  it("normalizes malformed persisted activity before sending snapshots", async () => {
    const { state } = createDurableObjectState();
    const roomObject = new RoomObject(state, {} as never);
    await initializeRoomObject(roomObject);
    await state.storage.put("room-activity", {
      viewerProfiles: [{ viewerSessionId: "viewer_1", displayName: "Mina" }],
      viewerMetrics: [
        {
          viewerSessionId: "viewer_1",
          connectionType: "relay",
          pingMs: Number.POSITIVE_INFINITY,
          metricsUpdatedAt: 1,
        },
        {
          viewerSessionId: "viewer_2",
          connectionType: "relay",
          pingMs: 32,
          metricsUpdatedAt: Number.NaN,
        },
      ],
      chatMessages: [{ text: "missing canonical fields" }],
    });

    const freshRoomObject = new RoomObject(state, {} as never);
    await freshRoomObject.fetch(
      new Request("https://room.internal/internal/state", { method: "GET" }),
    );
    const freshRoomState = getRoomStateInstance(freshRoomObject);
    const host = createSocketPair().client;

    expect(() =>
      connectTestSocket(freshRoomState, {
        role: "host",
        sessionId: "host_1",
        client: host,
      }),
    ).not.toThrow();
    expect(
      host.messages.find(
        (message) =>
          (message as { messageType?: string }).messageType === "viewer-roster",
      ),
    ).toMatchObject({
      payload: {
        viewers: [
          {
            viewerSessionId: "viewer_1",
            connectionType: "unknown",
            pingMs: null,
            metricsUpdatedAt: null,
          },
        ],
      },
    });
  });

  it("caps chat history replay to the latest 100 messages", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(4_000);
      const { state } = createDurableObjectState();
      const roomObject = new RoomObject(state, {} as never);
      await initializeRoomObject(roomObject);
      const roomState = getRoomStateInstance(roomObject);
      const host = createSocketPair().client;
      const hostConnection = connectTestSocket(roomState, {
        role: "host",
        sessionId: "host_1",
        client: host,
      });

      for (let i = 0; i < 101; i += 1) {
        await sendEnvelope(roomState, {
          role: "host",
          sessionId: "host_1",
          connection: hostConnection,
          messageType: "chat-message",
          payload: { text: `message ${i}` },
        });
        vi.advanceTimersByTime(500);
      }

      const viewer = createSocketPair().client;
      connectTestSocket(roomState, {
        role: "viewer",
        sessionId: "viewer_1",
        client: viewer,
      });
      const history = viewer.messages.find(
        (message) =>
          (message as { messageType?: string }).messageType === "chat-history",
      ) as { payload: { messages: Array<{ text: string; messageId: string }> } };

      expect(history.payload.messages).toHaveLength(100);
      expect(history.payload.messages[0]!.text).toBe("message 1");
      expect(
        new Set(history.payload.messages.map((message) => message.messageId)).size,
      ).toBe(100);
    } finally {
      vi.useRealTimers();
    }
  });

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

  it("ignores host chat after the room expires", async () => {
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
            expiresAt: 300_000,
            maxExpiresAt: 5_000_000,
          }),
        }),
      );
      const roomState = getRoomStateInstance(roomObject);
      const host = createSocketPair().client;
      const hostConnection = connectTestSocket(roomState, {
        role: "host",
        sessionId: "host_1",
        client: host,
      });

      vi.setSystemTime(300_000);
      await roomState.expireIfNeeded();
      expect(await storage.get("room-activity")).toBeNull();

      await sendEnvelope(roomState, {
        role: "host",
        sessionId: "host_1",
        connection: hostConnection,
        messageType: "chat-message",
        payload: { text: "after close" },
      });

      expect(
        host.messages.some(
          (message) =>
            (message as { messageType?: string }).messageType ===
            "chat-message-created",
        ),
      ).toBe(false);
      expect(await storage.get("room-activity")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores host room-state after the room expires", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(200_000);
      const { state } = createDurableObjectState();
      const roomObject = new RoomObject(state, {} as never);

      await roomObject.fetch(
        new Request("https://room.internal/internal/initialize", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            roomId: "room_demo",
            hostSessionId: "host_1",
            createdAt: 0,
            expiresAt: 300_000,
            maxExpiresAt: 5_000_000,
          }),
        }),
      );
      const roomState = getRoomStateInstance(roomObject);
      const hostConnection = connectTestSocket(roomState, {
        role: "host",
        sessionId: "host_1",
        client: createSocketPair().client,
      });

      vi.setSystemTime(300_000);
      await roomState.expireIfNeeded();
      await sendEnvelope(roomState, {
        role: "host",
        sessionId: "host_1",
        connection: hostConnection,
        messageType: "room-state",
        payload: {
          state: "streaming",
          sourceState: "attached",
          viewerCount: 0,
        },
      });

      expect(roomState.getStateSnapshot()).toMatchObject({
        state: "closed",
        sourceState: "missing",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("RoomState", () => {
  it("persists renewal records with maxExpiresAt", async () => {
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

    const connection = {
      roomId: "room_demo",
      role: "host" as const,
      sessionId: "host_1",
      socket: createSocketPair().server,
    };
    room.connectSession(connection);
    await room.handleSocketMessage(
      connection,
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

  it("extends room expiry and persists renewal when host heartbeats near expiry", async () => {
    const persisted: Array<{ expiresAt: number }> = [];
    const room = new RoomState(
      {
        roomId: "room_demo",
        hostSessionId: "host_1",
        createdAt: 0,
        expiresAt: 2_000,
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

    const connection = {
      roomId: "room_demo",
      role: "host" as const,
      sessionId: "host_1",
      socket: createSocketPair().server,
    };
    room.connectSession(connection);
    await room.handleSocketMessage(
      connection,
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

  it("does not renew or persist expiry when viewer heartbeats", async () => {
    const persisted: Array<{ expiresAt: number }> = [];
    const room = new RoomState(
      {
        roomId: "room_demo",
        hostSessionId: "host_1",
        createdAt: 0,
        expiresAt: 2_000,
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

    const connection = {
      roomId: "room_demo",
      role: "viewer" as const,
      sessionId: "viewer_1",
      socket: createSocketPair().server,
    };
    room.connectSession(connection);
    await room.handleSocketMessage(
      connection,
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

    const hostConnection = {
      roomId: "room_demo",
      role: "host",
      sessionId: "host_1",
      socket: host.server,
    } as const;
    room.connectSession(hostConnection);
    room.connectSession({
      roomId: "room_demo",
      role: "viewer",
      sessionId: "viewer_1",
      socket: viewer.server,
    });

    room.disconnectSession(hostConnection);
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
