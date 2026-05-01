// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import { readLocalMediaFile, saveLocalMediaFile } from "../../lib/local-media-store";

const videojsReactCalls: Array<{ src?: string; id?: string }> = [];

vi.mock("@videojs/react", async () => {
  const React = await import("react");

  return {
    createPlayer: vi.fn(() => ({
      Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      Container: React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
        function MockVideoJsContainer({ children, ...props }, ref) {
          return (
            <div ref={ref} {...props}>
              {children}
            </div>
          );
        },
      ),
    })),
  };
});

vi.mock("@videojs/react/video", async () => {
  const React = await import("react");

  return {
    videoFeatures: [],
    VideoSkin: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Video: React.forwardRef<HTMLVideoElement, React.VideoHTMLAttributes<HTMLVideoElement>>(
      function MockVideoJsVideo(props, ref) {
        videojsReactCalls.push({ src: props.src, id: props.id });
        return <video ref={ref} {...props} />;
      },
    ),
  };
});

vi.mock("#i18n", () => ({
  i18n: {
    t: (key: string) => key,
  },
}));

vi.mock("../../lib/local-media-store", () => ({
  readLocalMediaFile: vi.fn(),
  saveLocalMediaFile: vi.fn(),
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
  Object.defineProperty(HTMLMediaElement.prototype, "pause", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
  Object.defineProperty(HTMLMediaElement.prototype, "load", {
    configurable: true,
    value: vi.fn(),
  });
});

beforeEach(() => {
  vi.mocked(saveLocalMediaFile).mockImplementation(async (file: File) => ({
    id: "local-demo",
    name: file.name,
    size: file.size,
    type: file.type,
    updatedAt: 123,
  }));
  vi.mocked(readLocalMediaFile).mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  videojsReactCalls.length = 0;
});

describe("PlayerApp", () => {
  it("renders a Video.js surface and starts the offscreen local file source", async () => {
    const sendMessage = vi
      .spyOn(browser.runtime, "sendMessage")
      .mockImplementation(async (message: unknown) => {
        if (
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          message.type === "screenmate:prepare-local-file-source"
        ) {
          return {
            status: "prepared-source",
            kind: "upload",
            ready: true,
            label: "demo.mp4",
            fileId: "local-demo",
            metadata: {
              id: "local-demo",
              name: "demo.mp4",
              size: 4,
              type: "video/mp4",
              updatedAt: 123,
            },
            error: null,
          };
        }

        if (
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          message.type === "screenmate:start-sharing"
        ) {
          return {
            roomLifecycle: "open",
            sourceState: "attached",
            roomId: "room_123",
            viewerCount: 0,
            viewerRoster: [],
            chatMessages: [],
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
          message.type === "screenmate:get-follow-active-tab-video-state"
        ) {
          return { enabled: false };
        }

        return undefined;
      });

    const { unmount } = render(
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
    await waitFor(() => {
      expect(
        document.getElementById("screenmate-player-local-video"),
      ).toBeTruthy();
    });
    const video = document.getElementById(
      "screenmate-player-local-video",
    ) as HTMLVideoElement | null;
    expect(video?.src).toBe("blob:demo-video");
    expect(video?.controls).toBe(false);
    expect(videojsReactCalls).toContainEqual({
      id: "screenmate-player-local-video",
      src: "blob:demo-video",
    });
    expect(sendMessage).toHaveBeenCalledWith({
      type: "screenmate:prepare-local-file-source",
      fileId: "local-demo",
      metadata: {
        id: "local-demo",
        name: "demo.mp4",
        size: 4,
        type: "video/mp4",
        updatedAt: 123,
      },
    });
    expect(sendMessage).toHaveBeenCalledWith({
      type: "screenmate:start-sharing",
      source: {
        kind: "prepared-offscreen",
        sourceType: "upload",
        label: "demo.mp4",
        fileId: "local-demo",
        metadata: {
          id: "local-demo",
          name: "demo.mp4",
          size: 4,
          type: "video/mp4",
          updatedAt: 123,
        },
      },
    });

    unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:demo-video");
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
  });

  it("restores a prepared offscreen upload preview after player refresh without restarting sharing", async () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined);
    vi.mocked(readLocalMediaFile).mockResolvedValue({
      id: "local-demo",
      name: "demo.mp4",
      size: 4,
      type: "video/mp4",
      updatedAt: 123,
      blob: new Blob(["demo"], { type: "video/mp4" }),
    });
    vi.mocked(URL.createObjectURL).mockReturnValue("blob:restored-video");
    const sendMessage = vi
      .spyOn(browser.runtime, "sendMessage")
      .mockImplementation(async (message: unknown) => {
        if (
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          message.type === "screenmate:get-prepared-source-state"
        ) {
          return {
            status: "prepared-source",
            kind: "upload",
            ready: true,
            label: "demo.mp4",
            fileId: "local-demo",
            metadata: {
              id: "local-demo",
              name: "demo.mp4",
              size: 4,
              type: "video/mp4",
              updatedAt: 123,
            },
            error: null,
          };
        }

        if (
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          message.type === "screenmate:get-local-playback-state"
        ) {
          return {
            status: "local-playback-state",
            active: true,
            currentTime: 42,
            duration: 120,
            paused: false,
            playbackRate: 1,
            sourceLabel: "demo.mp4",
          };
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

    await waitFor(() => {
      expect(screen.getByText("demo.mp4")).toBeTruthy();
    });

    expect(readLocalMediaFile).toHaveBeenCalledWith("local-demo");
    await waitFor(() => {
      const video = document.getElementById(
        "screenmate-player-local-video",
      ) as HTMLVideoElement | null;
      expect(video?.src).toBe("blob:restored-video");
      expect(video?.currentTime).toBe(42);
    });
    expect(videojsReactCalls).toContainEqual({
      id: "screenmate-player-local-video",
      src: "blob:restored-video",
    });
    expect(play).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith({
      type: "screenmate:get-local-playback-state",
    });
    expect(sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "screenmate:start-sharing" }),
    );
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
