import { browser, type Browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import { createLogger } from "../lib/logger";
import { createSourceAttachmentRuntime } from "./content/source-attachment";
import { createVideoPreviewController } from "./content/video-preview";
import {
  collectPageVideos,
  getVideoDetectionDiagnostics,
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

export function createVideoMessageListener(
  sourceAttachmentRuntime?: ReturnType<typeof createSourceAttachmentRuntime>,
  previewController = createVideoPreviewController(),
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
    const listener = createVideoMessageListener(
      sourceAttachmentRuntime,
      previewController,
    );

    // Send content-ready with ALL page video candidates (including
    // non-renderable ones) so the background can fingerprint-match even
    // before the video element is fully initialised (e.g. Bilibili blob URLs).
    const notifyContentReady = () => {
      const allCandidates = listAllPageVideoCandidates();
      const visibleCandidates = listVisibleVideoCandidates();

      // Merge: prefer visible candidates (they have accurate visibleIndex),
      // but include any non-visible ones that only appear in allCandidates.
      const visibleIds = new Set(visibleCandidates.map((v) => v.id));
      const merged = [
        ...visibleCandidates,
        ...allCandidates.filter((c) => !visibleIds.has(c.id)),
      ];

      void browser.runtime.sendMessage({
        type: "screenmate:content-ready",
        frameId: 0,
        videos: merged.map((video) => ({
          ...video,
          frameId: 0,
        })),
      });
    };

    contentLogger.info("Content script booted.", getVideoDetectionDiagnostics());
    browser.runtime.onMessage.addListener(listener);
    notifyContentReady();

    // Poll for newly-appearing video elements during the recovery window.
    // On SPA sites like Bilibili the <video> element is rendered asynchronously
    // by JavaScript, well after the content script boots.  We poll rather than
    // use a MutationObserver because:
    //  1. The <video> might be in the DOM but not yet renderable (zero size).
    //  2. Setting a blob: src on an existing element is NOT a DOM mutation.
    //  3. Polling every 1 s for 15 s is cheap and covers all edge cases.
    const VIDEO_POLL_INTERVAL_MS = 1_000;
    const VIDEO_POLL_LIFETIME_MS = 15_000;

    let lastSeenVideoCount = collectPageVideos().length;
    let lastSeenSrcSignature = getVideoSrcSignature();

    const videoPollInterval = setInterval(() => {
      const currentPageVideoCount = collectPageVideos().length;
      const currentSrcSignature = getVideoSrcSignature();

      const videoCountChanged = currentPageVideoCount !== lastSeenVideoCount;
      const srcChanged = currentSrcSignature !== lastSeenSrcSignature;

      if (videoCountChanged || srcChanged) {
        contentLogger.info("Video landscape changed, re-notifying content-ready.", {
          href: window.location.href,
          previousCount: lastSeenVideoCount,
          currentCount: currentPageVideoCount,
          srcChanged,
        });
        lastSeenVideoCount = currentPageVideoCount;
        lastSeenSrcSignature = currentSrcSignature;
        notifyContentReady();
      }
    }, VIDEO_POLL_INTERVAL_MS);

    const videoPollTimeout = setTimeout(() => {
      clearInterval(videoPollInterval);
    }, VIDEO_POLL_LIFETIME_MS);

    ctx.onInvalidated(() => {
      clearTimeout(videoPollTimeout);
      clearInterval(videoPollInterval);
      previewController.destroy();
      sourceAttachmentRuntime.destroy("content-invalidated");
      browser.runtime.onMessage.removeListener(listener);
    });
  },
});

/**
 * Build a simple signature from the src/currentSrc of all page videos.
 * When any video's source changes (e.g. a blob URL is assigned) the
 * signature changes, triggering a content-ready re-notification.
 */
function getVideoSrcSignature(): string {
  return collectPageVideos()
    .map((v) => v.currentSrc || v.src || "")
    .join("|");
}
