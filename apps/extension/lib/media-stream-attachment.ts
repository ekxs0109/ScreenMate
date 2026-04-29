import { errorCodes } from "@screenmate/shared";
import { normalizeIceServers } from "@screenmate/webrtc-core";
import { createPeerRegistry } from "../entrypoints/content/peer-manager";
import { createLogger } from "./logger";

const mediaStreamAttachmentLogger = createLogger("media-stream-attachment");

type HostPeerConnection = Pick<
  RTCPeerConnection,
  | "addEventListener"
  | "addTransceiver"
  | "createOffer"
  | "setLocalDescription"
  | "setRemoteDescription"
  | "addIceCandidate"
  | "close"
>;
type HostRtpSender = Pick<RTCRtpSender, "getParameters" | "setParameters">;
type HostRtpTransceiver = Pick<
  RTCRtpTransceiver,
  "sender" | "setCodecPreferences"
>;

export type MediaStreamAttachmentReason =
  | "track-ended"
  | "content-invalidated"
  | "manual-detach";

export type MediaStreamAttachmentResponse = {
  sourceLabel: string;
  fingerprint: {
    primaryUrl: string | null;
    pageUrl: string | null;
    elementId: string | null;
    label: string;
    visibleIndex: number;
  };
};

type Attachment = {
  roomId: string;
  sessionId: string;
  sourceLabel: string;
  sourceHeight: number | null;
  sourceWidth: number | null;
  stream: MediaStream;
  iceServers: RTCIceServer[];
  detachNotified: boolean;
};

export function createMediaStreamAttachmentRuntime(options: {
  onSignal: (envelope: Record<string, unknown>) => void;
  onSourceDetached: (event: {
    roomId: string;
    reason: MediaStreamAttachmentReason;
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
  const pendingViewerSessionIds = new Set<string>();

  async function attachStream(input: {
    roomId: string;
    sessionId: string;
    sourceLabel: string;
    sourceHeight?: number | null;
    sourceWidth?: number | null;
    stream: MediaStream;
    viewerSessionIds: string[];
    iceServers: RTCIceServer[];
    fingerprint: MediaStreamAttachmentResponse["fingerprint"];
  }): Promise<MediaStreamAttachmentResponse> {
    const nextAttachment: Attachment = {
      roomId: input.roomId,
      sessionId: input.sessionId,
      sourceLabel: input.sourceLabel,
      sourceHeight: input.sourceHeight ?? null,
      sourceWidth: input.sourceWidth ?? null,
      stream: input.stream,
      iceServers: normalizeIceServers(input.iceServers) as RTCIceServer[],
      detachNotified: false,
    };

    teardownAttachment();
    attachment = nextAttachment;

    const streamTracks = input.stream.getTracks();
    mediaStreamAttachmentLogger.info("Source stream attached for active room.", {
      roomId: input.roomId,
      sessionId: input.sessionId,
      sourceLabel: nextAttachment.sourceLabel,
      sourceHeight: nextAttachment.sourceHeight,
      sourceWidth: nextAttachment.sourceWidth,
      trackCount: streamTracks.length,
      trackKinds: streamTracks.map((track) => track.kind),
      videoTrackCount: getCapturedVideoTracks(input.stream).length,
      viewerSessionCount: input.viewerSessionIds.length,
    });

    for (const track of streamTracks) {
      track.addEventListener("ended", () => {
        if (attachment !== nextAttachment) {
          return;
        }

        notifyDetached(nextAttachment, "track-ended");
      });
    }

    const viewerSessionIds = [
      ...new Set([...input.viewerSessionIds, ...pendingViewerSessionIds]),
    ];
    pendingViewerSessionIds.clear();
    for (const viewerSessionId of viewerSessionIds) {
      await beginViewerNegotiation(viewerSessionId);
    }

    return {
      sourceLabel: nextAttachment.sourceLabel,
      fingerprint: {
        ...input.fingerprint,
        label: input.fingerprint.label || nextAttachment.sourceLabel,
      },
    };
  }

  async function beginViewerNegotiation(viewerSessionId: string) {
    if (!attachment || peers.get(viewerSessionId)) {
      return;
    }

    const activeAttachment = attachment;
    const streamTracks = activeAttachment.stream.getTracks();

    try {
      const connection = new RTCPeerConnectionImpl({
        iceServers: activeAttachment.iceServers,
      });
      peers.begin(viewerSessionId, connection);

      for (const track of streamTracks) {
        const transceiver = connection.addTransceiver(track, {
          direction: "sendonly",
          streams: [activeAttachment.stream],
        });
        configureVideoCodecPreferences(track, transceiver, activeAttachment);
        await configureSenderForHighQualityVideo(
          track,
          transceiver.sender,
          activeAttachment,
        );
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
    } catch (error) {
      mediaStreamAttachmentLogger.error("Host negotiation failed before offer completed.", {
        error: error instanceof Error ? error.message : String(error),
        roomId: activeAttachment.roomId,
        sessionId: activeAttachment.sessionId,
        viewerSessionId,
      });
      peers.failed(viewerSessionId);
      peers.remove(viewerSessionId);

      if (attachment !== activeAttachment) {
        return;
      }

      options.onSignal({
        roomId: activeAttachment.roomId,
        sessionId: activeAttachment.sessionId,
        role: "host",
        messageType: "negotiation-failed",
        timestamp: now(),
        payload: {
          targetSessionId: viewerSessionId,
          code: errorCodes.NEGOTIATION_FAILED,
        },
      });
    }
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
      if (!attachment) {
        pendingViewerSessionIds.add(envelope.payload.viewerSessionId);
      }
      await beginViewerNegotiation(envelope.payload.viewerSessionId);
      return;
    }

    if (
      envelope.messageType === "viewer-left" &&
      envelope.payload.viewerSessionId
    ) {
      pendingViewerSessionIds.delete(envelope.payload.viewerSessionId);
      peers.remove(envelope.payload.viewerSessionId);
      return;
    }

    const peer = peers.get(envelope.sessionId);
    if (!peer) {
      mediaStreamAttachmentLogger.warn("Dropped signaling for an unknown viewer peer.", {
        hasAttachment: Boolean(attachment),
        messageType: envelope.messageType,
        sessionId: envelope.sessionId,
        viewerSessionId: envelope.payload.viewerSessionId ?? null,
      });
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
    reason: MediaStreamAttachmentReason,
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

  function teardownAttachment(reason?: MediaStreamAttachmentReason) {
    const currentAttachment = attachment;
    if (!currentAttachment) {
      peers.closeAll();
      return;
    }

    attachment = null;
    pendingViewerSessionIds.clear();
    peers.closeAll();

    for (const track of currentAttachment.stream.getTracks()) {
      track.stop();
    }

    if (reason) {
      notifyDetached(currentAttachment, reason);
    }
  }

  function destroy(reason: MediaStreamAttachmentReason = "content-invalidated") {
    teardownAttachment(reason);
  }

  function detachForReplacement() {
    teardownAttachment();
  }

  function updateIceServers(iceServers: RTCIceServer[]) {
    if (!attachment) {
      return;
    }

    attachment.iceServers = normalizeIceServers(iceServers) as RTCIceServer[];
  }

  return {
    attachStream,
    beginViewerNegotiation,
    detachForReplacement,
    handleSignal,
    updateIceServers,
    destroy,
  };
}

async function configureSenderForHighQualityVideo(
  track: MediaStreamTrack,
  sender: HostRtpSender | undefined,
  activeAttachment: Pick<Attachment, "roomId" | "sessionId" | "sourceHeight" | "sourceWidth">,
) {
  if (track.kind !== "video" || !sender) {
    return;
  }

  try {
    const parameters = sender.getParameters();
    const encoding = {
      ...(parameters.encodings?.[0] ?? {}),
      maxBitrate: getPreferredVideoMaxBitrate(track, activeAttachment),
      maxFramerate: getPreferredVideoMaxFramerate(track),
      scaleResolutionDownBy: 1,
    };
    parameters.encodings = [encoding, ...(parameters.encodings ?? []).slice(1)];
    await sender.setParameters(parameters);
  } catch (error) {
    mediaStreamAttachmentLogger.warn("Could not configure host video sender quality.", {
      error: error instanceof Error ? error.message : String(error),
      roomId: activeAttachment.roomId,
      sessionId: activeAttachment.sessionId,
    });
  }
}

function configureVideoCodecPreferences(
  track: MediaStreamTrack,
  transceiver: HostRtpTransceiver,
  activeAttachment: Pick<Attachment, "roomId" | "sessionId">,
) {
  if (track.kind !== "video") {
    return;
  }

  try {
    const codecs = getPreferredVideoCodecs();
    if (codecs.length > 0) {
      transceiver.setCodecPreferences(codecs);
    }
  } catch (error) {
    mediaStreamAttachmentLogger.warn("Could not configure host video codec preferences.", {
      error: error instanceof Error ? error.message : String(error),
      roomId: activeAttachment.roomId,
      sessionId: activeAttachment.sessionId,
    });
  }
}

function getPreferredVideoMaxBitrate(
  track: MediaStreamTrack,
  attachment: Pick<Attachment, "sourceHeight" | "sourceWidth">,
) {
  const settings = track.getSettings?.() ?? {};
  const width =
    typeof settings.width === "number"
      ? settings.width
      : attachment.sourceWidth ?? 1280;
  const height =
    typeof settings.height === "number"
      ? settings.height
      : attachment.sourceHeight ?? 720;
  const pixels = width * height;

  if (pixels <= 640 * 360) {
    return 1_500_000;
  }

  if (pixels <= 1280 * 720) {
    return 3_500_000;
  }

  if (pixels <= 1920 * 1080) {
    return 8_000_000;
  }

  return 14_000_000;
}

function getCapturedVideoTracks(stream: MediaStream) {
  return stream.getTracks().filter((track) => track.kind === "video");
}

function getPreferredVideoMaxFramerate(track: MediaStreamTrack) {
  const settings = track.getSettings?.() ?? {};
  const frameRate =
    typeof settings.frameRate === "number" && Number.isFinite(settings.frameRate)
      ? settings.frameRate
      : 30;

  return Math.min(Math.max(Math.round(frameRate), 15), 60);
}

function getPreferredVideoCodecs() {
  const capabilities = globalThis.RTCRtpSender?.getCapabilities?.("video");
  const codecs = capabilities?.codecs ?? [];
  const preferredMimeTypes = ["video/AV1", "video/VP9", "video/H264", "video/VP8"];

  return [...codecs].sort((left, right) => {
    return getCodecPreferenceRank(left, preferredMimeTypes) -
      getCodecPreferenceRank(right, preferredMimeTypes);
  });
}

function getCodecPreferenceRank(
  codec: { mimeType: string },
  preferredMimeTypes: string[],
) {
  const mimeType = codec.mimeType.toLowerCase();
  const index = preferredMimeTypes.findIndex(
    (preferred) => preferred.toLowerCase() === mimeType,
  );
  return index === -1 ? preferredMimeTypes.length : index;
}
