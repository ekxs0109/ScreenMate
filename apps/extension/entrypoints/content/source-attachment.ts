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

type Attachment = {
  roomId: string;
  sessionId: string;
  sourceLabel: string;
  stream: MediaStream;
  iceServers: RTCIceServer[];
  detachNotified: boolean;
};

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
  let attachment: Attachment | null = null;

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
    const nextAttachment: Attachment = {
      roomId: input.roomId,
      sessionId: input.sessionId,
      sourceLabel: video.currentSrc || video.src || "Visible video",
      stream,
      iceServers: normalizeIceServers(input.iceServers) as RTCIceServer[],
      detachNotified: false,
    };
    teardownAttachment();
    attachment = nextAttachment;

    for (const track of stream.getTracks()) {
      track.addEventListener("ended", () => {
        if (attachment !== nextAttachment) {
          return;
        }

        notifyDetached(nextAttachment, "track-ended");
      });
    }

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

    const activeAttachment = attachment;
    const connection = new RTCPeerConnectionImpl({
      iceServers: activeAttachment.iceServers,
    });
    peers.begin(viewerSessionId, connection);

    for (const track of activeAttachment.stream.getTracks()) {
      connection.addTrack(track, activeAttachment.stream);
    }

    connection.addEventListener("icecandidate", (event) => {
      if (attachment !== activeAttachment || !event.candidate) {
        return;
      }

      options.onSignal({
        roomId: activeAttachment.roomId,
        sessionId: activeAttachment.sessionId,
        role: "host",
        messageType: "ice-candidate",
        timestamp: now(),
        payload: {
          targetSessionId: viewerSessionId,
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid ?? null,
          sdpMLineIndex: event.candidate.sdpMLineIndex ?? null,
        },
      });
    });

    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    options.onSignal({
      roomId: activeAttachment.roomId,
      sessionId: activeAttachment.sessionId,
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

  function notifyDetached(
    currentAttachment: Attachment,
    reason: "track-ended" | "content-invalidated" | "manual-detach",
  ) {
    if (currentAttachment.detachNotified) {
      return;
    }

    currentAttachment.detachNotified = true;
    options.onSourceDetached({
      roomId: currentAttachment.roomId,
      reason,
    });
  }

  function teardownAttachment(
    reason?: "content-invalidated" | "manual-detach",
  ) {
    const currentAttachment = attachment;
    if (!currentAttachment) {
      peers.closeAll();
      return;
    }

    attachment = null;
    peers.closeAll();

    for (const track of currentAttachment.stream.getTracks()) {
      track.stop();
    }

    if (reason) {
      notifyDetached(currentAttachment, reason);
    }
  }

  function destroy(
    reason: "content-invalidated" | "manual-detach" = "content-invalidated",
  ) {
    teardownAttachment(reason);
  }

  return {
    attachSource,
    beginViewerNegotiation,
    handleSignal,
    destroy,
  };
}
