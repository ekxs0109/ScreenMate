import { errorCodes } from "@screenmate/shared";
import { createLogger } from "../../lib/logger";
import {
  createMediaStreamAttachmentRuntime,
  type MediaStreamAttachmentReason,
} from "../../lib/media-stream-attachment";
import { captureVideoStream } from "../content/video-capture";

const playerAttachmentLogger = createLogger("player:source-attachment");
const CAPTURE_STREAM_TRACK_TIMEOUT_MS = 60_000;
const CAPTURE_STREAM_TRACK_RETRY_EVENTS = [
  "loadedmetadata",
  "loadeddata",
  "canplay",
  "playing",
  "resize",
  "timeupdate",
] as const;
const HAVE_CURRENT_DATA = 2;

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

export type PlayerRoomSession = {
  roomId: string;
  sessionId: string;
  viewerSessionIds: string[];
  iceServers: RTCIceServer[];
};

export function createPlayerSourceAttachmentRuntime(options: {
  getVideo: () => HTMLVideoElement | null;
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

  async function attachLocalVideo(input: {
    roomSession: PlayerRoomSession;
    sourceLabel: string;
  }) {
    const video = options.getVideo();
    if (!video) {
      throw new Error("Local player video is not ready.");
    }

    playerAttachmentLogger.info("Player local source attach requested.", {
      roomId: input.roomSession.roomId,
      sessionId: input.roomSession.sessionId,
      sourceLabel: input.sourceLabel,
      viewerSessionCount: input.roomSession.viewerSessionIds.length,
    });

    const stream = await captureVideoStreamWithTracks(video);
    const tracks = stream.getTracks();
    playerAttachmentLogger.info("Player local source stream captured.", {
      roomId: input.roomSession.roomId,
      sourceLabel: input.sourceLabel,
      trackCount: tracks.length,
      trackKinds: tracks.map((track) => track.kind),
      videoTrackCount: getCapturedVideoTracks(stream).length,
      video: describeVideoForCapture(video),
    });

    return mediaRuntime.attachStream({
      roomId: input.roomSession.roomId,
      sessionId: input.roomSession.sessionId,
      sourceLabel: input.sourceLabel,
      sourceHeight: video.videoHeight || null,
      sourceWidth: video.videoWidth || null,
      stream,
      viewerSessionIds: input.roomSession.viewerSessionIds,
      iceServers: input.roomSession.iceServers,
      fingerprint: {
        primaryUrl: "screenmate://player-local-video",
        pageUrl: window.location.href,
        elementId: video.id || "screenmate-player-local-video",
        label: input.sourceLabel,
        visibleIndex: 0,
      },
    });
  }

  async function captureVideoStreamWithTracks(video: HTMLVideoElement) {
    const timeoutMs =
      options.captureStreamTrackTimeoutMs ?? CAPTURE_STREAM_TRACK_TIMEOUT_MS;
    let stream = captureVideoStream(video);
    let observedVideoFrame = hasUsableVideoFrame(video);
    if (isCaptureReady(video, stream, observedVideoFrame)) {
      return stream;
    }

    playerAttachmentLogger.warn(
      "Player capture stream is not frame-ready; waiting for media readiness.",
      {
        capture: describeCaptureReadiness(video, stream, observedVideoFrame),
        stream: describeCapturedStream(stream),
        video: describeVideoForCapture(video),
      },
    );

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const retryReason = await waitForCaptureRetryEvent(
        video,
        Math.max(0, deadline - Date.now()),
      );
      observedVideoFrame ||= retryReason === "video-frame";
      stream = captureVideoStream(video);
      if (isCaptureReady(video, stream, observedVideoFrame)) {
        return stream;
      }
    }

    playerAttachmentLogger.warn(
      "Player capture stream is still not frame-ready after waiting.",
      {
        capture: describeCaptureReadiness(video, stream, observedVideoFrame),
        stream: describeCapturedStream(stream),
        timeoutMs,
        video: describeVideoForCapture(video),
      },
    );
    throw new Error(errorCodes.NO_VIDEO_FOUND);
  }

  return {
    attachLocalVideo,
    handleSignal: mediaRuntime.handleSignal,
    updateIceServers: mediaRuntime.updateIceServers,
    destroy: mediaRuntime.destroy,
  };
}

function waitForCaptureRetryEvent(
  video: HTMLVideoElement,
  timeoutMs: number,
) {
  return new Promise<"media-event" | "timeout" | "video-frame">((resolve) => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let frameCallbackId: number | null = null;
    const frameVideo = video as HTMLVideoElement & {
      cancelVideoFrameCallback?: (handle: number) => void;
      requestVideoFrameCallback?: (
        callback: (now: number, metadata: VideoFrameCallbackMetadata) => void,
      ) => number;
    };
    const cleanup = () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      if (
        frameCallbackId !== null &&
        typeof frameVideo.cancelVideoFrameCallback === "function"
      ) {
        frameVideo.cancelVideoFrameCallback(frameCallbackId);
        frameCallbackId = null;
      }
      for (const eventName of CAPTURE_STREAM_TRACK_RETRY_EVENTS) {
        video.removeEventListener(eventName, handleRetryEvent);
      }
    };
    const handleRetryEvent = () => {
      cleanup();
      resolve("media-event");
    };

    for (const eventName of CAPTURE_STREAM_TRACK_RETRY_EVENTS) {
      video.addEventListener(eventName, handleRetryEvent, { once: true });
    }
    if (typeof frameVideo.requestVideoFrameCallback === "function") {
      frameCallbackId = frameVideo.requestVideoFrameCallback(() => {
        cleanup();
        resolve("video-frame");
      });
    }
    timeout = setTimeout(() => {
      cleanup();
      resolve("timeout");
    }, timeoutMs);
  });
}

function getCapturedVideoTracks(stream: MediaStream) {
  return stream.getTracks().filter((track) => track.kind === "video");
}

function isCaptureReady(
  video: HTMLVideoElement,
  stream: MediaStream,
  observedVideoFrame: boolean,
) {
  return (
    getCapturedVideoTracks(stream).length > 0 &&
    (observedVideoFrame || hasUsableVideoFrame(video))
  );
}

function hasUsableVideoFrame(video: HTMLVideoElement) {
  return video.readyState >= HAVE_CURRENT_DATA;
}

function describeCaptureReadiness(
  video: HTMLVideoElement,
  stream: MediaStream,
  observedVideoFrame: boolean,
) {
  return {
    hasUsableVideoFrame: observedVideoFrame || hasUsableVideoFrame(video),
    hasVideoTrack: getCapturedVideoTracks(stream).length > 0,
    observedVideoFrame,
    readyState: video.readyState,
  };
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
