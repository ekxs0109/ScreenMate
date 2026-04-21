import { defineContentScript } from "wxt/utils/define-content-script";

import { collectVisibleVideos } from "./content/video-detector";

type ListVideosMessage = {
  type: "screenmate:list-videos";
};

type ContentMessage = ListVideosMessage | { type: string };

const extensionBrowser = (
  globalThis as typeof globalThis & {
    browser: {
      runtime: {
        onMessage: {
          addListener: (
            listener: (message: ContentMessage) => Promise<{ id: string; label: string }[]> | undefined,
          ) => void;
        };
      };
    };
  }
).browser;

export default defineContentScript({
  matches: ["<all_urls>"],
  main() {
    extensionBrowser.runtime.onMessage.addListener((message) => {
      if (message.type === "screenmate:list-videos") {
        return Promise.resolve(
          collectVisibleVideos().map((video, index) => ({
            id: video.id || `video-${index}`,
            label: video.currentSrc || video.src || `Video ${index + 1}`,
          })),
        );
      }
    });
  },
});
