import { browser, type Browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import { createLogger } from "../lib/logger";
import { createHostController } from "./content/host-controller";
import { type HostSnapshot } from "./content/host-session";
import { createVideoPreviewController } from "./content/video-preview";
import {
  getVideoDetectionDiagnostics,
  listVisibleVideoSources,
  type VideoSource,
} from "./content/video-detector";

export type ListVideosMessage = {
  type: "screenmate:list-videos";
};

export type HostControlMessage =
  | { type: "screenmate:get-host-state" }
  | { type: "screenmate:start-sharing"; videoId: string }
  | { type: "screenmate:stop-sharing" }
  | {
      type: "screenmate:preview-video";
      videoId: string;
      frameId: number;
      label: string;
      active?: boolean;
    }
  | { type: "screenmate:clear-preview" };

type ContentMessage = ListVideosMessage | HostControlMessage | { type: string };
const contentLogger = createLogger("content");

export function createVideoMessageListener(
  hostController = createHostController(),
  previewController = createVideoPreviewController(),
) {
  return (
    message: ContentMessage,
    _sender: Browser.runtime.MessageSender,
    sendResponse: (
      response: VideoSource[] | HostSnapshot | { ok: true },
    ) => void,
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

    if (message.type === "screenmate:get-host-state") {
      queueMicrotask(() => {
        contentLogger.debug("Reported host state.", hostController.getSnapshot());
        sendResponse(hostController.getSnapshot());
      });

      return true;
    }

    if (
      message.type === "screenmate:start-sharing" &&
      "videoId" in message &&
      typeof message.videoId === "string"
    ) {
      const { videoId } = message;

      queueMicrotask(() => {
        contentLogger.info("Starting share for selected video.", {
          href: window.location.href,
          videoId,
        });
        void hostController.start(videoId).then((snapshot) => {
          contentLogger.info("Share start finished.", {
            errorMessage: snapshot.errorMessage,
            href: window.location.href,
            roomId: snapshot.roomId,
            snapshot,
            status: snapshot.status,
            videoId,
          });
          sendResponse(snapshot);
        });
      });

      return true;
    }

    if (message.type === "screenmate:stop-sharing") {
      queueMicrotask(() => {
        contentLogger.info("Stopping active share.", {
          href: window.location.href,
        });
        void hostController.stop().then((snapshot) => {
          contentLogger.info("Share stop finished.", {
            errorMessage: snapshot.errorMessage,
            href: window.location.href,
            roomId: snapshot.roomId,
            snapshot,
            status: snapshot.status,
          });
          sendResponse(snapshot);
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
      "videoId" in message &&
      "frameId" in message &&
      "label" in message &&
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
    const hostController = createHostController();
    const previewController = createVideoPreviewController();
    const listener = createVideoMessageListener(hostController, previewController);
    contentLogger.info("Content script booted.", getVideoDetectionDiagnostics());

    browser.runtime.onMessage.addListener(listener);
    ctx.onInvalidated(() => {
      previewController.destroy();
      hostController.destroy();
      browser.runtime.onMessage.removeListener(listener);
    });
  },
});
