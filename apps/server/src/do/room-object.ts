import {
  errorCodes,
  signalEnvelopeSchema,
  type RoomSourceState,
} from "@screenmate/shared";
import type { CloudflareBindings } from "../env.js";

type SessionRole = "host" | "viewer";
type RoomLifecycleState =
  | "hosting"
  | "streaming"
  | "degraded"
  | "closed";
type CloseReason = "host-left" | "expired" | "closed";
type SignalEnvelope = typeof signalEnvelopeSchema._output;

type RoomInitialization = {
  roomId: string;
  hostSessionId: string;
  createdAt: number;
  expiresAt: number;
  maxExpiresAt: number;
};

type PersistedRoomRecord = RoomInitialization & {
  closedAt: number | null;
  closedReason: CloseReason | null;
};
type StoredRoomRecord = Omit<PersistedRoomRecord, "maxExpiresAt"> & {
  maxExpiresAt?: number;
};

type RoomStateSnapshot = {
  roomId: string;
  hostSessionId: string;
  hostConnected: boolean;
  viewerCount: number;
  state: RoomLifecycleState;
  sourceState: RoomSourceState;
};

type ConnectionSocket = {
  addEventListener: (
    type: "message" | "close",
    listener: (event: { data?: unknown; code?: number; reason?: string }) => void,
  ) => void;
  close: (code?: number, reason?: string) => void;
  send: (data: string) => void;
  accept?: () => void;
};

type RoomConnection = {
  roomId: string;
  role: SessionRole;
  sessionId: string;
  socket: ConnectionSocket;
};

type JoinValidation =
  | { ok: true; snapshot: RoomStateSnapshot }
  | { ok: false; status: number; body: Record<string, unknown> };

const ROOM_RECORD_KEY = "room-record";
const ROOM_RENEWAL_WINDOW_MS = 30 * 60 * 1_000;
const ROOM_MAX_LIFETIME_MS = 12 * 60 * 60 * 1_000;

export class RoomState {
  private readonly roomId: string;
  private readonly hostSessionId: string;
  private readonly createdAt: number;
  private expiresAt: number;
  private readonly maxExpiresAt: number;
  private closedAt: number | null;
  private closedReason: CloseReason | null;
  private sourceState: RoomSourceState = "missing";
  private hostConnection: RoomConnection | null = null;
  private readonly viewers = new Map<string, RoomConnection>();

  constructor(
    record: PersistedRoomRecord,
    private readonly options: {
      now?: () => number;
      onClose?: (closure: {
        closedAt: number;
        reason: CloseReason;
      }) => void | Promise<void>;
      onPersist?: (record: PersistedRoomRecord) => void | Promise<void>;
    } = {},
  ) {
    this.roomId = record.roomId;
    this.hostSessionId = record.hostSessionId;
    this.createdAt = record.createdAt;
    this.expiresAt = record.expiresAt;
    this.maxExpiresAt = record.maxExpiresAt;
    this.closedAt = record.closedAt;
    this.closedReason = record.closedReason;
  }

  initialize() {
    return this.getStateSnapshot();
  }

  registerSession(sessionId: string, role: SessionRole) {
    if (this.isClosed() || this.isExpired()) {
      return;
    }

    if (role === "host" && sessionId === this.hostSessionId) {
      this.hostConnection = {
        roomId: this.roomId,
        role,
        sessionId,
        socket: createNoopSocket(),
      };
      return;
    }

    if (role === "viewer") {
      this.viewers.set(sessionId, {
        roomId: this.roomId,
        role,
        sessionId,
        socket: createNoopSocket(),
      });
    }
  }

  connectSession(connection: RoomConnection) {
    if (this.isExpired()) {
      void this.closeRoom("expired");
      connection.socket.close(4001, "room-expired");
      return;
    }

    if (this.isClosed()) {
      connection.socket.close(4002, "room-closed");
      return;
    }

    connection.socket.accept?.();

    if (connection.role === "host") {
      if (this.hostConnection && this.hostConnection !== connection) {
        this.hostConnection.socket.close(1012, "host-replaced");
      }

      this.hostConnection = connection;
      this.send(connection, this.roomStateEnvelope());

      for (const viewer of this.viewers.values()) {
        this.send(connection, this.viewerPresenceEnvelope("viewer-joined", viewer.sessionId));
      }

      this.broadcast(
        this.hostConnectedEnvelope(),
        ({ role }) => role === "viewer",
      );
      this.broadcast(this.roomStateEnvelope());
      return;
    }

    const existingViewer = this.viewers.get(connection.sessionId);
    if (existingViewer && existingViewer !== connection) {
      existingViewer.socket.close(1012, "viewer-replaced");
    }

    this.viewers.set(connection.sessionId, connection);
    this.send(connection, this.roomStateEnvelope());

    if (this.hostConnection) {
      this.send(connection, this.hostConnectedEnvelope());
    }

    this.broadcast(
      this.viewerPresenceEnvelope("viewer-joined", connection.sessionId),
      ({ sessionId }) => sessionId !== connection.sessionId,
    );
    this.broadcast(this.roomStateEnvelope());
  }

  disconnectSession(sessionId: string, role: SessionRole) {
    if (role === "host" && this.hostConnection?.sessionId === sessionId) {
      this.hostConnection = null;
      void this.closeRoom("host-left");
      return;
    }

    if (!this.viewers.delete(sessionId)) {
      return;
    }

    this.broadcast(this.viewerPresenceEnvelope("viewer-left", sessionId));
    this.broadcast(this.roomStateEnvelope());
  }

  validateViewerJoin(): JoinValidation {
    if (this.isExpired()) {
      void this.closeRoom("expired");
      return {
        ok: false,
        status: 410,
        body: {
          error: errorCodes.ROOM_EXPIRED,
          ...this.getStateSnapshot(),
        },
      };
    }

    if (this.isClosed()) {
      return {
        ok: false,
        status: 409,
        body: {
          error: errorCodes.ROOM_NOT_FOUND,
          ...this.getStateSnapshot(),
        },
      };
    }

    return { ok: true, snapshot: this.getStateSnapshot() };
  }

  getStateSnapshot(): RoomStateSnapshot {
    const viewerCount = this.viewers.size;
    let state: RoomLifecycleState = "hosting";

    if (this.isClosed()) {
      state = "closed";
    } else if (this.sourceState !== "attached") {
      state = "degraded";
    } else if (viewerCount > 0) {
      state = "streaming";
    } else {
      state = "hosting";
    }

    return {
      roomId: this.roomId,
      hostSessionId: this.hostSessionId,
      hostConnected: this.hostConnection !== null,
      viewerCount,
      state,
      sourceState: this.sourceState,
    };
  }

  async expireIfNeeded() {
    if (!this.isExpired()) {
      return false;
    }

    await this.closeRoom("expired");
    return true;
  }

  handleSocketMessage(connection: RoomConnection, rawData: unknown) {
    if (typeof rawData !== "string") {
      connection.socket.close(1003, "unsupported-message");
      return;
    }

    let parsedJson: unknown;

    try {
      parsedJson = JSON.parse(rawData);
    } catch {
      connection.socket.close(1007, "invalid-json");
      return;
    }

    const parsedEnvelope = signalEnvelopeSchema.safeParse(parsedJson);

    if (!parsedEnvelope.success) {
      connection.socket.close(1008, "invalid-envelope");
      return;
    }

    const envelope = parsedEnvelope.data;

    if (
      envelope.roomId !== this.roomId ||
      envelope.sessionId !== connection.sessionId ||
      envelope.role !== connection.role
    ) {
      connection.socket.close(1008, "session-mismatch");
      return;
    }

    switch (envelope.messageType) {
      case "offer":
      case "answer":
      case "ice-candidate":
        this.relayToTarget(envelope, envelope.payload.targetSessionId);
        break;
      case "negotiation-failed":
        this.sourceState = "recovering";
        this.relayToTarget(envelope, envelope.payload.targetSessionId);
        this.broadcast(this.roomStateEnvelope());
        break;
      case "room-state":
        if (connection.role !== "host") {
          connection.socket.close(1008, "message-type-not-allowed");
          return;
        }
        this.sourceState = envelope.payload.sourceState;
        this.broadcast(this.roomStateEnvelope());
        break;
      case "heartbeat":
        if (connection.role === "host") {
          void this.renewRoomExpiry();
        }
        break;
      case "reconnect":
        break;
      default:
        connection.socket.close(1008, "message-type-not-allowed");
    }
  }

  private relayToTarget(envelope: SignalEnvelope, targetSessionId: string) {
    const target = this.findConnection(targetSessionId);

    if (!target) {
      const sender = this.findConnection(envelope.sessionId);
      if (sender && envelope.messageType !== "negotiation-failed") {
        this.send(
          sender,
          this.negotiationFailedEnvelope(
            sender.role,
            sender.sessionId,
            targetSessionId,
            "target-unavailable",
          ),
        );
      }
      return;
    }

    this.send(target, envelope);
  }

  private findConnection(sessionId: string): RoomConnection | null {
    if (this.hostConnection?.sessionId === sessionId) {
      return this.hostConnection;
    }

    return this.viewers.get(sessionId) ?? null;
  }

  private async closeRoom(reason: CloseReason) {
    if (this.isClosed()) {
      return;
    }

    this.closedAt = this.now();
    this.closedReason = reason;
    this.sourceState = "missing";

    if (reason === "host-left" || reason === "closed") {
      this.broadcast(this.hostLeftEnvelope("host-disconnected"));
      this.broadcast(this.roomClosedEnvelope(reason));
      this.broadcast(this.roomStateEnvelope());
    }

    const viewers = [...this.viewers.values()];
    this.viewers.clear();

    for (const viewer of viewers) {
      viewer.socket.close(1001, "room-closed");
    }

    await this.options.onPersist?.(this.getPersistedRecord());
    await this.options.onClose?.({
      closedAt: this.closedAt,
      reason,
    });
  }

  private async renewRoomExpiry() {
    const now = this.now();
    const renewedExpiresAt = Math.min(
      this.maxExpiresAt,
      Math.max(this.expiresAt, now + ROOM_RENEWAL_WINDOW_MS),
    );

    if (renewedExpiresAt === this.expiresAt) {
      return;
    }

    this.expiresAt = renewedExpiresAt;
    await this.options.onPersist?.(this.getPersistedRecord());
  }

  private broadcast(
    envelope: SignalEnvelope,
    predicate?: (connection: RoomConnection) => boolean,
  ) {
    if (this.hostConnection && (!predicate || predicate(this.hostConnection))) {
      this.send(this.hostConnection, envelope);
    }

    for (const viewer of this.viewers.values()) {
      if (!predicate || predicate(viewer)) {
        this.send(viewer, envelope);
      }
    }
  }

  private send(connection: RoomConnection, envelope: SignalEnvelope) {
    connection.socket.send(JSON.stringify(envelope));
  }

  private hostConnectedEnvelope(): SignalEnvelope {
    return signalEnvelopeSchema.parse({
      roomId: this.roomId,
      sessionId: this.hostSessionId,
      role: "host",
      messageType: "host-connected",
      timestamp: this.now(),
      payload: { viewerCount: this.viewers.size },
    });
  }

  private viewerPresenceEnvelope(
    messageType: "viewer-joined" | "viewer-left",
    viewerSessionId: string,
  ): SignalEnvelope {
    return signalEnvelopeSchema.parse({
      roomId: this.roomId,
      sessionId: viewerSessionId,
      role: "viewer",
      messageType,
      timestamp: this.now(),
      payload: { viewerSessionId },
    });
  }

  private hostLeftEnvelope(reason: string): SignalEnvelope {
    return signalEnvelopeSchema.parse({
      roomId: this.roomId,
      sessionId: this.hostSessionId,
      role: "host",
      messageType: "host-left",
      timestamp: this.now(),
      payload: { reason },
    });
  }

  private roomClosedEnvelope(reason: CloseReason): SignalEnvelope {
    const closedReason = reason === "closed" ? "closed" : reason;

    return signalEnvelopeSchema.parse({
      roomId: this.roomId,
      sessionId: this.hostSessionId,
      role: "host",
      messageType: "room-closed",
      timestamp: this.now(),
      payload: { reason: closedReason },
    });
  }

  private roomStateEnvelope(): SignalEnvelope {
    const snapshot = this.getStateSnapshot();

    return signalEnvelopeSchema.parse({
      roomId: this.roomId,
      sessionId: this.hostSessionId,
      role: "host",
      messageType: "room-state",
      timestamp: this.now(),
      payload: {
        state: snapshot.state,
        sourceState: snapshot.sourceState,
        viewerCount: snapshot.viewerCount,
      },
    });
  }

  private negotiationFailedEnvelope(
    role: SessionRole,
    sessionId: string,
    targetSessionId: string,
    code: string,
  ): SignalEnvelope {
    return signalEnvelopeSchema.parse({
      roomId: this.roomId,
      sessionId,
      role,
      messageType: "negotiation-failed",
      timestamp: this.now(),
      payload: { targetSessionId, code },
    });
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private getPersistedRecord(): PersistedRoomRecord {
    return {
      roomId: this.roomId,
      hostSessionId: this.hostSessionId,
      createdAt: this.createdAt,
      expiresAt: this.expiresAt,
      maxExpiresAt: this.maxExpiresAt,
      closedAt: this.closedAt,
      closedReason: this.closedReason,
    };
  }

  private isClosed(): boolean {
    return this.closedAt !== null || this.closedReason !== null;
  }

  private isExpired(): boolean {
    return this.now() >= this.expiresAt;
  }
}

export class RoomObject {
  private roomState: RoomState | null = null;
  private record: PersistedRoomRecord | null = null;
  private loaded = false;

  constructor(
    private readonly state: DurableObjectState,
    private readonly _env: CloudflareBindings,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/internal/initialize" && request.method === "POST") {
      const body = (await request.json()) as RoomInitialization;
      const record: PersistedRoomRecord = {
        ...body,
        closedAt: null,
        closedReason: null,
      };

      this.record = record;
      this.roomState = this.createRoomState(record);
      this.loaded = true;
      await this.state.storage.put(ROOM_RECORD_KEY, record);

      return Response.json(this.roomState.initialize());
    }

    const roomState = await this.ensureRoomState();

    if (!roomState) {
      return Response.json({ error: errorCodes.ROOM_NOT_FOUND }, { status: 404 });
    }

    if (url.pathname === "/internal/state" && request.method === "GET") {
      await roomState.expireIfNeeded();
      return Response.json(roomState.getStateSnapshot());
    }

    if (url.pathname === "/internal/join" && request.method === "POST") {
      const validation = roomState.validateViewerJoin();

      if (!validation.ok) {
        return Response.json(validation.body, { status: validation.status });
      }

      return Response.json(validation.snapshot);
    }

    if (url.pathname === "/internal/ws" && request.method === "GET") {
      return this.handleWebSocket(request, roomState);
    }

    return new Response("Not found", { status: 404 });
  }

  private async ensureRoomState(): Promise<RoomState | null> {
    if (this.roomState) {
      return this.roomState;
    }

    if (!this.loaded) {
      const storedRecord =
        (await this.state.storage.get<StoredRoomRecord>(ROOM_RECORD_KEY)) ?? null;
      this.record = storedRecord
        ? this.normalizePersistedRecord(storedRecord)
        : null;
      this.loaded = true;

      if (
        storedRecord &&
        this.record &&
        storedRecord.maxExpiresAt !== this.record.maxExpiresAt
      ) {
        await this.state.storage.put(ROOM_RECORD_KEY, this.record);
      }
    }

    if (!this.record) {
      return null;
    }

    this.roomState = this.createRoomState(this.record);

    return this.roomState;
  }

  private createRoomState(record: PersistedRoomRecord): RoomState {
    return new RoomState(record, {
      onPersist: async (nextRecord) => {
        this.record = nextRecord;
        await this.state.storage.put(ROOM_RECORD_KEY, nextRecord);
      },
    });
  }

  private normalizePersistedRecord(record: StoredRoomRecord): PersistedRoomRecord {
    const fallbackMaxExpiresAt = Math.max(
      record.expiresAt,
      record.createdAt + ROOM_MAX_LIFETIME_MS,
    );
    const persistedMaxExpiresAt =
      typeof record.maxExpiresAt === "number" &&
      Number.isFinite(record.maxExpiresAt)
        ? record.maxExpiresAt
        : null;
    const maxExpiresAt = persistedMaxExpiresAt !== null
      ? Math.max(persistedMaxExpiresAt, record.expiresAt)
      : fallbackMaxExpiresAt;

    return {
      ...record,
      maxExpiresAt,
    };
  }

  private handleWebSocket(request: Request, roomState: RoomState): Response {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected websocket upgrade", { status: 426 });
    }

    const roomId = request.headers.get("x-screenmate-room-id");
    const role = request.headers.get("x-screenmate-role") as SessionRole | null;
    const sessionId = request.headers.get("x-screenmate-session-id");

    if (!roomId || !role || !sessionId) {
      return Response.json({ error: errorCodes.ROOM_NOT_FOUND }, { status: 401 });
    }

    const validation =
      role === "viewer"
        ? roomState.validateViewerJoin()
        : { ok: true as const, snapshot: roomState.getStateSnapshot() };

    if (!validation.ok) {
      return Response.json(validation.body, { status: validation.status });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    const connection: RoomConnection = {
      roomId,
      role,
      sessionId,
      socket: server,
    };

    roomState.connectSession(connection);
    server.addEventListener("message", (event) => {
      roomState.handleSocketMessage(connection, event.data);
    });
    server.addEventListener("close", () => {
      roomState.disconnectSession(sessionId, role);
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }
}

function createNoopSocket(): ConnectionSocket {
  return {
    addEventListener() {},
    close() {},
    send() {},
  };
}
