import {
  errorCodes,
  roomChatMessageSchema,
  signalEnvelopeSchema,
  type RoomChatMessage,
  type RoomSourceState,
  type ViewerRosterEntry,
} from "@screenmate/shared";
import type { CloudflareBindings } from "../env.js";

type SessionRole = "host" | "viewer";
type RoomConnectionType = ViewerRosterEntry["connectionType"];
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

type ViewerProfileRecord = {
  viewerSessionId: string;
  displayName: string;
  joinedAt: number;
  profileUpdatedAt: number | null;
};

type ViewerMetricsRecord = {
  viewerSessionId: string;
  connectionType: RoomConnectionType;
  pingMs: number | null;
  metricsUpdatedAt: number;
};

type PersistedRoomActivity = {
  viewerProfiles: ViewerProfileRecord[];
  viewerMetrics: ViewerMetricsRecord[];
  chatMessages: RoomChatMessage[];
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
const ROOM_ACTIVITY_KEY = "room-activity";
const ROOM_RENEWAL_WINDOW_MS = 30 * 60 * 1_000;
const ROOM_MAX_LIFETIME_MS = 12 * 60 * 60 * 1_000;
const CHAT_HISTORY_LIMIT = 100;
const MAX_RETAINED_VIEWERS = 50;
const MIN_METRICS_INTERVAL_MS = 3_000;
const MIN_PROFILE_UPDATE_INTERVAL_MS = 1_000;
const MIN_CHAT_INTERVAL_MS = 500;

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
  private readonly viewerProfiles = new Map<string, ViewerProfileRecord>();
  private readonly viewerMetrics = new Map<string, ViewerMetricsRecord>();
  private readonly lastProfileUpdates = new Map<string, number>();
  private readonly lastMetricsUpdates = new Map<string, number>();
  private readonly lastChatMessages = new Map<string, number>();
  private chatMessages: RoomChatMessage[] = [];
  private activityPersistQueue = Promise.resolve();

  constructor(
    record: PersistedRoomRecord,
    private readonly options: {
      activity?: PersistedRoomActivity | null;
      now?: () => number;
      onClose?: (closure: {
        closedAt: number;
        reason: CloseReason;
      }) => void | Promise<void>;
      onPersist?: (record: PersistedRoomRecord) => void | Promise<void>;
      onPersistActivity?: (
        activity: PersistedRoomActivity,
      ) => void | Promise<void>;
    } = {},
  ) {
    this.roomId = record.roomId;
    this.hostSessionId = record.hostSessionId;
    this.createdAt = record.createdAt;
    this.expiresAt = record.expiresAt;
    this.maxExpiresAt = record.maxExpiresAt;
    this.closedAt = record.closedAt;
    this.closedReason = record.closedReason;

    for (const profile of this.options.activity?.viewerProfiles ?? []) {
      this.viewerProfiles.set(profile.viewerSessionId, profile);
    }
    for (const metrics of this.options.activity?.viewerMetrics ?? []) {
      this.viewerMetrics.set(metrics.viewerSessionId, metrics);
    }
    this.chatMessages = [...(this.options.activity?.chatMessages ?? [])].slice(
      -CHAT_HISTORY_LIMIT,
    );
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
      this.send(connection, this.viewerRosterEnvelope());
      this.send(connection, this.chatHistoryEnvelope());

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
    this.ensureViewerProfile(connection.sessionId);
    void this.persistActivity();
    this.send(connection, this.roomStateEnvelope());
    this.send(connection, this.viewerRosterEnvelope());
    this.send(connection, this.chatHistoryEnvelope());

    if (this.hostConnection) {
      this.send(connection, this.hostConnectedEnvelope());
    }

    this.broadcast(
      this.viewerPresenceEnvelope("viewer-joined", connection.sessionId),
      ({ sessionId }) => sessionId !== connection.sessionId,
    );
    this.broadcast(this.roomStateEnvelope());
    this.broadcast(this.viewerRosterEnvelope());
  }

  disconnectSession(connection: RoomConnection) {
    const { role, sessionId } = connection;

    if (role === "host") {
      if (this.hostConnection !== connection) {
        return;
      }

      this.hostConnection = null;
      void this.closeRoom("host-left");
      return;
    }

    if (this.viewers.get(sessionId) !== connection) {
      return;
    }

    this.viewers.delete(sessionId);
    this.broadcast(this.viewerPresenceEnvelope("viewer-left", sessionId));
    this.broadcast(this.roomStateEnvelope());
    this.broadcast(this.viewerRosterEnvelope());
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

  async handleSocketMessage(connection: RoomConnection, rawData: unknown) {
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

    if (isServerAuthoredActivityMessage(parsedJson)) {
      connection.socket.close(1008, "message-type-not-allowed");
      return;
    }

    if (isMismatchedViewerActivityMessage(parsedJson, connection)) {
      connection.socket.close(1008, "session-mismatch");
      return;
    }

    if (isEmptyChatMessage(parsedJson, connection)) {
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
      case "viewer-profile":
        if (
          connection.role !== "viewer" ||
          envelope.payload.viewerSessionId !== connection.sessionId
        ) {
          connection.socket.close(1008, "session-mismatch");
          return;
        }
        await this.updateViewerProfile(
          connection.sessionId,
          envelope.payload.displayName,
        );
        break;
      case "viewer-metrics":
        if (
          connection.role !== "viewer" ||
          envelope.payload.viewerSessionId !== connection.sessionId
        ) {
          connection.socket.close(1008, "session-mismatch");
          return;
        }
        await this.updateViewerMetrics(connection.sessionId, {
          connectionType: envelope.payload.connectionType,
          pingMs: envelope.payload.pingMs ?? null,
        });
        break;
      case "chat-message":
        await this.appendChatMessage(connection, envelope.payload.text);
        break;
      case "viewer-roster":
      case "chat-history":
      case "chat-message-created":
        connection.socket.close(1008, "message-type-not-allowed");
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

  private ensureViewerProfile(viewerSessionId: string) {
    const existing = this.viewerProfiles.get(viewerSessionId);
    if (existing) {
      return existing;
    }

    const profile = {
      viewerSessionId,
      displayName: defaultViewerName(viewerSessionId),
      joinedAt: this.now(),
      profileUpdatedAt: null,
    };
    this.viewerProfiles.set(viewerSessionId, profile);
    this.pruneRetainedViewers();
    return profile;
  }

  private getViewerRoster(): ViewerRosterEntry[] {
    return [...this.viewerProfiles.values()].map((profile) => {
      const metrics = this.viewerMetrics.get(profile.viewerSessionId);
      return {
        viewerSessionId: profile.viewerSessionId,
        displayName: profile.displayName,
        online: this.viewers.has(profile.viewerSessionId),
        connectionType: metrics?.connectionType ?? "unknown",
        pingMs: metrics?.pingMs ?? null,
        joinedAt: profile.joinedAt,
        profileUpdatedAt: profile.profileUpdatedAt,
        metricsUpdatedAt: metrics?.metricsUpdatedAt ?? null,
      };
    });
  }

  private async updateViewerProfile(
    viewerSessionId: string,
    displayName: string,
  ) {
    const now = this.now();
    const lastUpdatedAt = this.lastProfileUpdates.get(viewerSessionId);
    if (
      lastUpdatedAt !== undefined &&
      now - lastUpdatedAt < MIN_PROFILE_UPDATE_INTERVAL_MS
    ) {
      return;
    }

    const current = this.ensureViewerProfile(viewerSessionId);
    this.viewerProfiles.set(viewerSessionId, {
      ...current,
      displayName: displayName.trim(),
      profileUpdatedAt: now,
    });
    this.lastProfileUpdates.set(viewerSessionId, now);
    await this.persistActivity();
    this.broadcast(this.viewerRosterEnvelope());
  }

  private async updateViewerMetrics(
    viewerSessionId: string,
    metrics: {
      connectionType: RoomConnectionType;
      pingMs: number | null;
    },
  ) {
    const now = this.now();
    const lastUpdatedAt = this.lastMetricsUpdates.get(viewerSessionId);
    if (
      lastUpdatedAt !== undefined &&
      now - lastUpdatedAt < MIN_METRICS_INTERVAL_MS
    ) {
      return;
    }

    this.ensureViewerProfile(viewerSessionId);
    this.viewerMetrics.set(viewerSessionId, {
      viewerSessionId,
      connectionType: metrics.connectionType,
      pingMs: metrics.pingMs,
      metricsUpdatedAt: now,
    });
    this.lastMetricsUpdates.set(viewerSessionId, now);
    await this.persistActivity();
    this.broadcast(this.viewerRosterEnvelope());
  }

  private async appendChatMessage(connection: RoomConnection, text: string) {
    const normalizedText = text.trim();
    if (!normalizedText) {
      return;
    }

    const now = this.now();
    const lastSentAt = this.lastChatMessages.get(connection.sessionId);
    if (
      connection.role === "viewer" &&
      lastSentAt !== undefined &&
      now - lastSentAt < MIN_CHAT_INTERVAL_MS
    ) {
      return;
    }

    const message: RoomChatMessage = {
      messageId: crypto.randomUUID(),
      senderSessionId: connection.sessionId,
      senderRole: connection.role,
      senderName:
        connection.role === "host"
          ? "Host"
          : this.ensureViewerProfile(connection.sessionId).displayName,
      text: normalizedText,
      sentAt: now,
    };

    this.lastChatMessages.set(connection.sessionId, now);
    this.chatMessages = [...this.chatMessages, message].slice(-CHAT_HISTORY_LIMIT);
    await this.persistActivity();
    this.broadcast(this.chatMessageCreatedEnvelope(message));
  }

  private getPersistedActivity(): PersistedRoomActivity {
    return {
      viewerProfiles: [...this.viewerProfiles.values()],
      viewerMetrics: [...this.viewerMetrics.values()],
      chatMessages: this.chatMessages,
    };
  }

  private persistActivity() {
    this.activityPersistQueue = this.activityPersistQueue
      .catch(() => undefined)
      .then(() => this.options.onPersistActivity?.(this.getPersistedActivity()));
    return this.activityPersistQueue;
  }

  private pruneRetainedViewers() {
    if (this.viewerProfiles.size <= MAX_RETAINED_VIEWERS) {
      return;
    }

    const offlineProfiles = [...this.viewerProfiles.values()]
      .filter((profile) => !this.viewers.has(profile.viewerSessionId))
      .sort((left, right) => left.joinedAt - right.joinedAt);
    const removableCount = this.viewerProfiles.size - MAX_RETAINED_VIEWERS;

    for (const profile of offlineProfiles.slice(0, removableCount)) {
      this.viewerProfiles.delete(profile.viewerSessionId);
      this.viewerMetrics.delete(profile.viewerSessionId);
      this.lastProfileUpdates.delete(profile.viewerSessionId);
      this.lastMetricsUpdates.delete(profile.viewerSessionId);
      this.lastChatMessages.delete(profile.viewerSessionId);
    }
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

  private viewerRosterEnvelope(): SignalEnvelope {
    return signalEnvelopeSchema.parse({
      roomId: this.roomId,
      sessionId: this.hostSessionId,
      role: "host",
      messageType: "viewer-roster",
      timestamp: this.now(),
      payload: { viewers: this.getViewerRoster() },
    });
  }

  private chatHistoryEnvelope(): SignalEnvelope {
    return signalEnvelopeSchema.parse({
      roomId: this.roomId,
      sessionId: this.hostSessionId,
      role: "host",
      messageType: "chat-history",
      timestamp: this.now(),
      payload: { messages: this.chatMessages },
    });
  }

  private chatMessageCreatedEnvelope(message: RoomChatMessage): SignalEnvelope {
    return signalEnvelopeSchema.parse({
      roomId: this.roomId,
      sessionId: this.hostSessionId,
      role: "host",
      messageType: "chat-message-created",
      timestamp: message.sentAt,
      payload: message,
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
  private activity: PersistedRoomActivity | null = null;
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
      this.activity = {
        viewerProfiles: [],
        viewerMetrics: [],
        chatMessages: [],
      };
      this.roomState = this.createRoomState(record);
      this.loaded = true;
      await this.state.storage.put(ROOM_RECORD_KEY, record);
      await this.state.storage.put(ROOM_ACTIVITY_KEY, this.activity);

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
      this.activity = normalizePersistedActivity(
        await this.state.storage.get<unknown>(ROOM_ACTIVITY_KEY),
      );
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
      activity: this.activity,
      onPersist: async (nextRecord) => {
        this.record = nextRecord;
        await this.state.storage.put(ROOM_RECORD_KEY, nextRecord);
      },
      onPersistActivity: async (nextActivity) => {
        this.activity = nextActivity;
        await this.state.storage.put(ROOM_ACTIVITY_KEY, nextActivity);
      },
      onClose: async () => {
        this.activity = null;
        await this.state.storage.delete(ROOM_ACTIVITY_KEY);
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
      void roomState
        .handleSocketMessage(connection, event.data)
        .catch(() => connection.socket.close(1011, "message-handler-failed"));
    });
    server.addEventListener("close", () => {
      roomState.disconnectSession(connection);
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

function defaultViewerName(viewerSessionId: string) {
  return `Viewer ${viewerSessionId.slice(-4)}`;
}

function isServerAuthoredActivityMessage(value: unknown) {
  if (!value || typeof value !== "object") {
    return false;
  }

  const messageType = (value as { messageType?: unknown }).messageType;
  return (
    messageType === "viewer-roster" ||
    messageType === "chat-history" ||
    messageType === "chat-message-created"
  );
}

function isMismatchedViewerActivityMessage(
  value: unknown,
  connection: RoomConnection,
) {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as {
    messageType?: unknown;
    payload?: { viewerSessionId?: unknown };
  };

  if (
    candidate.messageType !== "viewer-profile" &&
    candidate.messageType !== "viewer-metrics"
  ) {
    return false;
  }

  return (
    connection.role !== "viewer" ||
    candidate.payload?.viewerSessionId !== connection.sessionId
  );
}

function isEmptyChatMessage(value: unknown, connection: RoomConnection) {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as {
    roomId?: unknown;
    sessionId?: unknown;
    role?: unknown;
    messageType?: unknown;
    payload?: { text?: unknown };
  };

  return (
    candidate.roomId === connection.roomId &&
    candidate.sessionId === connection.sessionId &&
    candidate.role === connection.role &&
    candidate.messageType === "chat-message" &&
    typeof candidate.payload?.text === "string" &&
    candidate.payload.text.trim() === ""
  );
}

function normalizePersistedActivity(value: unknown): PersistedRoomActivity {
  if (!value || typeof value !== "object") {
    return { viewerProfiles: [], viewerMetrics: [], chatMessages: [] };
  }

  const record = value as Partial<PersistedRoomActivity>;
  return {
    viewerProfiles: Array.isArray(record.viewerProfiles)
      ? record.viewerProfiles.flatMap((profile) => {
          if (!profile || typeof profile !== "object") {
            return [];
          }

          const candidate = profile as Partial<ViewerProfileRecord>;
          const viewerSessionId =
            typeof candidate.viewerSessionId === "string"
              ? candidate.viewerSessionId.trim()
              : "";
          const displayName =
            typeof candidate.displayName === "string"
              ? candidate.displayName.trim()
              : "";

          if (!viewerSessionId || !displayName) {
            return [];
          }

          return [
            {
              viewerSessionId,
              displayName: displayName.slice(0, 80),
              joinedAt:
                typeof candidate.joinedAt === "number" && candidate.joinedAt >= 0
                  ? Math.trunc(candidate.joinedAt)
                  : 0,
              profileUpdatedAt:
                typeof candidate.profileUpdatedAt === "number" &&
                candidate.profileUpdatedAt >= 0
                  ? Math.trunc(candidate.profileUpdatedAt)
                  : null,
            },
          ];
        })
      : [],
    viewerMetrics: Array.isArray(record.viewerMetrics)
      ? record.viewerMetrics.flatMap((metrics) => {
          if (!metrics || typeof metrics !== "object") {
            return [];
          }

          const candidate = metrics as Partial<ViewerMetricsRecord>;
          const viewerSessionId =
            typeof candidate.viewerSessionId === "string"
              ? candidate.viewerSessionId.trim()
              : "";

          if (
            !viewerSessionId ||
            (candidate.connectionType !== "direct" &&
              candidate.connectionType !== "relay" &&
              candidate.connectionType !== "unknown") ||
            typeof candidate.metricsUpdatedAt !== "number" ||
            candidate.metricsUpdatedAt < 0
          ) {
            return [];
          }

          return [
            {
              viewerSessionId,
              connectionType: candidate.connectionType,
              pingMs:
                typeof candidate.pingMs === "number" && candidate.pingMs >= 0
                  ? Math.trunc(candidate.pingMs)
                  : null,
              metricsUpdatedAt: Math.trunc(candidate.metricsUpdatedAt),
            },
          ];
        })
      : [],
    chatMessages: Array.isArray(record.chatMessages)
      ? record.chatMessages
          .flatMap((message) => {
            const parsed = roomChatMessageSchema.safeParse(message);
            return parsed.success ? [parsed.data] : [];
          })
          .slice(-CHAT_HISTORY_LIMIT)
      : [],
  };
}
