// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../src/components/theme-provider";
import { ViewerShell } from "../src/components/ViewerShell";
import { ViewerI18nProvider } from "../src/i18n";
import { buildViewerSceneModel } from "../src/viewer-scene-adapter";
import { createViewerMockState } from "../src/viewer-mock-state";
import { initialViewerSessionState } from "../src/lib/session-state";

const dplayerInstances: Array<{
  container: HTMLElement;
  video: HTMLVideoElement;
  destroy: ReturnType<typeof vi.fn>;
}> = [];

vi.mock("dplayer", () => {
  class MockDPlayer {
    public readonly container: HTMLElement;
    public readonly video: HTMLVideoElement;
    public readonly destroy = vi.fn();

    constructor(options: { container: HTMLElement }) {
      this.container = options.container;
      this.video = document.createElement("video");
      this.container.append(this.video);
      dplayerInstances.push(this);
    }
  }

  return { default: MockDPlayer };
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
  dplayerInstances.length = 0;
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
    expect(screen.getByText("同步状态")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "加入房间" })).toBeTruthy();
    expect(screen.getByText(/随机/)).toBeTruthy();
  });

  it("commits controlled display name changes on blur and Enter", () => {
    const onDisplayNameChange = vi.fn();
    const scene = buildViewerSceneModel({
      locale: "en",
      session: initialViewerSessionState,
      mock: {
        ...createViewerMockState("en"),
        username: "Mina",
      },
    });

    renderViewerShell(scene, { onDisplayNameChange });

    const nameInput = screen.getByDisplayValue("Mina") as HTMLInputElement;

    expect(nameInput.getAttribute("aria-label")).toMatch(/Name|名称/);
    expect(nameInput.value).toBe("Mina");

    fireEvent.change(nameInput, { target: { value: "Noa" } });
    fireEvent.blur(nameInput);

    expect(onDisplayNameChange).toHaveBeenCalledWith("Noa");

    nameInput.focus();
    fireEvent.change(nameInput, { target: { value: "Ira" } });
    fireEvent.keyDown(nameInput, { key: "Enter" });

    expect(onDisplayNameChange).toHaveBeenCalledWith("Ira");
  });

  it("limits display name and chat input length", () => {
    const scene = buildViewerSceneModel({
      locale: "en",
      session: initialViewerSessionState,
      mock: {
        ...createViewerMockState("en"),
        username: "Mina",
      },
    });

    renderViewerShell(scene);

    const nameInput = screen.getByDisplayValue("Mina") as HTMLInputElement;
    const messageInput = screen.getByPlaceholderText(
      /Send a message|发送消息/,
    ) as HTMLInputElement;

    expect(nameInput.maxLength).toBe(80);
    expect(messageInput.maxLength).toBe(500);
  });

  it("restores the current display name when a blank edit blurs", () => {
    const onDisplayNameChange = vi.fn();
    const scene = buildViewerSceneModel({
      locale: "en",
      session: initialViewerSessionState,
      mock: {
        ...createViewerMockState("en"),
        username: "Mina",
      },
    });

    renderViewerShell(scene, { onDisplayNameChange });

    const nameInput = screen.getByDisplayValue("Mina") as HTMLInputElement;

    fireEvent.change(nameInput, { target: { value: "   " } });
    fireEvent.blur(nameInput);

    expect(onDisplayNameChange).not.toHaveBeenCalled();
    expect(nameInput.value).toBe("Mina");
  });

  it("preserves failed chat sends and clears successful sends", () => {
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
    expect(messageInput.value).toBe("");
  });

  it("renders a DPlayer container for the live viewer surface", () => {
    const scene = buildViewerSceneModel({
      locale: "en",
      session: initialViewerSessionState,
      mock: createViewerMockState("en"),
    });

    renderViewerShell(scene);

    expect(screen.getByTestId("viewer-video")).toBeTruthy();
    expect(dplayerInstances).toHaveLength(1);
  });

  it("rebinds the DPlayer video element to the latest MediaStream", () => {
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

    expect(dplayerInstances[0]?.video.srcObject).toBe(secondStream);
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
    expect(dplayerInstances[0]?.video.muted).toBe(false);
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
