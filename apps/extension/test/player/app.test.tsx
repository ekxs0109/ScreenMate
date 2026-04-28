// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";

const dplayerCalls: Array<{ options: { container: HTMLElement; video?: { url?: string } } }> = [];

vi.mock("dplayer", () => {
  class MockDPlayer {
    public readonly destroy = vi.fn();
    public readonly off = vi.fn();
    public readonly on = vi.fn();

    constructor(options: { container: HTMLElement; video?: { url?: string } }) {
      dplayerCalls.push({ options });
    }
  }

  return { default: MockDPlayer };
});

vi.mock("#i18n", () => ({
  i18n: {
    t: (key: string) => key,
  },
}));

vi.mock("../../lib/local-media-store", () => ({
  saveLocalMediaFile: vi.fn(async (file: File) => ({
    id: "local-demo",
    name: file.name,
    size: file.size,
    type: file.type,
    updatedAt: 123,
  })),
}));

import { ThemeProvider } from "../../components/theme-provider";
import PlayerApp from "../../entrypoints/player/App";

beforeAll(() => {
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
  Object.defineProperty(URL, "createObjectURL", {
    writable: true,
    value: vi.fn(() => "blob:demo-video"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    writable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
  dplayerCalls.length = 0;
});

describe("PlayerApp", () => {
  it("renders a DPlayer surface after loading a local video file", async () => {
    render(
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
        <PlayerApp />
      </ThemeProvider>,
    );

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["demo"], "demo.mp4", { type: "video/mp4" });

    fireEvent.change(fileInput, {
      target: {
        files: [file],
      },
    });

    await waitFor(() => {
      expect(screen.getByText("demo.mp4")).toBeTruthy();
    });
    expect(dplayerCalls).toHaveLength(1);
    expect(dplayerCalls[0]?.options.video?.url).toBe("blob:demo-video");
  });

  it("uses real room chat state and sends messages through the host runtime", async () => {
    const sendMessage = vi
      .spyOn(browser.runtime, "sendMessage")
      .mockImplementation(async (message: unknown) => {
        if (
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          message.type === "screenmate:get-room-session"
        ) {
          return {
            roomLifecycle: "open",
            sourceState: "attached",
            roomId: "room_123",
            viewerCount: 1,
            viewerRoster: [],
            chatMessages: [
              {
                messageId: "msg_1",
                senderSessionId: "viewer_1",
                senderRole: "viewer",
                senderName: "Alice",
                text: "viewer hello",
                sentAt: 123,
              },
            ],
            sourceLabel: "demo.mp4",
            activeTabId: -1,
            activeFrameId: -1,
            recoverByTimestamp: null,
            message: null,
          };
        }

        if (
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          message.type === "screenmate:send-chat-message"
        ) {
          return { ok: true, snapshot: undefined, error: null };
        }

        if (
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          message.type === "screenmate:get-follow-active-tab-video-state"
        ) {
          return { enabled: false };
        }

        return undefined;
      });

    render(
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
        <PlayerApp />
      </ThemeProvider>,
    );

    await screen.findByText("viewer hello");
    const input = screen.getByPlaceholderText("Send a message...");
    fireEvent.change(input, {
      target: { value: "host reply" },
    });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    expect(sendMessage).toHaveBeenCalledWith({
      type: "screenmate:send-chat-message",
      text: "host reply",
    });
  });
});
