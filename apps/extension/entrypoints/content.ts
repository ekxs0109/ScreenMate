import { browser, type Browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import { createLogger } from "../lib/logger";
import { createSourceAttachmentRuntime } from "./content/source-attachment";
import { createVideoPreviewController } from "./content/video-preview";
import {
  getVideoDetectionDiagnostics,
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
      type: "screenmate:attach-source";
      videoId: string;
      roomSession: RoomSession;
    }
  | {
      type: "screenmate:signal-inbound";
      envelope: Record<string, unknown>;
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

    const notifyContentReady = () => {
      void browser.runtime.sendMessage({
        type: "screenmate:content-ready",
        frameId: 0,
        videos: listVisibleVideoCandidates().map((video) => ({
          ...video,
          frameId: 0,
        })),
      });
    };

    contentLogger.info("Content script booted.", getVideoDetectionDiagnostics());
    browser.runtime.onMessage.addListener(listener);
    notifyContentReady();

    ctx.onInvalidated(() => {
      previewController.destroy();
      sourceAttachmentRuntime.destroy("content-invalidated");
      browser.runtime.onMessage.removeListener(listener);
    });
  },
});
