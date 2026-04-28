import { errorCodes } from "@screenmate/shared";
import { createLogger } from "../../lib/logger";
import {
  createMediaStreamAttachmentRuntime,
  type MediaStreamAttachmentReason,
} from "../../lib/media-stream-attachment";
import { captureVideoStream } from "./video-capture";
import {
  findVisibleVideoByHandle,
  listVisibleVideoCandidates,
} from "./video-detector";

const sourceAttachmentLogger = createLogger("content:source-attachment");
const CAPTURE_STREAM_TRACK_TIMEOUT_MS = 3_000;
const CAPTURE_STREAM_TRACK_RETRY_EVENTS = [
  "loadedmetadata",
  "loadeddata",
  "canplay",
  "playing",
  "resize",
  "timeupdate",
] as const;

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

export function createSourceAttachmentRuntime(options: {
  onSignal: (envelope: Record<string, unknown>) => void;
  onSourceDetached: (event: {
    roomId: string;
    reason: MediaStreamAttachmentReason;
  }) => void;
  RTCPeerConnectionImpl?: new (
    config?: RTCConfiguration,
  ) => HostPeerConnection;
  now?: () => number;
  captureStreamTrackTimeoutMs?: number;
}) {
  const mediaRuntime = createMediaStreamAttachmentRuntime({
    onSignal: options.onSignal,
    onSourceDetached: options.onSourceDetached,
    RTCPeerConnectionImpl: options.RTCPeerConnectionImpl,
    now: options.now,
  });

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

    const stream = await captureVideoStreamWithTracks(video);
    const sourceLabel = video.currentSrc || video.src || "Visible video";

    sourceAttachmentLogger.info("Source stream captured for active room.", {
      roomId: input.roomId,
      sessionId: input.sessionId,
      sourceLabel,
      capture: describeVideoForCapture(video),
      readyState: video.readyState,
      sourceHeight: video.videoHeight || null,
      sourceWidth: video.videoWidth || null,
      trackCount: stream.getTracks().length,
      trackKinds: stream.getTracks().map((track) => track.kind),
      videoTrackCount: getCapturedVideoTracks(stream).length,
      viewerSessionCount: input.viewerSessionIds.length,
    });

    return mediaRuntime.attachStream({
      roomId: input.roomId,
      sessionId: input.sessionId,
      sourceLabel,
      sourceHeight: video.videoHeight || null,
      sourceWidth: video.videoWidth || null,
      stream,
      viewerSessionIds: input.viewerSessionIds,
      iceServers: input.iceServers,
      fingerprint: {
        primaryUrl: video.currentSrc || video.src || video.getAttribute("poster"),
        pageUrl: window.location.href,
        elementId: video.id || null,
        label: sourceLabel,
        visibleIndex: listVisibleVideoCandidates().findIndex(
          (candidate) => candidate.id === input.videoId,
        ),
      },
    });
  }

  async function captureVideoStreamWithTracks(video: HTMLVideoElement) {
    const timeoutMs =
      options.captureStreamTrackTimeoutMs ?? CAPTURE_STREAM_TRACK_TIMEOUT_MS;
    let stream = captureVideoStream(video);
    if (getCapturedVideoTracks(stream).length > 0) {
      return stream;
    }

    sourceAttachmentLogger.warn("Captured source stream has no video tracks; waiting for media readiness.", {
      capture: describeVideoForCapture(video),
      stream: describeCapturedStream(stream),
    });

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await waitForCaptureRetryEvent(video, Math.max(0, deadline - Date.now()));
      stream = captureVideoStream(video);
      if (getCapturedVideoTracks(stream).length > 0) {
        return stream;
      }
    }

    sourceAttachmentLogger.warn("Captured source stream still has no video tracks after waiting.", {
      capture: describeVideoForCapture(video),
      stream: describeCapturedStream(stream),
      timeoutMs,
    });
    throw new Error(errorCodes.NO_VIDEO_FOUND);
  }

  function waitForCaptureRetryEvent(
    video: HTMLVideoElement,
    timeoutMs: number,
  ) {
    return new Promise<void>((resolve) => {
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const cleanup = () => {
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        for (const eventName of CAPTURE_STREAM_TRACK_RETRY_EVENTS) {
          video.removeEventListener(eventName, handleRetryEvent);
        }
      };
      const handleRetryEvent = () => {
        cleanup();
        resolve();
      };

      for (const eventName of CAPTURE_STREAM_TRACK_RETRY_EVENTS) {
        video.addEventListener(eventName, handleRetryEvent, { once: true });
      }
      timeout = setTimeout(() => {
        cleanup();
        resolve();
      }, timeoutMs);
    });
  }

  return {
    attachSource,
    beginViewerNegotiation: mediaRuntime.beginViewerNegotiation,
    handleSignal: mediaRuntime.handleSignal,
    updateIceServers: mediaRuntime.updateIceServers,
    destroy: mediaRuntime.destroy,
  };
}

function getCapturedVideoTracks(stream: MediaStream) {
  return stream.getTracks().filter((track) => track.kind === "video");
}

function describeCapturedStream(stream: MediaStream) {
  const tracks = stream.getTracks();
  return {
    trackCount: tracks.length,
    trackKinds: tracks.map((track) => track.kind),
    videoTrackCount: tracks.filter((track) => track.kind === "video").length,
  };
}

function describeVideoForCapture(video: HTMLVideoElement) {
  return {
    currentSrc: video.currentSrc || null,
    ended: video.ended,
    muted: video.muted,
    networkState: video.networkState,
    paused: video.paused,
    readyState: video.readyState,
    sourceHeight: video.videoHeight || null,
    sourceWidth: video.videoWidth || null,
    src: video.src || null,
  };
}
