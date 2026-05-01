// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../src/components/theme-provider";
import { ViewerShell } from "../src/components/ViewerShell";
import { ViewerI18nProvider } from "../src/i18n";
import { buildViewerSceneModel } from "../src/viewer-scene-adapter";
import { createViewerMockState } from "../src/viewer-mock-state";
import { initialViewerSessionState } from "../src/lib/session-state";

const videojsVideoElements: HTMLVideoElement[] = [];

vi.mock("@videojs/react", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    createPlayer: vi.fn(() => ({
      Provider: ({ children }: { children: React.ReactNode }) =>
        React.createElement(React.Fragment, null, children),
      Container: React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
        function MockVideoJsContainer({ children, ...props }, ref) {
          return React.createElement("div", { ...props, ref }, children);
        },
      ),
      useMedia: vi.fn(),
      usePlayer: vi.fn(),
    })),
  };
});

vi.mock("@videojs/react/live-video", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    LiveVideoSkin: ({
      children,
      ...props
    }: React.HTMLAttributes<HTMLDivElement>) =>
      React.createElement(
        "div",
        { ...props, "data-testid": "videojs-live-skin" },
        children,
      ),
    Video: React.forwardRef<HTMLVideoElement, React.VideoHTMLAttributes<HTMLVideoElement>>(
      function MockVideoJsVideo(props, ref) {
        const setVideoRef = React.useCallback(
          (video: HTMLVideoElement | null) => {
            if (video && !videojsVideoElements.includes(video)) {
              videojsVideoElements.push(video);
            }

            if (typeof ref === "function") {
              ref(video);
            } else if (ref) {
              ref.current = video;
            }
          },
          [ref],
        );

        return React.createElement("video", {
          ...props,
          "data-testid": "videojs-video",
          ref: setVideoRef,
        });
      },
    ),
    liveVideoFeatures: [],
  };
});

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
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLMediaElement.prototype, "load", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  videojsVideoElements.length = 0;
  Object.defineProperty(navigator, "getAutoplayPolicy", {
    configurable: true,
    value: undefined,
  });
});

describe("ViewerShell", () => {
  it("renders the migrated viewer header, sidebar, and join overlay", () => {
    const scene = buildViewerSceneModel({
      locale: "zh",
      session: initialViewerSessionState,
      mock: createViewerMockState("zh"),
    });

    renderViewerShell(scene, { locale: "zh" });

    expect(screen.getByText("ScreenMate")).toBeTruthy();
    expect(screen.getByText(/连接/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "加入房间" })).toBeTruthy();
    expect(screen.getByPlaceholderText(/发送消息|Send a message/)).toBeTruthy();
  });

  it("shows negotiated codec next to the viewer resolution", () => {
    const scene = buildViewerSceneModel({
      locale: "en",
      session: {
        ...initialViewerSessionState,
        roomId: "room_demo",
        status: "connected",
        roomState: "streaming",
        sourceState: "attached",
        remoteStream: { id: "existing-stream" } as MediaStream,
        localVideoCodec: "VP9",
      },
      mock: createViewerMockState("en"),
    });
    const stream = {
      getVideoTracks: () => [
        {
          getSettings: () => ({
            height: 1080,
            width: 1920,
          }),
        },
      ],
    } as unknown as MediaStream;

    renderViewerShell(scene, { stream });

    expect(screen.getByTestId("viewer-resolution").textContent).toContain(
      "1920x1080",
    );
    expect(screen.getByTestId("viewer-resolution").textContent).toContain("VP9");
  });

  it("preserves failed chat sends and clears successful sends", async () => {
    const onSendMessage = vi.fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const scene = buildViewerSceneModel({
      locale: "en",
      session: initialViewerSessionState,
      mock: createViewerMockState("en"),
    });

    renderViewerShell(scene, { onSendMessage });

    const messageInput = screen.getByPlaceholderText(
      /Send a message|发送消息/,
    ) as HTMLInputElement;

    fireEvent.change(messageInput, { target: { value: "hello host" } });
    fireEvent.submit(messageInput.closest("form")!);

    expect(onSendMessage).toHaveBeenCalledWith("hello host");
    expect(messageInput.value).toBe("hello host");

    fireEvent.submit(messageInput.closest("form")!);

    expect(onSendMessage).toHaveBeenCalledWith("hello host");
    await waitFor(() => {
      expect(messageInput.value).toBe("");
    });
  });

  it("renders a Video.js player for the live viewer surface", () => {
    const scene = buildViewerSceneModel({
      locale: "en",
      session: initialViewerSessionState,
      mock: createViewerMockState("en"),
    });

    renderViewerShell(scene);

    expect(screen.getByTestId("viewer-video")).toBeTruthy();
    expect(screen.getByTestId("videojs-video")).toBeTruthy();
    expect(screen.getByTestId("videojs-live-skin")).toBeTruthy();
  });

  it("uses controlled playback instead of native autoplay for the viewer stream", async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: play,
    });
    const scene = createConnectedScene();

    renderViewerShell(scene, { stream: { id: "stream-1" } as MediaStream });

    const video = screen.getByTestId("videojs-video") as HTMLVideoElement;
    expect(video.autoplay).toBe(false);
    expect(video.hasAttribute("autoplay")).toBe(false);
    await waitFor(() => {
      expect(play).toHaveBeenCalledTimes(1);
    });
  });

  it("rebinds the Video.js video element to the latest MediaStream", () => {
    const scene = buildViewerSceneModel({
      locale: "en",
      session: initialViewerSessionState,
      mock: createViewerMockState("en"),
    });
    const firstStream = { id: "stream-1" } as MediaStream;
    const secondStream = { id: "stream-2" } as MediaStream;
    const { rerender } = renderViewerShell(scene, { stream: firstStream });

    rerender(
      <ViewerI18nProvider initialLocale="en">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <ViewerShell
            scene={scene}
            stream={secondStream}
            onJoin={vi.fn(async () => undefined)}
            onLeaveRoom={vi.fn()}
            onJoinOtherRoom={vi.fn()}
            onRandomizeUsername={vi.fn()}
            onDisplayNameChange={vi.fn()}
            onSendMessage={vi.fn()}
          />
        </ThemeProvider>
      </ViewerI18nProvider>,
    );

    expect(videojsVideoElements[0]?.srcObject).toBe(secondStream);
  });

  it("shows a playback retry prompt when browser autoplay is blocked", async () => {
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: vi.fn().mockRejectedValue(new Error("autoplay blocked")),
    });

    const scene = createConnectedScene();

    renderViewerShell(scene, { stream: { id: "stream-1" } as MediaStream });

    await waitFor(() => {
      expect(screen.getByTestId("viewer-playback-retry")).toBeTruthy();
    });
  });

  it("retries playback after the viewer clicks the playback prompt", async () => {
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: vi.fn().mockRejectedValue(new Error("autoplay blocked")),
    });

    const scene = createConnectedScene();

    renderViewerShell(scene, { stream: { id: "stream-1" } as MediaStream });

    await waitFor(() => {
      expect(screen.getByTestId("viewer-playback-retry")).toBeTruthy();
    });

    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });

    fireEvent.click(screen.getByTestId("viewer-playback-retry"));

    await waitFor(() => {
      expect(screen.queryByTestId("viewer-playback-retry")).toBeNull();
    });
  });

  it("shows an unmute prompt when autoplay is only allowed while muted", async () => {
    Object.defineProperty(navigator, "getAutoplayPolicy", {
      configurable: true,
      value: vi.fn(() => "allowed-muted"),
    });
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });

    const scene = createConnectedScene();

    renderViewerShell(scene, { stream: { id: "stream-1" } as MediaStream });

    await waitFor(() => {
      expect(screen.getByTestId("viewer-unmute-prompt")).toBeTruthy();
    });
  });

  it("shows a playback prompt when fallback autoplay is paused after restoring audio", async () => {
    const nativeMuted = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      "muted",
    );
    const nativePaused = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      "paused",
    );

    Object.defineProperty(HTMLMediaElement.prototype, "muted", {
      configurable: true,
      get() {
        return (this as HTMLMediaElement & { __testMuted?: boolean }).__testMuted ?? false;
      },
      set(value: boolean) {
        const media = this as HTMLMediaElement & {
          __pauseAfterUnmute?: boolean;
          __testMuted?: boolean;
          __testPaused?: boolean;
        };

        media.__testMuted = value;
        if (value === false && media.__pauseAfterUnmute) {
          media.__testPaused = true;
        }
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "paused", {
      configurable: true,
      get() {
        return (this as HTMLMediaElement & { __testPaused?: boolean }).__testPaused ?? false;
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: vi.fn().mockImplementation(function play(this: HTMLMediaElement) {
        const media = this as HTMLMediaElement & { __pauseAfterUnmute?: boolean };
        media.__pauseAfterUnmute = true;
        return Promise.resolve();
      }),
    });

    try {
      const scene = createConnectedScene();

      renderViewerShell(scene, { stream: { id: "stream-1" } as MediaStream });

      await waitFor(() => {
        expect(screen.getByTestId("viewer-playback-retry")).toBeTruthy();
      });
    } finally {
      if (nativeMuted) {
        Object.defineProperty(HTMLMediaElement.prototype, "muted", nativeMuted);
      }
      if (nativePaused) {
        Object.defineProperty(HTMLMediaElement.prototype, "paused", nativePaused);
      }
    }
  });

  it("unmutes the stream after the viewer clicks the unmute prompt", async () => {
    Object.defineProperty(navigator, "getAutoplayPolicy", {
      configurable: true,
      value: vi.fn(() => "allowed-muted"),
    });
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });

    const scene = createConnectedScene();

    renderViewerShell(scene, { stream: { id: "stream-1" } as MediaStream });

    await waitFor(() => {
      expect(screen.getByTestId("viewer-unmute-prompt")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("viewer-unmute-prompt"));

    await waitFor(() => {
      expect(screen.queryByTestId("viewer-unmute-prompt")).toBeNull();
    });
    expect(videojsVideoElements[0]?.muted).toBe(false);
  });
});

function renderViewerShell(
  scene: Parameters<typeof ViewerShell>[0]["scene"],
  overrides: Partial<Parameters<typeof ViewerShell>[0]> & {
    locale?: "en" | "zh";
  } = {},
) {
  const { locale = "en", ...props } = overrides;

  return render(
    <ViewerI18nProvider initialLocale={locale}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
        <ViewerShell
          scene={scene}
          stream={null}
          onJoin={vi.fn(async () => undefined)}
          onLeaveRoom={vi.fn()}
          onJoinOtherRoom={vi.fn()}
          onRandomizeUsername={vi.fn()}
          onDisplayNameChange={vi.fn()}
          onSendMessage={vi.fn()}
          {...props}
        />
      </ThemeProvider>
    </ViewerI18nProvider>,
  );
}

function createConnectedScene() {
  return buildViewerSceneModel({
    locale: "en",
    session: {
      ...initialViewerSessionState,
      roomId: "room_demo",
      status: "connected",
      roomState: "streaming",
      sourceState: "attached",
      remoteStream: { id: "existing-stream" } as MediaStream,
    },
    mock: createViewerMockState("en"),
  });
}
