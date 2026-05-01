// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import { createContentChatWidgetController } from "../../entrypoints/content/content-chat-widget";
import * as shadowRootModule from "wxt/utils/content-script-ui/shadow-root";

vi.mock("wxt/utils/content-script-ui/shadow-root", () => ({
  createShadowRootUi: vi.fn(),
}));

describe("createContentChatWidgetController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });

  it("creates shadow root ui when shown", async () => {
    const mockUi = {
      mount: vi.fn(),
      remove: vi.fn(),
      mounted: null,
    };
    vi.spyOn(shadowRootModule, "createShadowRootUi").mockResolvedValue(mockUi as any);
    const widget = createContentChatWidgetController({} as any);

    widget.show();
    await flushPromises();

    expect(shadowRootModule.createShadowRootUi).toHaveBeenCalled();
    expect(mockUi.mount).toHaveBeenCalled();
  });

  it("removes shadow root ui when hidden", async () => {
    const mockUi = {
      mount: vi.fn(),
      remove: vi.fn(),
      mounted: null,
    };
    vi.spyOn(shadowRootModule, "createShadowRootUi").mockResolvedValue(mockUi as any);
    const widget = createContentChatWidgetController({} as any);

    widget.show();
    await flushPromises();
    
    widget.hide();
    await flushPromises();

    expect(mockUi.remove).toHaveBeenCalled();
  });

  it("coalesces concurrent renders into one shadow root ui", async () => {
    const mockUi = {
      mount: vi.fn(),
      remove: vi.fn(),
      mounted: null,
    };
    let resolveUi!: (ui: typeof mockUi) => void;
    vi.spyOn(shadowRootModule, "createShadowRootUi").mockReturnValue(
      new Promise((resolve) => {
        resolveUi = resolve;
      }) as any,
    );
    const widget = createContentChatWidgetController({} as any);

    widget.show();
    widget.setMessages([
      {
        id: "message-1",
        sender: "Viewer",
        text: "hello",
      },
    ]);

    expect(shadowRootModule.createShadowRootUi).toHaveBeenCalledTimes(1);

    resolveUi(mockUi);
    await flushPromises();

    expect(mockUi.mount).toHaveBeenCalledTimes(1);
  });
});

async function flushPromises() {
  // Wait through the nested createShadowRootUi().then().finally().then()
  // chain before asserting mount/remove side effects.
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}
