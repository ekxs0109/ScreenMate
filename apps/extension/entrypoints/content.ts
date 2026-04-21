import { browser, type Browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";

import { listVisibleVideoSources } from "./content/video-detector";

export type ListVideosMessage = {
  type: "screenmate:list-videos";
};

type ContentMessage = ListVideosMessage | { type: string };

export function createVideoMessageListener() {
  return (
    message: ContentMessage,
    _sender: Browser.runtime.MessageSender,
    sendResponse: (response: Array<{ id: string; label: string }>) => void,
  ) => {
    if (message.type !== "screenmate:list-videos") {
      return undefined;
    }

    queueMicrotask(() => {
      sendResponse(listVisibleVideoSources());
    });

    return true;
  };
}

export default defineContentScript({
  matches: ["<all_urls>"],
  main(ctx) {
    const listener = createVideoMessageListener();

    browser.runtime.onMessage.addListener(listener);
    ctx.onInvalidated(() => {
      browser.runtime.onMessage.removeListener(listener);
    });
  },
});
