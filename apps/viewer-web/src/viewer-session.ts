import { errorCodes } from "@screenmate/shared";
import { getRoomState, joinRoom, type RoomApiError } from "./lib/api";
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

type ViewerSessionOptions = {
  apiBaseUrl: string;
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
    this.teardown(false);
    this.update({
      ...initialViewerSessionState,
      roomId,
      status: "joining",
    });

    try {
      const roomState = await getRoomState(
        this.options.apiBaseUrl,
        roomId,
        this.options.fetchFn,
      );

      if (roomState.state === "closed") {
        this.update({
          ...initialViewerSessionState,
          roomId,
          roomState: roomState.state,
          status: "ended",
          endedReason: "The host has already ended this room.",
        });
        return;
      }

      const joined = await joinRoom(
        this.options.apiBaseUrl,
        roomId,
        this.options.fetchFn,
      );

      this.update({
        roomId: joined.roomId,
        sessionId: joined.sessionId,
        viewerToken: joined.viewerToken,
        hostSessionId: roomState.hostSessionId,
        roomState: roomState.state,
        status: "waiting",
        error: null,
        endedReason: null,
        remoteStream: null,
      });

      this.peerClient = createViewerPeerConnection({
        iceServers: joined.iceServers,
        sessionId: joined.sessionId,
        roomId: joined.roomId,
        getTargetSessionId: () => this.snapshot.hostSessionId,
        sendSignal: (message) => this.socketClient?.send(message),
        onRemoteStream: (stream) => {
          this.update({
            remoteStream: stream,
            status: "connected",
            error: null,
            endedReason: null,
          });
        },
        onConnectionStateChange: (state) => {
          if (state === "failed") {
            this.update({
              status: "error",
              error: "Direct peer connectivity failed.",
            });
          }
          if (state === "closed" && this.snapshot.status !== "ended") {
            this.update({
              status: "ended",
              endedReason: "The stream ended.",
            });
          }
        },
        createPeerConnection: this.options.createPeerConnection,
      });

      this.socketClient = createSocketClient(joined.wsUrl, joined.viewerToken, {
        createWebSocket: this.options.createWebSocket,
        onOpen: () => {
          this.update({
            status: "waiting",
            error: null,
          });
        },
        onClose: () => {
          if (
            this.snapshot.status !== "ended" &&
            this.snapshot.status !== "error"
          ) {
            this.update({
              status: "ended",
              endedReason: "The room connection closed.",
            });
          }
        },
        onError: () => {
          this.update({
            status: "error",
            error: "The signaling connection failed.",
          });
        },
        onMessage: (message) => {
          void this.handleSignal(message);
        },
      });
    } catch (error) {
      const apiError = error as Partial<RoomApiError>;
      const message =
        error instanceof Error ? error.message : "We couldn’t join that room.";

      this.update({
        ...initialViewerSessionState,
        roomId,
        status:
          apiError.code === errorCodes.ROOM_EXPIRED ? "ended" : "error",
        error: apiError.code === errorCodes.ROOM_EXPIRED ? null : message,
        endedReason:
          apiError.code === errorCodes.ROOM_EXPIRED ? message : null,
      });
    }
  }

  destroy() {
    this.teardown(true);
  }

  private async handleSignal(message: SignalEnvelope) {
    switch (message.messageType) {
      case "host-connected":
        this.update({ hostSessionId: message.sessionId });
        break;
      case "offer":
        this.update({
          hostSessionId: message.sessionId,
          status: "connecting",
          roomState: "streaming",
        });
        await this.peerClient?.acceptOffer(message.sessionId, message.payload.sdp);
        break;
      case "ice-candidate":
        if (message.payload.targetSessionId === this.snapshot.sessionId) {
          await this.peerClient?.addIceCandidate(
            message.payload.candidate,
            message.payload.sdpMid,
            message.payload.sdpMLineIndex,
          );
        }
        break;
      case "room-state":
        this.update({ roomState: message.payload.state });
        if (message.payload.state === "closed") {
          this.update({
            status: "ended",
            endedReason: "The host ended the room.",
          });
        }
        break;
      case "host-left":
      case "room-closed":
        this.update({
          status: "ended",
          endedReason: "The host ended the room.",
          roomState: "closed",
        });
        this.teardown(false);
        break;
      case "negotiation-failed":
        if (message.payload.targetSessionId === this.snapshot.sessionId) {
          this.update({
            status: "error",
            error: toNegotiationError(message.payload.code),
          });
        }
        break;
      default:
        break;
    }
  }

  private teardown(resetSnapshot: boolean) {
    this.socketClient?.close();
    this.socketClient = null;
    this.peerClient?.close();
    this.peerClient = null;

    if (resetSnapshot) {
      this.snapshot = initialViewerSessionState;
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
}

function toNegotiationError(code: string): string {
  if (code === errorCodes.DIRECT_CONNECTIVITY_FAILED) {
    return "Your network could not establish a direct WebRTC connection.";
  }

  return "Peer negotiation failed.";
}
