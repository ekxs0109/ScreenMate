import { normalizeIceServers } from "@screenmate/webrtc-core";
import type { SignalEnvelope } from "./socket-client";
import { createLogger } from "./logger";

const viewerPeerLogger = createLogger("viewer:peer");

export type PeerConnectionLike = Pick<
  RTCPeerConnection,
  | "addIceCandidate"
  | "close"
   | "createAnswer"
  | "getStats"
  | "setLocalDescription"
  | "setRemoteDescription"
  | "connectionState"
  | "iceConnectionState"
  | "iceGatheringState"
> & {
  onicecandidate:
    | ((event: { candidate: RTCIceCandidate | null }) => void)
    | null;
  oniceconnectionstatechange: (() => void) | null;
  onicegatheringstatechange: (() => void) | null;
  ontrack:
    | ((event: { streams: MediaStream[] }) => void)
    | null;
  onconnectionstatechange: (() => void) | null;
};

export type ViewerPeerMetrics = {
  connectionType: "direct" | "relay" | "unknown";
  pingMs: number | null;
  videoCodec: string | null;
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
  const peerConnection = (options.createPeerConnection?.({
      iceServers: normalizedIceServers,
    }) ??
    new RTCPeerConnection({
      iceServers: normalizedIceServers,
    })) as PeerConnectionLike;
  viewerPeerLogger.info("Created viewer peer connection.", {
    iceServerCount: normalizedIceServers.length,
    roomId: options.roomId,
    sessionId: options.sessionId,
  });

  peerConnection.ontrack = (event: { streams: MediaStream[] }) => {
    const [stream] = event.streams;
    if (stream) {
      viewerPeerLogger.info("Viewer peer received a remote stream.", {
        roomId: options.roomId,
        sessionId: options.sessionId,
        streamId: typeof stream.id === "string" ? stream.id : null,
        trackCount:
          typeof stream.getTracks === "function" ? stream.getTracks().length : null,
      });
      options.onRemoteStream(stream);
    }
  };

  peerConnection.onicecandidate = (
    event: { candidate: RTCIceCandidate | null },
  ) => {
    if (!event.candidate) {
      viewerPeerLogger.debug("Viewer peer ICE candidate gathering completed.", {
        roomId: options.roomId,
        sessionId: options.sessionId,
      });
      return;
    }

    const targetSessionId = options.getTargetSessionId();

    if (!targetSessionId) {
      viewerPeerLogger.warn("Viewer peer produced a local ICE candidate before a target session was known.", {
        candidateType: parseCandidateType(event.candidate.candidate),
        roomId: options.roomId,
        sessionId: options.sessionId,
      });
      return;
    }

    viewerPeerLogger.debug("Viewer peer produced a local ICE candidate.", {
      candidateType: parseCandidateType(event.candidate.candidate),
      roomId: options.roomId,
      sdpMLineIndex: event.candidate.sdpMLineIndex ?? null,
      sdpMid: event.candidate.sdpMid ?? null,
      sessionId: options.sessionId,
      targetSessionId,
    });
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
  peerConnection.oniceconnectionstatechange = () => {
    viewerPeerLogger.info("Viewer ICE connection state changed.", {
      iceConnectionState: peerConnection.iceConnectionState,
      roomId: options.roomId,
      sessionId: options.sessionId,
    });
  };
  peerConnection.onicegatheringstatechange = () => {
    viewerPeerLogger.debug("Viewer ICE gathering state changed.", {
      iceGatheringState: peerConnection.iceGatheringState,
      roomId: options.roomId,
      sessionId: options.sessionId,
    });
  };
  peerConnection.onconnectionstatechange = () => {
    void handleConnectionStateChange(peerConnection, options);
  };

  return {
    async acceptOffer(targetSessionId: string, sdp: string) {
      viewerPeerLogger.info("Viewer peer is applying a remote offer.", {
        roomId: options.roomId,
        sdpLength: sdp.length,
        sessionId: options.sessionId,
        targetSessionId,
      });
      await peerConnection.setRemoteDescription({
        type: "offer",
        sdp,
      });
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      viewerPeerLogger.info("Viewer peer created a local answer.", {
        roomId: options.roomId,
        sdpLength: answer.sdp?.length ?? 0,
        sessionId: options.sessionId,
        targetSessionId,
      });

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
      viewerPeerLogger.debug("Viewer peer is adding a remote ICE candidate.", {
        candidateType: parseCandidateType(candidate),
        roomId: options.roomId,
        sdpMLineIndex: sdpMLineIndex ?? null,
        sdpMid: sdpMid ?? null,
        sessionId: options.sessionId,
      });
      await peerConnection.addIceCandidate({
        candidate,
        sdpMid,
        sdpMLineIndex,
      });
    },
    close() {
      viewerPeerLogger.info("Closing viewer peer connection.", {
        roomId: options.roomId,
        sessionId: options.sessionId,
      });
      peerConnection.close();
    },
    collectMetrics() {
      return collectViewerPeerMetrics(peerConnection);
    },
  };
}

export async function collectViewerPeerMetrics(
  peerConnection: PeerConnectionLike,
): Promise<ViewerPeerMetrics> {
  const stats = await peerConnection.getStats();
  const codecs = new Map<string, { mimeType: string | null }>();
  const localCandidates = new Map<string, { candidateType: string | null }>();
  const candidatePairs: Array<{
    currentRoundTripTime: number | null;
    localCandidateId: string | null;
    nominated: boolean | null;
    selected: boolean | null;
    state: string | null;
  }> = [];

  for (const report of stats.values()) {
    if (!report || typeof report !== "object") {
      continue;
    }

    const rawReport = report as Record<string, unknown>;
    const reportType = readString(rawReport.type);
    const id = readString(rawReport.id);

    if (reportType === "codec" && id) {
      codecs.set(id, {
        mimeType: readString(rawReport.mimeType),
      });
      continue;
    }

    if (reportType === "local-candidate" && id) {
      localCandidates.set(id, {
        candidateType: readString(rawReport.candidateType),
      });
      continue;
    }

    if (reportType === "candidate-pair") {
      candidatePairs.push({
        currentRoundTripTime: readNumber(rawReport.currentRoundTripTime),
        localCandidateId: readString(rawReport.localCandidateId),
        nominated: readBoolean(rawReport.nominated),
        selected: readBoolean(rawReport.selected),
        state: readString(rawReport.state),
      });
    }
  }
  const videoCodec = findInboundVideoCodec(stats, codecs);

  const selectedPair =
    candidatePairs.find((pair) => pair.selected === true) ??
    candidatePairs.find((pair) => pair.state === "succeeded");

  if (!selectedPair) {
    return {
      connectionType: "unknown",
      pingMs: null,
      videoCodec,
    };
  }

  const localCandidate = selectedPair.localCandidateId
    ? localCandidates.get(selectedPair.localCandidateId)
    : null;
  const candidateType = localCandidate?.candidateType ?? null;

  return {
    connectionType:
      candidateType === "relay"
        ? "relay"
        : candidateType
          ? "direct"
          : "unknown",
    pingMs:
      selectedPair.currentRoundTripTime === null
        ? null
        : Math.round(selectedPair.currentRoundTripTime * 1000),
    videoCodec,
  };
}

function findInboundVideoCodec(
  stats: RTCStatsReport,
  codecs: Map<string, { mimeType: string | null }>,
) {
  for (const report of stats.values()) {
    if (!report || typeof report !== "object") {
      continue;
    }

    const rawReport = report as Record<string, unknown>;
    if (readString(rawReport.type) !== "inbound-rtp") {
      continue;
    }

    const kind = readString(rawReport.kind) ?? readString(rawReport.mediaType);
    if (kind !== "video") {
      continue;
    }

    const codecId = readString(rawReport.codecId);
    const mimeType = codecId ? codecs.get(codecId)?.mimeType ?? null : null;
    return formatVideoCodecLabel(mimeType ?? readString(rawReport.mimeType));
  }

  return null;
}

function formatVideoCodecLabel(mimeType: string | null) {
  if (!mimeType) {
    return null;
  }

  const [, codecName] = mimeType.split("/");
  return codecName ? codecName.toUpperCase() : mimeType.toUpperCase();
}

async function handleConnectionStateChange(
  peerConnection: PeerConnectionLike,
  options: {
    roomId: string;
    sessionId: string;
    onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
  },
) {
  const details = {
    connectionState: peerConnection.connectionState,
    iceConnectionState: peerConnection.iceConnectionState,
    iceGatheringState: peerConnection.iceGatheringState,
    roomId: options.roomId,
    sessionId: options.sessionId,
  };

  options.onConnectionStateChange?.(peerConnection.connectionState);

  if (peerConnection.connectionState === "failed") {
    viewerPeerLogger.error("Viewer peer connection failed.", {
      ...details,
      diagnostics: await collectPeerDiagnostics(peerConnection),
    });
    return;
  }

  if (peerConnection.connectionState === "disconnected") {
    viewerPeerLogger.warn("Viewer peer connection disconnected.", details);
    return;
  }

  viewerPeerLogger.info("Viewer peer connection state changed.", details);
}

type CandidateSummary = {
  id: string;
  address: string | null;
  candidateType: string | null;
  port: number | null;
  protocol: string | null;
};

type CandidatePairSummary = {
  bytesReceived: number | null;
  bytesSent: number | null;
  currentRoundTripTime: number | null;
  id: string | null;
  localCandidate: CandidateSummary | null;
  nominated: boolean | null;
  remoteCandidate: CandidateSummary | null;
  selected: boolean | null;
  state: string | null;
};

async function collectPeerDiagnostics(peerConnection: PeerConnectionLike) {
  const candidates = new Map<string, CandidateSummary>();
  const candidatePairs: Array<{
    bytesReceived: number | null;
    bytesSent: number | null;
    currentRoundTripTime: number | null;
    id: string | null;
    localCandidateId: string | null;
    nominated: boolean | null;
    remoteCandidateId: string | null;
    selected: boolean | null;
    state: string | null;
  }> = [];

  try {
    const stats = await peerConnection.getStats();

    for (const report of stats.values()) {
      if (!report || typeof report !== "object") {
        continue;
      }

      const rawReport = report as Record<string, unknown>;
      const reportType = readString(rawReport.type);

      if (!reportType) {
        continue;
      }

      if (
        (reportType === "local-candidate" ||
          reportType === "remote-candidate") &&
        readString(rawReport.id)
      ) {
        const id = readString(rawReport.id)!;
        candidates.set(id, {
          id,
          address: readString(rawReport.address) ?? readString(rawReport.ip),
          candidateType: readString(rawReport.candidateType),
          port: readNumber(rawReport.port),
          protocol: readString(rawReport.protocol),
        });
        continue;
      }

      if (reportType === "candidate-pair") {
        candidatePairs.push({
          bytesReceived: readNumber(rawReport.bytesReceived),
          bytesSent: readNumber(rawReport.bytesSent),
          currentRoundTripTime: readNumber(rawReport.currentRoundTripTime),
          id: readString(rawReport.id),
          localCandidateId: readString(rawReport.localCandidateId),
          nominated: readBoolean(rawReport.nominated),
          remoteCandidateId: readString(rawReport.remoteCandidateId),
          selected: readBoolean(rawReport.selected),
          state: readString(rawReport.state),
        });
      }
    }

    const candidatePairStates: CandidatePairSummary[] = candidatePairs.map((pair) => ({
      bytesReceived: pair.bytesReceived,
      bytesSent: pair.bytesSent,
      currentRoundTripTime: pair.currentRoundTripTime,
      id: pair.id,
      localCandidate:
        pair.localCandidateId ? candidates.get(pair.localCandidateId) ?? null : null,
      nominated: pair.nominated,
      remoteCandidate:
        pair.remoteCandidateId
          ? candidates.get(pair.remoteCandidateId) ?? null
          : null,
      selected: pair.selected,
      state: pair.state,
    }));

    return {
      activeCandidatePair:
        candidatePairStates.find(
          (pair) =>
            pair.state === "succeeded" || pair.nominated === true || pair.selected === true,
        ) ?? null,
      candidatePairStates,
      statsError: null,
    };
  } catch (error) {
    return {
      activeCandidatePair: null,
      candidatePairStates: [] as CandidatePairSummary[],
      statsError: toErrorMessage(error),
    };
  }
}

function parseCandidateType(candidate: string): string | null {
  const match = / typ ([a-z0-9]+)/i.exec(candidate);
  return match?.[1] ?? null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown error";
}
