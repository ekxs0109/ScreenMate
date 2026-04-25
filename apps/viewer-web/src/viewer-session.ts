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
  type CreateWebSocket,
  type SignalEnvelope,
} from "./lib/socket-client";
import type { ViewerErrorCode } from "./viewer-errors";

const viewerSessionLogger = createLogger("viewer:session");

type ViewerSessionOptions = {
  apiBaseUrl: string;
  initialDisplayName?: string;
  metricsIntervalMs?: number;
  fetchFn?: typeof fetch;
  createWebSocket?: CreateWebSocket;
  createPeerConnection?: (config: RTCConfiguration) => PeerConnectionLike;
  now?: () => number;
};

export class ViewerSession {
  private snapshot: ViewerSessionState = initialViewerSessionState;
  private readonly listeners = new Set<(snapshot: ViewerSessionState) => void>();
  private socketClient: ReturnType<typeof createSocketClient> | null = null;
  private peerClient: ReturnType<typeof createViewerPeerConnection> | null = null;
  private joinResponse: JoinRoomResponse | null = null;
  private metricsTimer: ReturnType<typeof setInterval> | null = null;

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

  async join(roomId: string) {
    viewerSessionLogger.info("Viewer is joining a room.", {
      apiBaseUrl: this.options.apiBaseUrl,
      roomId,
    });
    this.teardown(false);
    this.update({
      ...initialViewerSessionState,
      displayName: this.options.initialDisplayName?.trim() ?? "",
      roomId,
      status: "joining",
    });

    try {
      const roomState = await getRoomState(
        this.options.apiBaseUrl,
        roomId,
        this.options.fetchFn,
      );
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
        this.options.fetchFn,
      );
      viewerSessionLogger.info("Viewer joined the room signaling session.", {
        iceServerCount: joined.iceServers.length,
        roomId: joined.roomId,
        sessionId: joined.sessionId,
        wsUrl: joined.wsUrl,
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

      this.joinResponse = joined;
      this.peerClient = this.createPeerClient(joined);

      this.socketClient = createSocketClient(joined.wsUrl, joined.viewerToken, {
        createWebSocket: this.options.createWebSocket,
        onOpen: () => {
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
          viewerSessionLogger.warn("Viewer signaling channel closed.", {
            code: "code" in event ? event.code : null,
            reason: event.reason ?? null,
            roomId: joined.roomId,
            sessionId: joined.sessionId,
          });
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
          viewerSessionLogger.error("Viewer signaling channel failed.", {
            roomId: joined.roomId,
            sessionId: joined.sessionId,
          });
          this.update({
            status: "error",
            errorCode: viewerErrorCodes.SIGNALING_FAILED,
          });
        },
        onMessage: (message) => {
          void this.handleSignal(message);
        },
      });
    } catch (error) {
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
    const trimmedDisplayName = displayName.trim();

    if (!trimmedDisplayName) {
      return;
    }

    this.update({ displayName: trimmedDisplayName });
    this.sendViewerProfile();
  }

  sendChatMessage(text: string) {
    const trimmedText = text.trim();

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

  private createPeerClient(joined: JoinRoomResponse) {
    const peerClient = createViewerPeerConnection({
      iceServers: joined.iceServers,
      sessionId: joined.sessionId,
      roomId: joined.roomId,
      getTargetSessionId: () => this.snapshot.hostSessionId,
      sendSignal: (message) => this.socketClient?.send(message),
      onRemoteStream: (stream) => {
        viewerSessionLogger.info("Viewer received a remote stream.", {
          roomId: joined.roomId,
          sessionId: joined.sessionId,
          streamId: typeof stream.id === "string" ? stream.id : null,
        });

        if (this.peerClient !== peerClient) {
          return;
        }

        this.update({
          remoteStream: stream,
          sourceState: "attached",
          status: "connected",
          errorCode: null,
          endedReasonCode: null,
        });
      },
      onConnectionStateChange: (state) => {
        viewerSessionLogger.info("Viewer peer connection state changed.", {
          roomId: joined.roomId,
          sessionId: joined.sessionId,
          state,
        });

        if (this.peerClient !== peerClient) {
          return;
        }

        if (state === "failed") {
          viewerSessionLogger.error("Viewer peer connectivity failed.", {
            roomId: joined.roomId,
            sessionId: joined.sessionId,
            state,
          });
          this.update({
            status: "error",
            errorCode: errorCodes.DIRECT_CONNECTIVITY_FAILED,
          });
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

  private async handleSignal(message: SignalEnvelope) {
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
        const previousPeerClient = this.peerClient;
        this.peerClient = null;
        previousPeerClient?.close();
        if (!this.joinResponse) {
          viewerSessionLogger.warn("Viewer ignored an offer before join state was ready.", {
            hostSessionId: message.sessionId,
            roomId: message.roomId,
          });
          break;
        }
        this.peerClient = this.createPeerClient(this.joinResponse);
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
        if (message.payload.targetSessionId === this.snapshot.sessionId) {
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

  private teardown(resetSnapshot: boolean) {
    viewerSessionLogger.info("Tearing down viewer session resources.", {
      resetSnapshot,
      roomId: this.snapshot.roomId,
      sessionId: this.snapshot.sessionId,
      status: this.snapshot.status,
    });
    this.stopMetricsTimer();
    this.socketClient?.close();
    this.socketClient = null;
    const peerClient = this.peerClient;
    this.peerClient = null;
    peerClient?.close();
    this.joinResponse = null;

    if (resetSnapshot) {
      this.snapshot = {
        ...initialViewerSessionState,
        displayName: this.options.initialDisplayName?.trim() ?? "",
      };
      this.emit();
    }
  }

  private update(patch: Partial<ViewerSessionState> | ViewerSessionState) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.emit();
  }

  private emit() {
    for (const listener of this.listeners) {
      listener(this.snapshot);
    }
  }

  private sendViewerProfile() {
    if (
      !this.joinResponse ||
      !this.socketClient ||
      !this.snapshot.displayName.trim()
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
          displayName: this.snapshot.displayName.trim(),
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

    try {
      const metrics = await this.peerClient.collectMetrics();

      if (this.joinResponse !== joined || !this.socketClient) {
        return false;
      }

      this.update({
        localConnectionType: metrics.connectionType,
        localPingMs: metrics.pingMs,
      });

      return this.socketClient.send(
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
