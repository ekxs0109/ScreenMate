import { browser, type Browser } from "wxt/browser";
import { createLogger } from "../../lib/logger";
import { readLocalMediaFile, type LocalMediaMetadata } from "../../lib/local-media-store";
import {
  createMediaStreamAttachmentRuntime,
  type MediaStreamAttachmentResponse,
} from "../../lib/media-stream-attachment";

type RoomSession = {
  roomId: string;
  sessionId: string;
  viewerSessionIds: string[];
  iceServers: RTCIceServer[];
};

type OffscreenMessage =
  | { type: "screenmate:offscreen-get-prepared-display-media-state" }
  | { type: "screenmate:offscreen-get-local-playback-state" }
  | { type: "screenmate:offscreen-clear-prepared-source" }
  | {
      type: "screenmate:offscreen-prepare-display-media";
      captureType: "screen" | "window" | "tab";
    }
  | {
      type: "screenmate:offscreen-attach-display-media";
      roomSession: RoomSession;
      sourceLabel: string;
    }
  | {
      type: "screenmate:offscreen-attach-local-file";
      roomSession: RoomSession;
      fileId: string;
      metadata: LocalMediaMetadata;
    }
  | {
      type: "screenmate:offscreen-signal-inbound";
      envelope: Record<string, unknown>;
    }
  | {
      type: "screenmate:offscreen-update-ice-servers";
      iceServers: RTCIceServer[];
    }
  | {
      type: "screenmate:offscreen-local-playback-control";
      action: "play" | "pause" | "seek";
      currentTime?: number;
    }
  | { type: "screenmate:offscreen-detach-source" };

type OffscreenResponse =
  | MediaStreamAttachmentResponse
  | LocalPlaybackState
  | { ok: true }
  | { ok: false; error: string }
  | undefined;
type LocalVideoHandle = {
  video: HTMLVideoElement;
  objectUrl: string;
};
type LocalPlaybackState = {
  status: "local-playback-state";
  active: boolean;
  currentTime: number | null;
  duration: number | null;
  paused: boolean | null;
  sourceLabel: string | null;
};

const LOCAL_VIDEO_METADATA_TIMEOUT_MS = 60_000;
const LOCAL_VIDEO_FRAME_TIMEOUT_MS = 60_000;
const LOCAL_VIDEO_LOAD_ERROR_MESSAGE =
  "Local video file could not be loaded. The browser may not support this file format or codec.";
const HAVE_CURRENT_DATA = 2;
const LOCAL_VIDEO_CAPTURE_RETRY_EVENTS = [
  "loadeddata",
  "canplay",
  "playing",
  "resize",
  "timeupdate",
] as const;

const offscreenLogger = createLogger("offscreen");
const runtime = createMediaStreamAttachmentRuntime({
  onSignal(envelope) {
    void browser.runtime
      .sendMessage({ type: "screenmate:offscreen-signal-outbound", envelope })
      .catch(() => {
        offscreenLogger.warn("Could not forward outbound offscreen signal.");
      });
  },
  onSourceDetached(event) {
    void browser.runtime
      .sendMessage({ type: "screenmate:offscreen-source-detached", ...event })
      .catch(() => {
        offscreenLogger.warn("Could not notify background about detached offscreen source.");
      });
  },
});

let activeVideo: HTMLVideoElement | null = null;
let activeObjectUrl: string | null = null;
let activeLocalSourceMetadata: LocalMediaMetadata | null = null;
let activeDisplayStream: MediaStream | null = null;
let preparedDisplayStream: MediaStream | null = null;

browser.runtime.onMessage.addListener(
  (
    message: OffscreenMessage,
    _sender: Browser.runtime.MessageSender,
    sendResponse: (response: OffscreenResponse) => void,
  ) => {
    if (!isOffscreenMessage(message)) {
      return false;
    }

    queueMicrotask(() => {
      void handleOffscreenMessage(message)
        .then(sendResponse)
        .catch((error) => {
          offscreenLogger.warn("Offscreen message failed.", {
            error: error instanceof Error ? error.message : String(error),
            type: message.type,
          });
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    });

    return true;
  },
);

export async function handleOffscreenMessage(
  message: OffscreenMessage,
): Promise<OffscreenResponse> {
  if (message.type === "screenmate:offscreen-get-prepared-display-media-state") {
    if (!preparedDisplayStream || preparedDisplayStream.getVideoTracks().length === 0) {
      return undefined;
    }

    return {
      sourceLabel: getDisplayMediaSourceLabel(
        "screen",
        preparedDisplayStream.getVideoTracks()[0]?.getSettings?.() ?? {},
      ),
      fingerprint: {
        primaryUrl: "screenmate://display-media",
        pageUrl: location.href,
        elementId: "screenmate-offscreen-display",
        label: "Prepared display media",
        visibleIndex: 0,
      },
    };
  }

  if (message.type === "screenmate:offscreen-get-local-playback-state") {
    return getLocalPlaybackState();
  }

  if (message.type === "screenmate:offscreen-clear-prepared-source") {
    preparedDisplayStream?.getTracks().forEach((track) => track.stop());
    preparedDisplayStream = null;
    return { ok: true };
  }

  if (message.type === "screenmate:offscreen-prepare-display-media") {
    preparedDisplayStream?.getTracks().forEach((track) => track.stop());
    preparedDisplayStream = await navigator.mediaDevices.getDisplayMedia(
      buildDisplayMediaOptions(message.captureType),
    );
    const settings = preparedDisplayStream.getVideoTracks()[0]?.getSettings?.() ?? {};
    const sourceLabel = getDisplayMediaSourceLabel(message.captureType, settings);

    return {
      sourceLabel,
      fingerprint: {
        primaryUrl: "screenmate://display-media",
        pageUrl: location.href,
        elementId: "screenmate-offscreen-display",
        label: sourceLabel,
        visibleIndex: 0,
      },
    };
  }

  if (message.type === "screenmate:offscreen-attach-display-media") {
    if (!preparedDisplayStream || preparedDisplayStream.getVideoTracks().length === 0) {
      throw new Error("No prepared display media stream is available.");
    }
    const nextDisplayStream = preparedDisplayStream;
    const settings = nextDisplayStream.getVideoTracks()[0]?.getSettings?.() ?? {};

    const response = await runtime.attachStream({
      roomId: message.roomSession.roomId,
      sessionId: message.roomSession.sessionId,
      sourceLabel: message.sourceLabel,
      sourceHeight: typeof settings.height === "number" ? settings.height : null,
      sourceWidth: typeof settings.width === "number" ? settings.width : null,
      stream: nextDisplayStream,
      viewerSessionIds: message.roomSession.viewerSessionIds,
      iceServers: message.roomSession.iceServers,
      fingerprint: {
        primaryUrl: "screenmate://display-media",
        pageUrl: location.href,
        elementId: "screenmate-offscreen-display",
        label: message.sourceLabel,
        visibleIndex: 0,
      },
    });
    activeDisplayStream = nextDisplayStream;
    preparedDisplayStream = null;
    cleanupLocalVideo();
    return response;
  }

  if (message.type === "screenmate:offscreen-attach-local-file") {
    let stage = "stopping-existing-source";
    let localVideo: LocalVideoHandle | null = null;

    try {
      offscreenLogger.info("Local file source attach requested.", {
        fileId: message.fileId,
        metadataName: message.metadata.name,
        metadataSize: message.metadata.size,
        metadataType: message.metadata.type,
        roomId: message.roomSession.roomId,
        viewerSessionCount: message.roomSession.viewerSessionIds.length,
      });
      preparedDisplayStream?.getTracks().forEach((track) => track.stop());
      preparedDisplayStream = null;
      stopActiveDisplayStreamForReplacement();

      stage = "reading-local-file";
      const record = await readLocalMediaFile(message.fileId);
      if (!record) {
        throw new Error("Local media file is no longer available.");
      }

      offscreenLogger.info("Local media file loaded from browser storage.", {
        blobSize: record.blob.size,
        blobType: record.blob.type,
        fileId: record.id,
        name: record.name,
        roomId: message.roomSession.roomId,
      });

      stage = "creating-local-video";
      localVideo = await createLocalVideo(record.blob);
      offscreenLogger.info("Local video element is ready for stream capture.", {
        duration: Number.isFinite(localVideo.video.duration)
          ? localVideo.video.duration
          : null,
        readyState: localVideo.video.readyState,
        roomId: message.roomSession.roomId,
        videoHeight: localVideo.video.videoHeight || null,
        videoWidth: localVideo.video.videoWidth || null,
      });

      stage = "capturing-local-video-stream";
      const stream = await captureVideoStreamWithTracks(localVideo.video);
      const streamTracks = stream.getTracks();
      offscreenLogger.info("Captured local video media stream.", {
        audioTrackCount: stream.getAudioTracks().length,
        roomId: message.roomSession.roomId,
        trackCount: streamTracks.length,
        trackKinds: streamTracks.map((track) => track.kind),
        videoTrackCount: stream.getVideoTracks().length,
      });

      stage = "attaching-local-video-stream";
      const response = await runtime.attachStream({
        roomId: message.roomSession.roomId,
        sessionId: message.roomSession.sessionId,
        sourceLabel: record.name,
        sourceHeight: localVideo.video.videoHeight || null,
        sourceWidth: localVideo.video.videoWidth || null,
        stream,
        viewerSessionIds: message.roomSession.viewerSessionIds,
        iceServers: message.roomSession.iceServers,
        fingerprint: {
          primaryUrl: `screenmate://local-file/${record.id}`,
          pageUrl: location.href,
          elementId: "screenmate-offscreen-local-video",
          label: record.name,
          visibleIndex: 0,
        },
      });
      activeDisplayStream = null;
      cleanupLocalVideo();
      activeVideo = localVideo.video;
      activeObjectUrl = localVideo.objectUrl;
      activeLocalSourceMetadata = message.metadata;
      offscreenLogger.info("Local file source attached.", {
        responseSourceLabel: response.sourceLabel,
        roomId: message.roomSession.roomId,
      });
      return response;
    } catch (error) {
      offscreenLogger.warn("Local file source attach failed.", {
        error: error instanceof Error ? error.message : String(error),
        fileId: message.fileId,
        roomId: message.roomSession.roomId,
        stage,
      });
      if (localVideo) {
        cleanupLocalVideo(localVideo);
      }
      throw error;
    }
  }

  if (message.type === "screenmate:offscreen-signal-inbound") {
    await runtime.handleSignal(message.envelope as Parameters<typeof runtime.handleSignal>[0]);
    return { ok: true };
  }

  if (message.type === "screenmate:offscreen-update-ice-servers") {
    runtime.updateIceServers(message.iceServers);
    return { ok: true };
  }

  if (message.type === "screenmate:offscreen-local-playback-control") {
    applyLocalPlaybackControl(message);
    return { ok: true };
  }

  runtime.destroy("manual-detach");
  activeDisplayStream?.getTracks().forEach((track) => track.stop());
  activeDisplayStream = null;
  preparedDisplayStream?.getTracks().forEach((track) => track.stop());
  preparedDisplayStream = null;
  cleanupLocalVideo();
  return { ok: true };
}

function buildDisplayMediaOptions(captureType: "screen" | "window" | "tab") {
  const displaySurface =
    captureType === "screen"
      ? "monitor"
      : captureType === "window"
        ? "window"
        : "browser";

  return {
    audio: true,
    video: {
      displaySurface,
    },
  } as DisplayMediaStreamOptions;
}

function getDisplayMediaSourceLabel(
  captureType: "screen" | "window" | "tab",
  settings: MediaTrackSettings,
) {
  const displaySurface = settings.displaySurface;
  if (displaySurface === "window" || captureType === "window") {
    return "Shared window";
  }

  if (displaySurface === "browser" || captureType === "tab") {
    return "Shared browser tab";
  }

  return "Shared screen";
}

async function createLocalVideo(blob: Blob): Promise<LocalVideoHandle> {
  const video = document.createElement("video");
  video.id = "screenmate-offscreen-local-video";
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.controls = false;
  const objectUrl = URL.createObjectURL(blob);
  video.src = objectUrl;
  document.body.append(video);
  const handle = { video, objectUrl };
  try {
    await waitForVideoEvent(video, "loadedmetadata");
    await video.play().catch(() => undefined);
    return handle;
  } catch (error) {
    cleanupLocalVideo(handle);
    throw error;
  }
}

async function captureVideoStreamWithTracks(video: HTMLVideoElement) {
  const deadline = Date.now() + LOCAL_VIDEO_FRAME_TIMEOUT_MS;
  let observedVideoFrame = hasUsableVideoFrame(video);
  let stream = captureVideoStream(video);
  if (isCaptureReady(video, stream, observedVideoFrame)) {
    return stream;
  }

  offscreenLogger.warn("Local video stream is not frame-ready; waiting before capture.", {
    capture: describeCaptureReadiness(video, stream, observedVideoFrame),
  });

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

  offscreenLogger.warn("Local video stream is still not frame-ready after waiting.", {
    capture: describeCaptureReadiness(video, stream, observedVideoFrame),
    timeoutMs: LOCAL_VIDEO_FRAME_TIMEOUT_MS,
  });
  throw new Error("Local video stream did not expose a frame-ready video track.");
}

function captureVideoStream(video: HTMLVideoElement) {
  const streamableVideo = video as HTMLVideoElement & {
    captureStream?: () => MediaStream;
    mozCaptureStream?: () => MediaStream;
  };

  if (typeof streamableVideo.captureStream === "function") {
    return streamableVideo.captureStream();
  }

  if (typeof streamableVideo.mozCaptureStream === "function") {
    return streamableVideo.mozCaptureStream();
  }

  throw new Error("Video stream capture is not supported.");
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
      for (const eventName of LOCAL_VIDEO_CAPTURE_RETRY_EVENTS) {
        video.removeEventListener(eventName, handleRetryEvent);
      }
    };
    const handleRetryEvent = () => {
      cleanup();
      resolve("media-event");
    };

    for (const eventName of LOCAL_VIDEO_CAPTURE_RETRY_EVENTS) {
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

function isCaptureReady(
  video: HTMLVideoElement,
  stream: MediaStream,
  observedVideoFrame: boolean,
) {
  return (
    stream.getVideoTracks().length > 0 &&
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
    hasVideoTrack: stream.getVideoTracks().length > 0,
    observedVideoFrame,
    readyState: video.readyState,
  };
}

function applyLocalPlaybackControl(
  message: Extract<OffscreenMessage, { type: "screenmate:offscreen-local-playback-control" }>,
) {
  if (!activeVideo) {
    return;
  }

  if (typeof message.currentTime === "number") {
    activeVideo.currentTime = message.currentTime;
  }

  if (message.action === "play") {
    void activeVideo.play();
  } else if (message.action === "pause") {
    activeVideo.pause();
  }
}

function getLocalPlaybackState(): LocalPlaybackState {
  if (!activeVideo) {
    return {
      status: "local-playback-state",
      active: false,
      currentTime: null,
      duration: null,
      paused: null,
      sourceLabel: null,
    };
  }

  return {
    status: "local-playback-state",
    active: true,
    currentTime: Number.isFinite(activeVideo.currentTime)
      ? activeVideo.currentTime
      : 0,
    duration: Number.isFinite(activeVideo.duration)
      ? activeVideo.duration
      : null,
    paused: activeVideo.paused,
    sourceLabel: activeLocalSourceMetadata?.name ?? null,
  };
}

function cleanupLocalVideo(handle?: LocalVideoHandle) {
  const video = handle?.video ?? activeVideo;
  const objectUrl = handle?.objectUrl ?? activeObjectUrl;
  video?.pause();
  video?.remove();
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
  }
  if (!handle) {
    activeVideo = null;
    activeObjectUrl = null;
    activeLocalSourceMetadata = null;
  }
}

function stopActiveDisplayStreamForReplacement() {
  if (!activeDisplayStream) {
    return;
  }

  const displayStream = activeDisplayStream;
  runtime.detachForReplacement();
  for (const track of displayStream.getTracks()) {
    track.stop();
  }
  activeDisplayStream = null;
}

function waitForVideoEvent(
  video: HTMLVideoElement,
  eventName: string,
  timeoutMs = LOCAL_VIDEO_METADATA_TIMEOUT_MS,
) {
  return new Promise<void>((resolve, reject) => {
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(LOCAL_VIDEO_LOAD_ERROR_MESSAGE));
    }, timeoutMs);
    const handleLoaded = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error(LOCAL_VIDEO_LOAD_ERROR_MESSAGE));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener(eventName, handleLoaded);
      video.removeEventListener("error", handleError);
    };

    video.addEventListener(eventName, handleLoaded, { once: true });
    video.addEventListener("error", handleError, { once: true });
  });
}

function isOffscreenMessage(message: unknown): message is OffscreenMessage {
  if (
    typeof message !== "object" ||
    message === null ||
    !("type" in message) ||
    typeof message.type !== "string"
  ) {
    return false;
  }

  return (
    message.type === "screenmate:offscreen-get-prepared-display-media-state" ||
    message.type === "screenmate:offscreen-get-local-playback-state" ||
    message.type === "screenmate:offscreen-clear-prepared-source" ||
    message.type === "screenmate:offscreen-prepare-display-media" ||
    message.type === "screenmate:offscreen-attach-display-media" ||
    message.type === "screenmate:offscreen-attach-local-file" ||
    message.type === "screenmate:offscreen-signal-inbound" ||
    message.type === "screenmate:offscreen-update-ice-servers" ||
    message.type === "screenmate:offscreen-local-playback-control" ||
    message.type === "screenmate:offscreen-detach-source"
  );
}
