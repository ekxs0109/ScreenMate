import { normalizeIceServers } from "@screenmate/webrtc-core";
import { errorCodes } from "@screenmate/shared";
import { createLogger } from "../../lib/logger";
import { createPeerRegistry } from "./peer-manager";
import { captureVideoStream } from "./video-capture";
import {
  findVisibleVideoByHandle,
  listVisibleVideoCandidates,
} from "./video-detector";

const sourceAttachmentLogger = createLogger("content:source-attachment");

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
    sourceAttachmentLogger.info("Source attach requested in content runtime.", {
      iceServerCount: input.iceServers.length,
      roomId: input.roomId,
      sessionId: input.sessionId,
      videoId: input.videoId,
      viewerSessionCount: input.viewerSessionIds.length,
      viewerSessionIds: input.viewerSessionIds,
    });

    const video = findVisibleVideoByHandle(input.videoId);
    if (!video) {
      sourceAttachmentLogger.warn("Source attach could not find the selected video.", {
        roomId: input.roomId,
        sessionId: input.sessionId,
        videoId: input.videoId,
      });
      throw new Error(errorCodes.NO_VIDEO_FOUND);
    }

    const stream = captureVideoStream(video);
    const nextAttachment: Attachment = {
      roomId: input.roomId,
      sessionId: input.sessionId,
      sourceLabel: video.currentSrc || video.src || "Visible video",
      sourceHeight: video.videoHeight || null,
      sourceWidth: video.videoWidth || null,
      stream,
      iceServers: normalizeIceServers(input.iceServers) as RTCIceServer[],
      detachNotified: false,
    };
    teardownAttachment();
    attachment = nextAttachment;
    sourceAttachmentLogger.info("Source stream captured for active room.", {
      roomId: input.roomId,
      sessionId: input.sessionId,
      sourceLabel: nextAttachment.sourceLabel,
      trackCount: stream.getTracks().length,
      viewerSessionCount: input.viewerSessionIds.length,
    });

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

    sourceAttachmentLogger.info("Source attach completed in content runtime.", {
      roomId: input.roomId,
      sessionId: input.sessionId,
      sourceLabel: attachment.sourceLabel,
      viewerSessionCount: input.viewerSessionIds.length,
    });

    return {
      sourceLabel: attachment.sourceLabel,
      fingerprint: {
        primaryUrl: video.currentSrc || video.src || video.getAttribute("poster"),
        pageUrl: window.location.href,
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
      sourceAttachmentLogger.debug("Skipped viewer negotiation.", {
        hasAttachment: Boolean(attachment),
        hasExistingPeer: Boolean(peers.get(viewerSessionId)),
        viewerSessionId,
      });
      return;
    }

    const activeAttachment = attachment;
    sourceAttachmentLogger.info("Beginning viewer negotiation for attached source.", {
      iceServerCount: activeAttachment.iceServers.length,
      roomId: activeAttachment.roomId,
      sessionId: activeAttachment.sessionId,
      viewerSessionId,
    });

    try {
      const connection = new RTCPeerConnectionImpl({
        iceServers: activeAttachment.iceServers,
      });
      peers.begin(viewerSessionId, connection);

      for (const track of activeAttachment.stream.getTracks()) {
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

        sourceAttachmentLogger.debug("Host produced an ICE candidate for viewer.", {
          roomId: activeAttachment.roomId,
          sessionId: activeAttachment.sessionId,
          sdpMLineIndex: event.candidate.sdpMLineIndex ?? null,
          sdpMid: event.candidate.sdpMid ?? null,
          viewerSessionId,
        });
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
      sourceAttachmentLogger.info("Host created and sent an offer for viewer.", {
        roomId: activeAttachment.roomId,
        sdpLength: offer.sdp?.length ?? 0,
        sessionId: activeAttachment.sessionId,
        viewerSessionId,
      });
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
      sourceAttachmentLogger.error("Host negotiation failed before offer completed.", {
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

  async function configureSenderForHighQualityVideo(
    track: MediaStreamTrack,
    sender: HostRtpSender | undefined,
    activeAttachment: Attachment,
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
      sourceAttachmentLogger.info("Configured host video sender quality.", {
        maxBitrate: encoding.maxBitrate,
        maxFramerate: encoding.maxFramerate,
        roomId: activeAttachment.roomId,
        scaleResolutionDownBy: encoding.scaleResolutionDownBy,
        sessionId: activeAttachment.sessionId,
      });
    } catch (error) {
      sourceAttachmentLogger.warn("Could not configure host video sender quality.", {
        error: error instanceof Error ? error.message : String(error),
        roomId: activeAttachment.roomId,
        sessionId: activeAttachment.sessionId,
      });
    }
  }

  function configureVideoCodecPreferences(
    track: MediaStreamTrack,
    transceiver: HostRtpTransceiver,
    activeAttachment: Attachment,
  ) {
    if (track.kind !== "video") {
      return;
    }

    try {
      const codecs = getPreferredVideoCodecs();
      if (codecs.length === 0) {
        return;
      }

      transceiver.setCodecPreferences(codecs);
      sourceAttachmentLogger.info("Configured host video codec preferences.", {
        codecOrder: codecs.map((codec) => codec.mimeType),
        roomId: activeAttachment.roomId,
        sessionId: activeAttachment.sessionId,
      });
    } catch (error) {
      sourceAttachmentLogger.warn("Could not configure host video codec preferences.", {
        error: error instanceof Error ? error.message : String(error),
        roomId: activeAttachment.roomId,
        sessionId: activeAttachment.sessionId,
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
    sourceAttachmentLogger.debug("Content runtime received inbound signaling.", {
      messageType: envelope.messageType,
      sessionId: envelope.sessionId,
      viewerSessionId: envelope.payload.viewerSessionId ?? null,
    });

    if (
      envelope.messageType === "viewer-joined" &&
      envelope.payload.viewerSessionId
    ) {
      await beginViewerNegotiation(envelope.payload.viewerSessionId);
      return;
    }

    if (
      envelope.messageType === "viewer-left" &&
      envelope.payload.viewerSessionId
    ) {
      peers.remove(envelope.payload.viewerSessionId);
      return;
    }

    const peer = peers.get(envelope.sessionId);
    if (!peer) {
      sourceAttachmentLogger.warn("Content runtime dropped signaling for an unknown viewer peer.", {
        hasAttachment: Boolean(attachment),
        messageType: envelope.messageType,
        sessionId: envelope.sessionId,
        viewerSessionId: envelope.payload.viewerSessionId ?? null,
      });
      return;
    }

    if (envelope.messageType === "answer" && envelope.payload.sdp) {
      sourceAttachmentLogger.info("Host received viewer answer.", {
        roomId: attachment?.roomId ?? null,
        sdpLength: envelope.payload.sdp.length,
        viewerSessionId: envelope.sessionId,
      });
      await peer.connection.setRemoteDescription({
        type: "answer",
        sdp: envelope.payload.sdp,
      });
      peers.connected(envelope.sessionId);
      return;
    }

    if (envelope.messageType === "ice-candidate" && envelope.payload.candidate) {
      sourceAttachmentLogger.debug("Host received viewer ICE candidate.", {
        roomId: attachment?.roomId ?? null,
        sdpMLineIndex: envelope.payload.sdpMLineIndex ?? null,
        sdpMid: envelope.payload.sdpMid ?? null,
        viewerSessionId: envelope.sessionId,
      });
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

  function updateIceServers(iceServers: RTCIceServer[]) {
    if (!attachment) {
      return;
    }

    attachment.iceServers = normalizeIceServers(iceServers) as RTCIceServer[];
  }

  return {
    attachSource,
    beginViewerNegotiation,
    handleSignal,
    updateIceServers,
    destroy,
  };
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
  const preferredIndex = preferredMimeTypes.findIndex(
    (preferredMimeType) => preferredMimeType.toLowerCase() === mimeType,
  );

  return preferredIndex === -1 ? preferredMimeTypes.length : preferredIndex;
}
