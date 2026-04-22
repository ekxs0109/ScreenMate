import { normalizeIceServers } from "@screenmate/webrtc-core";
import { errorCodes } from "@screenmate/shared";
import { createPeerRegistry } from "./peer-manager";
import { captureVideoStream } from "./video-capture";
import {
  findVisibleVideoByHandle,
  listVisibleVideoCandidates,
} from "./video-detector";

type HostPeerConnection = Pick<
  RTCPeerConnection,
  | "addEventListener"
  | "addTrack"
  | "createOffer"
  | "setLocalDescription"
  | "setRemoteDescription"
  | "addIceCandidate"
  | "close"
>;

export function createSourceAttachmentRuntime(options: {
  onSignal: (envelope: Record<string, unknown>) => void;
  onSourceDetached: (event: {
    roomId: string;
    reason: "track-ended" | "content-invalidated" | "manual-detach";
  }) => void;
  RTCPeerConnectionImpl?: new (
    config?: RTCConfiguration,
  ) => HostPeerConnection;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const RTCPeerConnectionImpl =
    options.RTCPeerConnectionImpl ?? globalThis.RTCPeerConnection;
  const peers = createPeerRegistry<HostPeerConnection>();
  let attachment: {
    roomId: string;
    sessionId: string;
    sourceLabel: string;
    stream: MediaStream;
    iceServers: RTCIceServer[];
  } | null = null;

  async function attachSource(input: {
    roomId: string;
    sessionId: string;
    videoId: string;
    viewerSessionIds: string[];
    iceServers: RTCIceServer[];
  }) {
    const video = findVisibleVideoByHandle(input.videoId);
    if (!video) {
      throw new Error(errorCodes.NO_VIDEO_FOUND);
    }

    const stream = captureVideoStream(video);
    for (const track of stream.getTracks()) {
      track.addEventListener("ended", () => {
        options.onSourceDetached({
          roomId: input.roomId,
          reason: "track-ended",
        });
      });
    }

    attachment = {
      roomId: input.roomId,
      sessionId: input.sessionId,
      sourceLabel: video.currentSrc || video.src || "Visible video",
      stream,
      iceServers: normalizeIceServers(input.iceServers) as RTCIceServer[],
    };

    for (const viewerSessionId of input.viewerSessionIds) {
      await beginViewerNegotiation(viewerSessionId);
    }

    return {
      sourceLabel: attachment.sourceLabel,
      fingerprint: {
        primaryUrl: video.currentSrc || video.src || video.getAttribute("poster"),
        elementId: video.id || null,
        label: attachment.sourceLabel,
        visibleIndex: listVisibleVideoCandidates().findIndex(
          (candidate) => candidate.id === input.videoId,
        ),
      },
    };
  }

  async function beginViewerNegotiation(viewerSessionId: string) {
    if (!attachment || peers.get(viewerSessionId)) {
      return;
    }

    const connection = new RTCPeerConnectionImpl({
      iceServers: attachment.iceServers,
    });
    peers.begin(viewerSessionId, connection);

    for (const track of attachment.stream.getTracks()) {
      connection.addTrack(track, attachment.stream);
    }

    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    options.onSignal({
      roomId: attachment.roomId,
      sessionId: attachment.sessionId,
      role: "host",
      messageType: "offer",
      timestamp: now(),
      payload: {
        targetSessionId: viewerSessionId,
        sdp: offer.sdp ?? "",
      },
    });
  }

  async function handleSignal(envelope: {
    messageType: string;
    sessionId: string;
    payload: {
      viewerSessionId?: string;
      sdp?: string;
      candidate?: string;
      sdpMid?: string | null;
      sdpMLineIndex?: number | null;
    };
  }) {
    if (
      envelope.messageType === "viewer-joined" &&
      envelope.payload.viewerSessionId
    ) {
      await beginViewerNegotiation(envelope.payload.viewerSessionId);
      return;
    }

    const peer = peers.get(envelope.sessionId);
    if (!peer) {
      return;
    }

    if (envelope.messageType === "answer" && envelope.payload.sdp) {
      await peer.connection.setRemoteDescription({
        type: "answer",
        sdp: envelope.payload.sdp,
      });
      peers.connected(envelope.sessionId);
      return;
    }

    if (envelope.messageType === "ice-candidate" && envelope.payload.candidate) {
      await peer.connection.addIceCandidate({
        candidate: envelope.payload.candidate,
        sdpMid: envelope.payload.sdpMid ?? null,
        sdpMLineIndex: envelope.payload.sdpMLineIndex ?? null,
      });
    }
  }

  function destroy(
    reason: "content-invalidated" | "manual-detach" = "content-invalidated",
  ) {
    peers.closeAll();
    for (const track of attachment?.stream.getTracks() ?? []) {
      track.stop();
    }
    if (attachment) {
      options.onSourceDetached({
        roomId: attachment.roomId,
        reason,
      });
    }
    attachment = null;
  }

  return {
    attachSource,
    beginViewerNegotiation,
    handleSignal,
    destroy,
  };
}
