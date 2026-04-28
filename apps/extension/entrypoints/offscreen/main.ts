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

type OffscreenResponse = MediaStreamAttachmentResponse | { ok: true } | undefined;

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
          sendResponse(undefined);
        });
    });

    return true;
  },
);

async function handleOffscreenMessage(
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
    cleanupLocalVideo();
    if (!preparedDisplayStream || preparedDisplayStream.getVideoTracks().length === 0) {
      throw new Error("No prepared display media stream is available.");
    }
    activeDisplayStream?.getTracks().forEach((track) => track.stop());
    activeDisplayStream = preparedDisplayStream;
    preparedDisplayStream = null;
    const settings = activeDisplayStream.getVideoTracks()[0]?.getSettings?.() ?? {};

    return runtime.attachStream({
      roomId: message.roomSession.roomId,
      sessionId: message.roomSession.sessionId,
      sourceLabel: message.sourceLabel,
      sourceHeight: typeof settings.height === "number" ? settings.height : null,
      sourceWidth: typeof settings.width === "number" ? settings.width : null,
      stream: activeDisplayStream,
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
  }

  if (message.type === "screenmate:offscreen-attach-local-file") {
    activeDisplayStream?.getTracks().forEach((track) => track.stop());
    activeDisplayStream = null;
    preparedDisplayStream?.getTracks().forEach((track) => track.stop());
    preparedDisplayStream = null;
    const record = await readLocalMediaFile(message.fileId);
    if (!record) {
      throw new Error("Local media file is no longer available.");
    }

    const video = await createLocalVideo(record.blob);
    const stream = await captureVideoStreamWithTracks(video);

    return runtime.attachStream({
      roomId: message.roomSession.roomId,
      sessionId: message.roomSession.sessionId,
      sourceLabel: record.name,
      sourceHeight: video.videoHeight || null,
      sourceWidth: video.videoWidth || null,
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

async function createLocalVideo(blob: Blob) {
  cleanupLocalVideo();
  const video = document.createElement("video");
  video.id = "screenmate-offscreen-local-video";
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.controls = false;
  activeObjectUrl = URL.createObjectURL(blob);
  video.src = activeObjectUrl;
  document.body.append(video);
  activeVideo = video;
  await waitForVideoEvent(video, "loadedmetadata");
  await video.play().catch(() => undefined);
  return video;
}

function captureVideoStreamWithTracks(video: HTMLVideoElement) {
  return new Promise<MediaStream>((resolve, reject) => {
    const capture = () => {
      const stream = captureVideoStream(video);
      if (stream.getVideoTracks().length > 0) {
        resolve(stream);
        return true;
      }
      return false;
    };

    if (capture()) {
      return;
    }

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Local video stream did not expose a video track."));
    }, 3_000);
    const retry = () => {
      if (capture()) {
        cleanup();
      }
    };
    const cleanup = () => {
      clearTimeout(timeout);
      for (const eventName of ["loadeddata", "canplay", "playing", "timeupdate"]) {
        video.removeEventListener(eventName, retry);
      }
    };

    for (const eventName of ["loadeddata", "canplay", "playing", "timeupdate"]) {
      video.addEventListener(eventName, retry);
    }
  });
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

function cleanupLocalVideo() {
  activeVideo?.pause();
  activeVideo?.remove();
  activeVideo = null;
  if (activeObjectUrl) {
    URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = null;
  }
}

function waitForVideoEvent(video: HTMLVideoElement, eventName: string) {
  return new Promise<void>((resolve) => {
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      resolve();
      return;
    }
    video.addEventListener(eventName, () => resolve(), { once: true });
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
