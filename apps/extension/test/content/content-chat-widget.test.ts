// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import { createContentChatWidgetController } from "../../entrypoints/content/content-chat-widget";

describe("createContentChatWidgetController", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.innerHTML = "";
  });

  it("sends chat input through the extension host runtime", async () => {
    const sendMessage = vi
      .spyOn(browser.runtime, "sendMessage")
      .mockResolvedValue({ ok: true } as never);
    const widget = createContentChatWidgetController();

    widget.show();
    const input = document.querySelector("input[name='message']") as HTMLInputElement;
    const form = input.closest("form") as HTMLFormElement;
    input.value = "hello viewer";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(sendMessage).toHaveBeenCalledWith({
      type: "screenmate:send-chat-message",
      text: "hello viewer",
    });
  });

  it("renders real room chat messages pushed by the background", () => {
    const widget = createContentChatWidgetController();

    widget.show();
    widget.setMessages([
      {
        id: "msg_1",
        sender: "Alice",
        text: "viewer says hi",
      },
      {
        id: "msg_2",
        sender: "Host",
        text: "host replies",
      },
    ]);

    expect(document.documentElement.textContent).toContain("viewer says hi");
    expect(document.documentElement.textContent).toContain("host replies");
  });
});
