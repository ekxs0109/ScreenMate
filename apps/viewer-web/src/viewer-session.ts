import { errorCodes, signalEnvelopeSchema } from "@screenmate/shared";
import { viewerErrorCodes } from "./viewer-errors";
import {
  getRoomState,
  joinRoom,
  type JoinRoomResponse,
  type RoomApiError,
} from "./lib/api";
import { createLogger } from "./lib/logger";
import {
  createViewerPeerConnection,
  type PeerConnectionLike,
} from "./lib/peer-client";
import {
  initialViewerSessionState,
  type ViewerSessionState,
} from "./lib/session-state";
import {
  createSocketClient,
  redactUrlToken,
  type CreateWebSocket,
  type SignalEnvelope,
} from "./lib/socket-client";
import type { ViewerErrorCode } from "./viewer-errors";

const viewerSessionLogger = createLogger("viewer:session");
const maxDisplayNameLength = 80;
const maxChatMessageLength = 500;
const viewerRoomStoragePrefix = "screenmate.viewerSession.";
const directConnectivityFailureGraceMs = 1_500;

type StoredViewerRoomSession = {
  displayName: string;
  sessionId: string;
  viewerToken: string;
};

type ViewerSessionOptions = {
  apiBaseUrl: string;
  initialDisplayName: string;
  metricsIntervalMs?: number;
  fetchFn?: typeof fetch;
  createWebSocket?: CreateWebSocket;
  createPeerConnection?: (config: RTCConfiguration) => PeerConnectionLike;
  connectionFailureGraceMs?: number;
  now?: () => number;
};

export class ViewerSession {
  private snapshot: ViewerSessionState = initialViewerSessionState;
  private readonly listeners = new Set<(snapshot: ViewerSessionState) => void>();
  private socketClient: ReturnType<typeof createSocketClient> | null = null;
  private peerClient: ReturnType<typeof createViewerPeerConnection> | null = null;
  private joinResponse: JoinRoomResponse | null = null;
  private metricsTimer: ReturnType<typeof setInterval> | null = null;
  private connectionFailureTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;

  constructor(private readonly options: ViewerSessionOptions) {}

  getSnapshot() {
    return this.snapshot;
  }

  subscribe(listener: (snapshot: ViewerSessionState) => void) {
    this.listeners.add(listener);
    listener(this.snapshot);

    return () => {
      this.listeners.delete(listener);
    };
  }

  async join(roomId: string, password = "") {
    viewerSessionLogger.info("Viewer is joining a room.", {
      apiBaseUrl: this.options.apiBaseUrl,
      roomId,
    });
    const storedViewerRoomSession = readStoredViewerRoomSession(roomId);
    const displayName =
      normalizeDisplayName(this.snapshot.displayName) ||
      normalizeDisplayName(storedViewerRoomSession?.displayName ?? "") ||
      normalizeDisplayName(this.options.initialDisplayName) ||
      "";
    const generation = this.nextGeneration();
    this.teardown(false, false);
    this.update({
      ...initialViewerSessionState,
      displayName,
      roomId,
      status: "joining",
    });

    try {
      const roomState = await getRoomState(
        this.options.apiBaseUrl,
        roomId,
        this.options.fetchFn,
      );
      if (!this.isCurrentGeneration(generation)) {
        return;
      }

      viewerSessionLogger.info("Viewer loaded room state.", {
        hostConnected: roomState.hostConnected,
        hostSessionId: roomState.hostSessionId,
        roomId,
        roomState: roomState.state,
        viewerCount: roomState.viewerCount,
      });

      if (roomState.state === "closed") {
        viewerSessionLogger.warn("Viewer found the room already closed.", {
          roomId,
        });
        this.update({
          ...initialViewerSessionState,
          displayName: this.snapshot.displayName,
          roomId,
          roomState: roomState.state,
          sourceState: roomState.sourceState,
          status: "ended",
          endedReasonCode: viewerErrorCodes.ROOM_ALREADY_CLOSED,
        });
        return;
      }

      const joined = await joinRoom(
        this.options.apiBaseUrl,
        roomId,
        password,
        storedViewerRoomSession?.viewerToken ?? null,
        this.options.fetchFn,
      );
      if (!this.isCurrentGeneration(generation)) {
        return;
      }

      viewerSessionLogger.info("Viewer joined the room signaling session.", {
        iceServerCount: joined.iceServers.length,
        roomId: joined.roomId,
        sessionId: joined.sessionId,
        wsUrl: redactUrlToken(joined.wsUrl),
      });

      this.update({
        roomId: joined.roomId,
        sessionId: joined.sessionId,
        viewerToken: joined.viewerToken,
        hostSessionId: roomState.hostSessionId,
        roomState: roomState.state,
        sourceState: roomState.sourceState,
        status: "waiting",
        errorCode: null,
        endedReasonCode: null,
        remoteStream: null,
        displayName: this.snapshot.displayName,
      });
      persistStoredViewerRoomSession(joined.roomId, {
        displayName: this.snapshot.displayName,
        sessionId: joined.sessionId,
        viewerToken: joined.viewerToken,
      });

      this.joinResponse = joined;

      let socketClient: ReturnType<typeof createSocketClient>;
      socketClient = createSocketClient(joined.wsUrl, joined.viewerToken, {
        createWebSocket: this.options.createWebSocket,
        onOpen: () => {
          if (!this.isCurrentSocket(generation, joined, socketClient)) {
            return;
          }

          viewerSessionLogger.info("Viewer signaling channel is ready.", {
            roomId: joined.roomId,
            sessionId: joined.sessionId,
          });
          this.update({
            status: "waiting",
            errorCode: null,
          });
          this.sendViewerProfile();
          this.startMetricsTimer();
        },
        onClose: (event) => {
          if (!this.isCurrentSocket(generation, joined, socketClient)) {
            return;
          }

          viewerSessionLogger.warn("Viewer signaling channel closed.", {
            code: "code" in event ? event.code : null,
            reason: event.reason ?? null,
            roomId: joined.roomId,
            sessionId: joined.sessionId,
          });
          this.stopMetricsTimer();
          if (
            this.snapshot.status !== "ended" &&
            this.snapshot.status !== "error"
          ) {
            this.update({
              status: "ended",
              endedReasonCode: viewerErrorCodes.ROOM_CONNECTION_CLOSED,
            });
          }
        },
        onError: () => {
          if (!this.isCurrentSocket(generation, joined, socketClient)) {
            return;
          }

          viewerSessionLogger.error("Viewer signaling channel failed.", {
            roomId: joined.roomId,
            sessionId: joined.sessionId,
          });
          this.stopMetricsTimer();
          this.update({
            status: "error",
            errorCode: viewerErrorCodes.SIGNALING_FAILED,
          });
        },
        onMessage: (message) => {
          if (!this.isCurrentSocket(generation, joined, socketClient)) {
            return;
          }

          void this.handleSignal(message, generation, joined, socketClient);
        },
      });
      this.socketClient = socketClient;
      this.peerClient = this.createPeerClient(joined, generation, socketClient);
    } catch (error) {
      if (!this.isCurrentGeneration(generation)) {
        return;
      }

      const apiError = error as Partial<RoomApiError>;
      const code =
        typeof apiError.code === "string"
          ? apiError.code
          : viewerErrorCodes.ROOM_JOIN_FAILED;

      viewerSessionLogger.error("Viewer room join failed.", {
        code,
        details: apiError.details ?? null,
        error: error instanceof Error ? error.message : code,
        roomId,
        status: apiError.status ?? null,
      });
      this.update({
        ...initialViewerSessionState,
        displayName: this.snapshot.displayName,
        roomId,
        status:
          code === errorCodes.ROOM_EXPIRED ||
          code === viewerErrorCodes.ROOM_ALREADY_CLOSED
            ? "ended"
            : "error",
        errorCode:
          code === errorCodes.ROOM_EXPIRED ||
          code === viewerErrorCodes.ROOM_ALREADY_CLOSED
            ? null
            : (code as ViewerErrorCode),
        endedReasonCode:
          code === errorCodes.ROOM_EXPIRED ||
          code === viewerErrorCodes.ROOM_ALREADY_CLOSED
            ? (code as ViewerErrorCode)
            : null,
      });
    }
  }

  destroy() {
    this.teardown(true);
  }

  updateDisplayName(displayName: string) {
    const trimmedDisplayName = normalizeDisplayName(displayName);

    if (!trimmedDisplayName) {
      return;
    }

    this.update({ displayName: trimmedDisplayName });
    this.persistCurrentViewerRoomSession();
    this.sendViewerProfile();
  }

  sendChatMessage(text: string) {
    const trimmedText = normalizeChatMessage(text);

    if (!trimmedText || !this.joinResponse || !this.socketClient) {
      return false;
    }

    return this.socketClient.send(
      signalEnvelopeSchema.parse({
        roomId: this.joinResponse.roomId,
        sessionId: this.joinResponse.sessionId,
        timestamp: this.now(),
        role: "viewer",
        messageType: "chat-message",
        payload: {
          text: trimmedText,
        },
      }),
    );
  }

  private createPeerClient(
    joined: JoinRoomResponse,
    generation: number,
    socketClient: ReturnType<typeof createSocketClient>,
  ) {
    const peerClient = createViewerPeerConnection({
      iceServers: joined.iceServers,
      sessionId: joined.sessionId,
      roomId: joined.roomId,
      getTargetSessionId: () => this.snapshot.hostSessionId,
      sendSignal: (message) => {
        if (!this.isCurrentSocket(generation, joined, socketClient)) {
          return false;
        }

        return socketClient.send(message);
      },
      onRemoteStream: (stream) => {
        viewerSessionLogger.info("Viewer received a remote stream.", {
          roomId: joined.roomId,
          sessionId: joined.sessionId,
          streamId: typeof stream.id === "string" ? stream.id : null,
        });

        if (
          this.peerClient !== peerClient ||
          !this.isCurrentSocket(generation, joined, socketClient)
        ) {
          return;
        }

        this.cancelConnectionFailureError();
        this.update({
          remoteStream: stream,
          sourceState: "attached",
          status: "connected",
          errorCode: null,
          endedReasonCode: null,
        });
        void this.sendViewerMetrics();
      },
      onConnectionStateChange: (state) => {
        viewerSessionLogger.info("Viewer peer connection state changed.", {
          roomId: joined.roomId,
          sessionId: joined.sessionId,
          state,
        });

        if (
          this.peerClient !== peerClient ||
          !this.isCurrentSocket(generation, joined, socketClient)
        ) {
          return;
        }

        if (state === "connected") {
          this.cancelConnectionFailureError();
        }

        if (state === "failed") {
          this.scheduleConnectionFailureError(peerClient, generation, joined, socketClient);
        }

        if (state === "disconnected") {
          viewerSessionLogger.warn("Viewer peer connection disconnected.", {
            roomId: joined.roomId,
            sessionId: joined.sessionId,
            state,
          });
        }

        if (state === "closed") {
          viewerSessionLogger.warn("Viewer peer connection closed.", {
            roomId: joined.roomId,
            sessionId: joined.sessionId,
          });
        }
      },
      createPeerConnection: this.options.createPeerConnection,
    });

    return peerClient;
  }

  private async handleSignal(
    message: SignalEnvelope,
    generation: number,
    joined: JoinRoomResponse,
    socketClient: ReturnType<typeof createSocketClient>,
  ) {
    if (!this.isCurrentSocket(generation, joined, socketClient)) {
      return;
    }

    viewerSessionLogger.debug("Viewer received a signaling message.", {
      messageType: message.messageType,
      roomId: message.roomId,
      sessionId: message.sessionId,
    });
    switch (message.messageType) {
      case "host-connected":
        viewerSessionLogger.info("Viewer learned that the host signaling session is connected.", {
          hostSessionId: message.sessionId,
          roomId: message.roomId,
        });
        this.update({ hostSessionId: message.sessionId });
        break;
      case "offer":
        viewerSessionLogger.info("Viewer received a host offer.", {
          hostSessionId: message.sessionId,
          roomId: message.roomId,
          targetSessionId: message.payload.targetSessionId,
        });
        this.cancelConnectionFailureError();
        const previousPeerClient = this.peerClient;
        this.peerClient = null;
        previousPeerClient?.close();
        if (!this.isCurrentSocket(generation, joined, socketClient)) {
          break;
        }

        if (!this.joinResponse) {
          viewerSessionLogger.warn("Viewer ignored an offer before join state was ready.", {
            hostSessionId: message.sessionId,
            roomId: message.roomId,
          });
          break;
        }
        this.peerClient = this.createPeerClient(joined, generation, socketClient);
        this.update({
          hostSessionId: message.sessionId,
          sourceState: "attached",
          status: "connecting",
          roomState: "streaming",
          errorCode: null,
          endedReasonCode: null,
        });
        await this.peerClient?.acceptOffer(message.sessionId, message.payload.sdp);
        break;
      case "ice-candidate":
        if (
          message.payload.targetSessionId === this.snapshot.sessionId &&
          this.isCurrentSocket(generation, joined, socketClient)
        ) {
          viewerSessionLogger.debug("Viewer received a remote ICE candidate.", {
            roomId: message.roomId,
            sessionId: message.sessionId,
            targetSessionId: message.payload.targetSessionId,
          });
          await this.peerClient?.addIceCandidate(
            message.payload.candidate,
            message.payload.sdpMid,
            message.payload.sdpMLineIndex,
          );
        }
        break;
      case "room-state":
        viewerSessionLogger.info("Viewer received a room state update.", {
          roomId: message.roomId,
          roomState: message.payload.state,
          sourceState: message.payload.sourceState,
          viewerCount: message.payload.viewerCount,
        });
        this.cancelConnectionFailureError();
        this.update({
          roomState: message.payload.state,
          sourceState: message.payload.sourceState,
          status:
            message.payload.state === "closed"
              ? "ended"
              : message.payload.sourceState === "attached" &&
                  this.snapshot.remoteStream
                ? "connected"
                : "waiting",
        });
        if (message.payload.state === "closed") {
          this.update({
            endedReasonCode: viewerErrorCodes.HOST_ENDED_ROOM,
          });
          this.teardown(false);
        }
        break;
      case "viewer-roster":
        this.update({
          viewerRoster: message.payload.viewers,
        });
        break;
      case "chat-history":
        this.update({
          chatMessages: message.payload.messages,
        });
        break;
      case "chat-message-created":
        this.update({
          chatMessages: appendChatMessage(this.snapshot.chatMessages, message.payload),
        });
        break;
      case "host-left":
      case "room-closed":
        viewerSessionLogger.warn("Viewer received room termination from signaling.", {
          messageType: message.messageType,
          reason: message.payload.reason,
          roomId: message.roomId,
        });
        this.update({
          status: "ended",
          endedReasonCode: viewerErrorCodes.HOST_ENDED_ROOM,
          roomState: "closed",
        });
        this.teardown(false);
        break;
      case "negotiation-failed":
        if (message.payload.targetSessionId === this.snapshot.sessionId) {
          viewerSessionLogger.error("Viewer negotiation failed.", {
            code: message.payload.code,
            roomId: message.roomId,
            sessionId: message.sessionId,
            targetSessionId: message.payload.targetSessionId,
          });
          this.update({
            status: "error",
            errorCode: toNegotiationError(message.payload.code),
          });
        }
        break;
      default:
        break;
    }
  }

  private teardown(resetSnapshot: boolean, invalidate = true) {
    if (invalidate) {
      this.nextGeneration();
    }

    viewerSessionLogger.info("Tearing down viewer session resources.", {
      resetSnapshot,
      roomId: this.snapshot.roomId,
      sessionId: this.snapshot.sessionId,
      status: this.snapshot.status,
    });
    this.cancelConnectionFailureError();
    this.stopMetricsTimer();
    const socketClient = this.socketClient;
    this.socketClient = null;
    socketClient?.close();
    const peerClient = this.peerClient;
    this.peerClient = null;
    peerClient?.close();
    this.joinResponse = null;

    if (resetSnapshot) {
      const displayName =
        normalizeDisplayName(this.snapshot.displayName) ||
        normalizeDisplayName(this.options.initialDisplayName) ||
        "";
      this.snapshot = {
        ...initialViewerSessionState,
        displayName,
      };
      this.emit();
    }
  }

  private update(patch: Partial<ViewerSessionState> | ViewerSessionState) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.emit();
  }

  private scheduleConnectionFailureError(
    peerClient: ReturnType<typeof createViewerPeerConnection>,
    generation: number,
    joined: JoinRoomResponse,
    socketClient: ReturnType<typeof createSocketClient>,
  ) {
    this.cancelConnectionFailureError();
    const graceMs =
      this.options.connectionFailureGraceMs ?? directConnectivityFailureGraceMs;

    viewerSessionLogger.warn("Viewer peer connectivity failed; waiting briefly for reoffer.", {
      graceMs,
      roomId: joined.roomId,
      sessionId: joined.sessionId,
    });

    this.connectionFailureTimer = setTimeout(() => {
      this.connectionFailureTimer = null;
      if (
        this.peerClient !== peerClient ||
        !this.isCurrentSocket(generation, joined, socketClient)
      ) {
        return;
      }

      viewerSessionLogger.error("Viewer peer connectivity failed.", {
        roomId: joined.roomId,
        sessionId: joined.sessionId,
        state: "failed",
      });
      this.update({
        status: "error",
        errorCode: errorCodes.DIRECT_CONNECTIVITY_FAILED,
      });
    }, graceMs);
  }

  private cancelConnectionFailureError() {
    if (!this.connectionFailureTimer) {
      return;
    }

    clearTimeout(this.connectionFailureTimer);
    this.connectionFailureTimer = null;
  }

  private persistCurrentViewerRoomSession() {
    if (
      !this.snapshot.roomId ||
      !this.snapshot.sessionId ||
      !this.snapshot.viewerToken
    ) {
      return;
    }

    persistStoredViewerRoomSession(this.snapshot.roomId, {
      displayName: this.snapshot.displayName,
      sessionId: this.snapshot.sessionId,
      viewerToken: this.snapshot.viewerToken,
    });
  }

  private emit() {
    for (const listener of this.listeners) {
      listener(this.snapshot);
    }
  }

  private sendViewerProfile() {
    const displayName = normalizeDisplayName(this.snapshot.displayName);

    if (
      !this.joinResponse ||
      !this.socketClient ||
      !displayName
    ) {
      return false;
    }

    return this.socketClient.send(
      signalEnvelopeSchema.parse({
        roomId: this.joinResponse.roomId,
        sessionId: this.joinResponse.sessionId,
        timestamp: this.now(),
        role: "viewer",
        messageType: "viewer-profile",
        payload: {
          viewerSessionId: this.joinResponse.sessionId,
          displayName,
        },
      }),
    );
  }

  private startMetricsTimer() {
    this.stopMetricsTimer();
    void this.sendViewerMetrics();
    this.metricsTimer = setInterval(() => {
      void this.sendViewerMetrics();
    }, this.options.metricsIntervalMs ?? 5000);
  }

  private stopMetricsTimer() {
    if (!this.metricsTimer) {
      return;
    }

    clearInterval(this.metricsTimer);
    this.metricsTimer = null;
  }

  private async sendViewerMetrics() {
    if (!this.joinResponse || !this.socketClient || !this.peerClient) {
      return false;
    }

    const joined = this.joinResponse;
    const socketClient = this.socketClient;
    const generation = this.generation;

    try {
      const metrics = await this.peerClient.collectMetrics();

      if (!this.isCurrentSocket(generation, joined, socketClient)) {
        return false;
      }

      this.update({
        localConnectionType: metrics.connectionType,
        localPingMs: metrics.pingMs,
        localVideoCodec: metrics.videoCodec ?? this.snapshot.localVideoCodec,
      });

      return socketClient.send(
        signalEnvelopeSchema.parse({
          roomId: joined.roomId,
          sessionId: joined.sessionId,
          timestamp: this.now(),
          role: "viewer",
          messageType: "viewer-metrics",
          payload: {
            viewerSessionId: joined.sessionId,
            connectionType: metrics.connectionType,
            pingMs: metrics.pingMs,
          },
        }),
      );
    } catch (error) {
      viewerSessionLogger.warn("Viewer metrics collection failed.", {
        error: error instanceof Error ? error.message : "Unknown error",
        roomId: joined.roomId,
        sessionId: joined.sessionId,
      });
      return false;
    }
  }

  private now() {
    return this.options.now?.() ?? Date.now();
  }

  private nextGeneration() {
    this.generation += 1;
    return this.generation;
  }

  private isCurrentGeneration(generation: number) {
    return this.generation === generation;
  }

  private isCurrentSocket(
    generation: number,
    joined: JoinRoomResponse,
    socketClient: ReturnType<typeof createSocketClient>,
  ) {
    return (
      this.isCurrentGeneration(generation) &&
      this.joinResponse === joined &&
      this.socketClient === socketClient
    );
  }
}

function normalizeDisplayName(displayName: string) {
  return displayName.trim().slice(0, maxDisplayNameLength);
}

function normalizeChatMessage(text: string) {
  return text.trim().slice(0, maxChatMessageLength);
}

function readStoredViewerRoomSession(
  roomId: string,
): StoredViewerRoomSession | null {
  const storage = getSessionStorage();
  if (!storage) {
    return null;
  }

  try {
    const rawValue = storage.getItem(toViewerRoomStorageKey(roomId));
    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue) as Partial<StoredViewerRoomSession>;
    if (
      typeof parsed.displayName !== "string" ||
      typeof parsed.sessionId !== "string" ||
      typeof parsed.viewerToken !== "string"
    ) {
      return null;
    }

    return {
      displayName: normalizeDisplayName(parsed.displayName),
      sessionId: parsed.sessionId,
      viewerToken: parsed.viewerToken,
    };
  } catch {
    return null;
  }
}

function persistStoredViewerRoomSession(
  roomId: string,
  session: StoredViewerRoomSession,
) {
  const storage = getSessionStorage();
  const displayName = normalizeDisplayName(session.displayName);
  if (!storage || !displayName || !session.sessionId || !session.viewerToken) {
    return;
  }

  storage.setItem(
    toViewerRoomStorageKey(roomId),
    JSON.stringify({
      displayName,
      sessionId: session.sessionId,
      viewerToken: session.viewerToken,
    }),
  );
}

function toViewerRoomStorageKey(roomId: string) {
  return `${viewerRoomStoragePrefix}${roomId}`;
}

function getSessionStorage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

function appendChatMessage(
  messages: ViewerSessionState["chatMessages"],
  message: ViewerSessionState["chatMessages"][number],
) {
  const dedupedMessages = messages.filter(
    (existingMessage) => existingMessage.messageId !== message.messageId,
  );

  return [...dedupedMessages, message];
}

function toNegotiationError(code: string) {
  if (code === errorCodes.DIRECT_CONNECTIVITY_FAILED) {
    return errorCodes.DIRECT_CONNECTIVITY_FAILED;
  }

  return errorCodes.NEGOTIATION_FAILED;
}
