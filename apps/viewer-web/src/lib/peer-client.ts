import { normalizeIceServers } from "@screenmate/webrtc-core";
import type { SignalEnvelope } from "./socket-client";

export type PeerConnectionLike = Pick<
  RTCPeerConnection,
  | "addIceCandidate"
  | "close"
  | "createAnswer"
  | "setLocalDescription"
  | "setRemoteDescription"
  | "connectionState"
> & {
  onicecandidate:
    | ((event: { candidate: RTCIceCandidate | null }) => void)
    | null;
  ontrack:
    | ((event: { streams: MediaStream[] }) => void)
    | null;
  onconnectionstatechange: (() => void) | null;
};

export function createViewerPeerConnection(
  options: {
    iceServers: RTCIceServer[];
    sessionId: string;
    roomId: string;
    getTargetSessionId: () => string | null;
    sendSignal: (message: SignalEnvelope) => void;
    onRemoteStream: (stream: MediaStream) => void;
    onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
    createPeerConnection?: (config: RTCConfiguration) => PeerConnectionLike;
  },
) {
  const normalizedIceServers =
    normalizeIceServers(options.iceServers) as unknown as RTCIceServer[];
  const peerConnection =
    options.createPeerConnection?.({
      iceServers: normalizedIceServers,
    }) ??
    new RTCPeerConnection({
      iceServers: normalizedIceServers,
    });

  peerConnection.ontrack = (event: { streams: MediaStream[] }) => {
    const [stream] = event.streams;
    if (stream) {
      options.onRemoteStream(stream);
    }
  };

  peerConnection.onicecandidate = (
    event: { candidate: RTCIceCandidate | null },
  ) => {
    if (!event.candidate) {
      return;
    }

    const targetSessionId = options.getTargetSessionId();

    if (!targetSessionId) {
      return;
    }

    options.sendSignal({
      roomId: options.roomId,
      sessionId: options.sessionId,
      timestamp: Date.now(),
      role: "viewer",
      messageType: "ice-candidate",
      payload: {
        targetSessionId,
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid,
        sdpMLineIndex: event.candidate.sdpMLineIndex,
      },
    });
  };
  peerConnection.onconnectionstatechange = () => {
    options.onConnectionStateChange?.(peerConnection.connectionState);
  };

  return {
    async acceptOffer(targetSessionId: string, sdp: string) {
      await peerConnection.setRemoteDescription({
        type: "offer",
        sdp,
      });
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      options.sendSignal({
        roomId: options.roomId,
        sessionId: options.sessionId,
        timestamp: Date.now(),
        role: "viewer",
        messageType: "answer",
        payload: {
          targetSessionId,
          sdp: answer.sdp ?? "",
        },
      });
    },
    async addIceCandidate(
      candidate: string,
      sdpMid?: string | null,
      sdpMLineIndex?: number | null,
    ) {
      await peerConnection.addIceCandidate({
        candidate,
        sdpMid,
        sdpMLineIndex,
      });
    },
    close() {
      peerConnection.close();
    },
  };
}
