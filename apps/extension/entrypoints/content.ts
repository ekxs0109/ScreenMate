import { browser, type Browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import { createLogger } from "../lib/logger";
import { createContentChatWidgetController } from "./content/content-chat-widget";
import { createSourceAttachmentRuntime } from "./content/source-attachment";
import { createVideoPreviewController } from "./content/video-preview";
import {
  collectPageVideos,
  getVideoDetectionDiagnostics,
  getVideoHandle,
  listAllPageVideoCandidates,
  listVisibleVideoCandidates,
  listVisibleVideoSources,
  type VideoSource,
} from "./content/video-detector";

type RoomSession = {
  roomId: string;
  sessionId: string;
  viewerSessionIds: string[];
  iceServers: RTCIceServer[];
};

export type ListVideosMessage = {
  type: "screenmate:list-videos";
};

export type ContentControlMessage =
  | {
      type: "screenmate:detach-source";
    }
  | {
      type: "screenmate:attach-source";
      videoId: string;
      roomSession: RoomSession;
    }
  | {
      type: "screenmate:signal-inbound";
      envelope: Record<string, unknown>;
    }
  | {
      type: "screenmate:update-ice-servers";
      iceServers: RTCIceServer[];
    }
  | {
      type: "screenmate:preview-video";
      videoId: string;
      frameId: number;
      label: string;
      active?: boolean;
    }
  | { type: "screenmate:clear-preview" };

type ContentMessage = ListVideosMessage | ContentControlMessage;
type ListenerResponse =
  | VideoSource[]
  | {
      sourceLabel: string;
      fingerprint: {
        primaryUrl: string | null;
        pageUrl: string | null;
        elementId: string | null;
        label: string;
        visibleIndex: number;
      };
    }
  | { ok: true };

const contentLogger = createLogger("content");
const VIDEO_CHANGE_EVENT_NAMES = [
  "abort",
  "loadedmetadata",
  "loadeddata",
  "loadstart",
  "canplay",
  "durationchange",
  "error",
  "resize",
  "emptied",
  "stalled",
] as const;

export function createVideoMessageListener(
  sourceAttachmentRuntime?: ReturnType<typeof createSourceAttachmentRuntime>,
  previewController = createVideoPreviewController(),
  chatWidget = createContentChatWidgetController(),
) {
  return (
    message: ContentMessage,
    _sender: Browser.runtime.MessageSender,
    sendResponse: (response: ListenerResponse) => void,
  ) => {
    if (message.type === "screenmate:list-videos") {
      queueMicrotask(() => {
        const videos = listVisibleVideoSources();
        const diagnostics = getVideoDetectionDiagnostics();
        contentLogger.info("Listed page videos.", {
          diagnostics,
          totalVideos: videos.length,
        });
        sendResponse(videos);
      });

      return true;
    }

    if (
      message.type === "screenmate:attach-source" &&
      sourceAttachmentRuntime &&
      typeof message.videoId === "string"
    ) {
      queueMicrotask(() => {
        contentLogger.info("Attaching source for active room.", {
          href: window.location.href,
          roomId: message.roomSession.roomId,
          videoId: message.videoId,
        });
        void sourceAttachmentRuntime
          .attachSource({
            ...message.roomSession,
            videoId: message.videoId,
          })
          .then((response) => {
            chatWidget.show();
            sendResponse(response);
          });
      });

      return true;
    }

    if (
      message.type === "screenmate:signal-inbound" &&
      sourceAttachmentRuntime
    ) {
      queueMicrotask(() => {
        void sourceAttachmentRuntime
          .handleSignal(
            message.envelope as Parameters<
              ReturnType<typeof createSourceAttachmentRuntime>["handleSignal"]
            >[0],
          )
          .then(() => {
            sendResponse({ ok: true });
          });
      });

      return true;
    }

    if (
      message.type === "screenmate:update-ice-servers" &&
      sourceAttachmentRuntime
    ) {
      queueMicrotask(() => {
        sourceAttachmentRuntime.updateIceServers(message.iceServers);
        sendResponse({ ok: true });
      });

      return true;
    }

    if (
      message.type === "screenmate:detach-source" &&
      sourceAttachmentRuntime
    ) {
      queueMicrotask(() => {
        contentLogger.info("Detaching source for active room.", {
          href: window.location.href,
        });
        sourceAttachmentRuntime.destroy("manual-detach");
        chatWidget.hide();
        sendResponse({ ok: true });
      });

      return true;
    }

    if (message.type === "screenmate:clear-preview") {
      queueMicrotask(() => {
        contentLogger.info("Clearing page preview.", {
          href: window.location.href,
        });
        sendResponse(previewController.clear());
      });

      return true;
    }

    if (
      message.type === "screenmate:preview-video" &&
      typeof message.videoId === "string" &&
      typeof message.frameId === "number" &&
      typeof message.label === "string"
    ) {
      queueMicrotask(() => {
        contentLogger.info("Updating page preview.", {
          active: message.active === true,
          frameId: message.frameId,
          href: window.location.href,
          videoId: message.videoId,
        });
        sendResponse(
          previewController.preview({
            active: message.active === true,
            frameId: message.frameId,
            label: message.label,
            videoId: message.videoId,
          }),
        );
      });

      return true;
    }

    return undefined;
  };
}

export default defineContentScript({
  matches: ["<all_urls>"],
  allFrames: true,
  main(ctx) {
    const sourceAttachmentRuntime = createSourceAttachmentRuntime({
      onSignal(envelope) {
        void browser.runtime.sendMessage({
          type: "screenmate:signal-outbound",
          envelope,
        });
      },
      onSourceDetached(event) {
        contentLogger.warn("Attached source detached.", {
          href: window.location.href,
          reason: event.reason,
          roomId: event.roomId,
        });
        void browser.runtime.sendMessage({
          type: "screenmate:source-detached",
          frameId: 0,
          reason: event.reason,
        });
      },
    });
    const previewController = createVideoPreviewController();
    const chatWidget = createContentChatWidgetController();
    const listener = createVideoMessageListener(
      sourceAttachmentRuntime,
      previewController,
      chatWidget,
    );

    // Send content-ready with ALL page video candidates (including
    // non-renderable ones) so the background can fingerprint-match even
    // before the video element is fully initialised (e.g. Bilibili blob URLs).
    const notifyContentReady = (reason = "manual") => {
      const videos = buildContentReadyVideos();
      contentLogger.info("Notifying content-ready.", {
        href: window.location.href,
        reason,
        totalVideos: videos.length,
      });
      void browser.runtime.sendMessage({
        type: "screenmate:content-ready",
        frameId: 0,
        videos: videos.map((video) => ({
          ...video,
          frameId: 0,
        })),
      });
    };

    contentLogger.info("Content script booted.", getVideoDetectionDiagnostics());
    browser.runtime.onMessage.addListener(listener);
    const videoChangeNotifier = createVideoChangeNotifier({
      notify: notifyContentReady,
    });
    videoChangeNotifier.start();

    ctx.onInvalidated(() => {
      videoChangeNotifier.stop();
      previewController.destroy();
      sourceAttachmentRuntime.destroy("content-invalidated");
      browser.runtime.onMessage.removeListener(listener);
    });
  },
});

export function createVideoChangeNotifier({
  debounceMs = 500,
  highFrequencyLifetimeMs = 15_000,
  lowFrequencyPollIntervalMs = 2_000,
  notify,
  pollIntervalMs = 1_000,
}: {
  debounceMs?: number;
  highFrequencyLifetimeMs?: number;
  lowFrequencyPollIntervalMs?: number | null;
  notify: (reason?: string) => void;
  pollIntervalMs?: number;
}) {
  let mutationObserver: MutationObserver | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let highFrequencyTimeout: ReturnType<typeof setTimeout> | null = null;
  let lastSeenVideoCount = 0;
  let lastSeenSrcSignature = "";
  const trackedVideos = new Set<HTMLVideoElement>();
  const srcObjectIds = new WeakMap<object, number>();
  let nextSrcObjectId = 1;

  const scheduleNotify = (reason: string) => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      refreshTrackedVideos();
      updateLandscapeSignature();
      notify(reason);
    }, debounceMs);
  };

  const handleVideoEvent = (event: Event) => {
    scheduleNotify(`video-${event.type}`);
  };

  const trackVideo = (video: HTMLVideoElement) => {
    if (trackedVideos.has(video)) {
      return;
    }

    trackedVideos.add(video);
    for (const eventName of VIDEO_CHANGE_EVENT_NAMES) {
      video.addEventListener(eventName, handleVideoEvent);
    }
  };

  const untrackDisconnectedVideos = () => {
    for (const video of Array.from(trackedVideos)) {
      if (video.isConnected) {
        continue;
      }

      for (const eventName of VIDEO_CHANGE_EVENT_NAMES) {
        video.removeEventListener(eventName, handleVideoEvent);
      }
      trackedVideos.delete(video);
    }
  };

  const refreshTrackedVideos = () => {
    untrackDisconnectedVideos();
    for (const video of collectPageVideos()) {
      trackVideo(video);
    }
  };

  const updateLandscapeSignature = () => {
    lastSeenVideoCount = collectPageVideos().length;
    lastSeenSrcSignature = getVideoSrcSignature();
  };

  const checkLandscape = () => {
    refreshTrackedVideos();
    const currentPageVideoCount = collectPageVideos().length;
    const currentSrcSignature = getVideoSrcSignature();
    const videoCountChanged = currentPageVideoCount !== lastSeenVideoCount;
    const srcChanged = currentSrcSignature !== lastSeenSrcSignature;

    if (!videoCountChanged && !srcChanged) {
      return;
    }

    contentLogger.info("Video landscape changed, scheduling content-ready.", {
      currentCount: currentPageVideoCount,
      href: window.location.href,
      previousCount: lastSeenVideoCount,
      srcChanged,
    });
    lastSeenVideoCount = currentPageVideoCount;
    lastSeenSrcSignature = currentSrcSignature;
    scheduleNotify(videoCountChanged ? "video-count-changed" : "video-src-changed");
  };

  const startPolling = (intervalMs: number) => {
    if (pollInterval) {
      clearInterval(pollInterval);
    }
    pollInterval = setInterval(checkLandscape, intervalMs);
  };
  const handlePageLifecycleEvent = (event: Event) => {
    scheduleNotify(
      event.type === "wxt:locationchange" ? "location-change" : event.type,
    );
  };

  return {
    start() {
      refreshTrackedVideos();
      updateLandscapeSignature();
      notify("initial");
      mutationObserver = new MutationObserver(() => {
        refreshTrackedVideos();
        scheduleNotify("dom-mutated");
      });
      mutationObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: [
          "src",
          "srcset",
          "poster",
          "type",
          "style",
          "class",
          "hidden",
        ],
        childList: true,
        subtree: true,
      });
      window.addEventListener("hashchange", handlePageLifecycleEvent);
      window.addEventListener("pageshow", handlePageLifecycleEvent);
      window.addEventListener("popstate", handlePageLifecycleEvent);
      window.addEventListener("wxt:locationchange", handlePageLifecycleEvent);
      document.addEventListener("visibilitychange", handlePageLifecycleEvent);
      startPolling(pollIntervalMs);
      highFrequencyTimeout = setTimeout(() => {
        if (lowFrequencyPollIntervalMs === null) {
          if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
          }
          return;
        }

        startPolling(lowFrequencyPollIntervalMs);
      }, highFrequencyLifetimeMs);
    },
    stop() {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      if (highFrequencyTimeout) {
        clearTimeout(highFrequencyTimeout);
        highFrequencyTimeout = null;
      }
      mutationObserver?.disconnect();
      mutationObserver = null;
      window.removeEventListener("hashchange", handlePageLifecycleEvent);
      window.removeEventListener("pageshow", handlePageLifecycleEvent);
      window.removeEventListener("popstate", handlePageLifecycleEvent);
      window.removeEventListener("wxt:locationchange", handlePageLifecycleEvent);
      document.removeEventListener("visibilitychange", handlePageLifecycleEvent);
      for (const video of Array.from(trackedVideos)) {
        for (const eventName of VIDEO_CHANGE_EVENT_NAMES) {
          video.removeEventListener(eventName, handleVideoEvent);
        }
      }
      trackedVideos.clear();
    },
  };

  function getSrcObjectId(srcObject: object | null) {
    if (!srcObject) {
      return "";
    }

    const existingId = srcObjectIds.get(srcObject);
    if (existingId) {
      return `object:${existingId}`;
    }

    const nextId = nextSrcObjectId++;
    srcObjectIds.set(srcObject, nextId);
    return `object:${nextId}`;
  }

  function getVideoSrcSignature(): string {
    return collectPageVideos()
      .map((video) => {
        const sourceChildSignature = Array.from(
          video.querySelectorAll("source"),
        )
          .map(
            (source) =>
              `${source.getAttribute("src") ?? ""}:${source.getAttribute("type") ?? ""}`,
          )
          .join(",");

        return [
          getVideoHandle(video),
          video.currentSrc || video.src || "",
          video.getAttribute("poster") ?? "",
          getSrcObjectId(video.srcObject),
          sourceChildSignature,
        ].join(":");
      })
      .join("|");
  }
}

function buildContentReadyVideos() {
  const sourcesById = new Map(
    listVisibleVideoSources().map((source) => [source.id, source]),
  );
  const allCandidates = listAllPageVideoCandidates();
  const visibleCandidates = listVisibleVideoCandidates();
  const visibleIds = new Set(visibleCandidates.map((video) => video.id));
  const mergedCandidates = [
    ...visibleCandidates,
    ...allCandidates.filter((candidate) => !visibleIds.has(candidate.id)),
  ];

  return mergedCandidates.map((candidate) => ({
    ...(sourcesById.get(candidate.id) ?? {
      id: candidate.id,
      label: candidate.label,
      primaryUrl: candidate.fingerprint.primaryUrl,
      posterUrl: null,
      thumbnailUrl: null,
      width: null,
      height: null,
      duration: null,
      format: null,
      isVisible: false,
    }),
    fingerprint: candidate.fingerprint,
  }));
}
