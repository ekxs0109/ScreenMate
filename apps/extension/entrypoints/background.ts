import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { createHostSessionStore } from "./content/host-session";

const hostStore = createHostSessionStore();

type HostMessage =
  | { type: "screenmate:get-host-state" }
  | { type: "screenmate:start-sharing" }
  | { type: "screenmate:stop-sharing" };

function isHostMessage(message: unknown): message is HostMessage {
  if (typeof message !== "object" || message === null) {
    return false;
  }

  const { type } = message as { type?: unknown };

  return (
    type === "screenmate:get-host-state" ||
    type === "screenmate:start-sharing" ||
    type === "screenmate:stop-sharing"
  );
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: unknown) => {
    if (!isHostMessage(message)) {
      return undefined;
    }

    if (message.type === "screenmate:get-host-state") {
      return Promise.resolve(hostStore.getSnapshot());
    }

    if (message.type === "screenmate:start-sharing") {
      hostStore.setRoom("pending-room");
      return Promise.resolve(hostStore.getSnapshot());
    }

    if (message.type === "screenmate:stop-sharing") {
      hostStore.reset();
      return Promise.resolve(hostStore.getSnapshot());
    }

    return undefined;
  });
});
