// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import { readLocalMediaFile } from "../../lib/local-media-store";

vi.mock("../../lib/local-media-store", () => ({
  readLocalMediaFile: vi.fn(),
}));

type MockTrack = MediaStreamTrack & {
  emit: (type: string) => void;
};

function createMockTrack(kind = "video"): MockTrack {
  const listeners = new Map<string, Set<() => void>>();
  return {
    kind,
    stop: vi.fn(() => {
      for (const listener of listeners.get("ended") ?? []) {
        listener();
      }
    }),
    addEventListener: vi.fn((type: string, listener: () => void) => {
      const typedListeners = listeners.get(type) ?? new Set();
      typedListeners.add(listener);
      listeners.set(type, typedListeners);
    }),
    getSettings: vi.fn(() => ({ width: 1280, height: 720 })),
    emit(type: string) {
      for (const listener of listeners.get(type) ?? []) {
        listener();
      }
    },
  } as unknown as MockTrack;
}

function createMockStream(track = createMockTrack()) {
  return {
    getTracks: () => [track],
    getAudioTracks: () => track.kind === "audio" ? [track] : [],
    getVideoTracks: () => track.kind === "video" ? [track] : [],
  } as unknown as MediaStream;
}

describe("offscreen local source switching", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mocked(readLocalMediaFile).mockResolvedValue({
      id: "local-demo",
      name: "demo.mp4",
      size: 4,
      type: "video/mp4",
      updatedAt: 123,
      blob: new Blob(["demo"], { type: "video/mp4" }),
    });
    Object.defineProperty(globalThis.URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:local-demo"),
    });
    Object.defineProperty(globalThis.URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", {
      configurable: true,
      get: () => HTMLMediaElement.HAVE_CURRENT_DATA,
    });
    Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", {
      configurable: true,
      get: () => 720,
    });
    Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", {
      configurable: true,
      get: () => 1280,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });
    Object.defineProperty(HTMLMediaElement.prototype, "pause", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("does not report the previous screen source as detached when replacing it with a local file", async () => {
    const displayTrack = createMockTrack();
    const localTrack = createMockTrack();
    const displayStream = createMockStream(displayTrack);
    const localStream = createMockStream(localTrack);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getDisplayMedia: vi.fn().mockResolvedValue(displayStream),
      },
    });
    Object.defineProperty(HTMLVideoElement.prototype, "captureStream", {
      configurable: true,
      value: vi.fn(() => localStream),
    });
    const sendMessage = vi
      .spyOn(browser.runtime, "sendMessage")
      .mockResolvedValue(undefined);
    const { handleOffscreenMessage } = await import("../../entrypoints/offscreen/main");
    const roomSession = {
      roomId: "room_123",
      sessionId: "host_1",
      viewerSessionIds: [],
      iceServers: [],
    };

    await handleOffscreenMessage({
      type: "screenmate:offscreen-prepare-display-media",
      captureType: "screen",
    });
    await handleOffscreenMessage({
      type: "screenmate:offscreen-attach-display-media",
      roomSession,
      sourceLabel: "Shared screen",
    });
    sendMessage.mockClear();

    await handleOffscreenMessage({
      type: "screenmate:offscreen-attach-local-file",
      roomSession,
      fileId: "local-demo",
      metadata: {
        id: "local-demo",
        name: "demo.mp4",
        size: 4,
        type: "video/mp4",
        updatedAt: 123,
      },
    });

    expect(sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "screenmate:offscreen-source-detached",
        reason: "track-ended",
      }),
    );
    expect(displayTrack.stop).toHaveBeenCalled();
  });

  it("stops the active screen stream even when the next local file cannot be loaded", async () => {
    const displayTrack = createMockTrack();
    const displayStream = createMockStream(displayTrack);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getDisplayMedia: vi.fn().mockResolvedValue(displayStream),
      },
    });
    const sendMessage = vi
      .spyOn(browser.runtime, "sendMessage")
      .mockResolvedValue(undefined);
    vi.mocked(readLocalMediaFile).mockResolvedValue(null);
    const { handleOffscreenMessage } = await import("../../entrypoints/offscreen/main");
    const roomSession = {
      roomId: "room_123",
      sessionId: "host_1",
      viewerSessionIds: [],
      iceServers: [],
    };

    await handleOffscreenMessage({
      type: "screenmate:offscreen-prepare-display-media",
      captureType: "tab",
    });
    await handleOffscreenMessage({
      type: "screenmate:offscreen-attach-display-media",
      roomSession,
      sourceLabel: "Shared browser tab",
    });
    sendMessage.mockClear();

    await expect(
      handleOffscreenMessage({
        type: "screenmate:offscreen-attach-local-file",
        roomSession,
        fileId: "missing-local-demo",
        metadata: {
          id: "missing-local-demo",
          name: "missing.mp4",
          size: 4,
          type: "video/mp4",
          updatedAt: 123,
        },
      }),
    ).rejects.toThrow("Local media file is no longer available.");

    expect(displayTrack.stop).toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "screenmate:offscreen-source-detached",
        reason: "track-ended",
      }),
    );
  });

  it("rejects instead of hanging when a local file cannot load media metadata", async () => {
    vi.useFakeTimers();
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", {
      configurable: true,
      get: () => HTMLMediaElement.HAVE_NOTHING,
    });
    const { handleOffscreenMessage } = await import("../../entrypoints/offscreen/main");
    const roomSession = {
      roomId: "room_123",
      sessionId: "host_1",
      viewerSessionIds: [],
      iceServers: [],
    };

    const attachPromise = handleOffscreenMessage({
      type: "screenmate:offscreen-attach-local-file",
      roomSession,
      fileId: "local-demo",
      metadata: {
        id: "local-demo",
        name: "demo.mkv",
        size: 4,
        type: "video/x-matroska",
        updatedAt: 123,
      },
    });

    const result = await Promise.race([
      attachPromise.then(
        () => "resolved",
        (error) => error instanceof Error ? error.message : String(error),
      ),
      vi.advanceTimersByTimeAsync(60_001).then(() => "pending"),
    ]);

    expect(result).toBe(
      "Local video file could not be loaded. The browser may not support this file format or codec.",
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local-demo");
  });

  it("waits for a local file to produce its first frame before attaching", async () => {
    vi.useFakeTimers();
    let readyState: number = HTMLMediaElement.HAVE_METADATA;
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", {
      configurable: true,
      get: () => readyState,
    });
    const localTrack = createMockTrack();
    const localStream = createMockStream(localTrack);
    const captureStream = vi.fn(() => localStream);
    Object.defineProperty(HTMLVideoElement.prototype, "captureStream", {
      configurable: true,
      value: captureStream,
    });
    const { handleOffscreenMessage } = await import("../../entrypoints/offscreen/main");
    const roomSession = {
      roomId: "room_123",
      sessionId: "host_1",
      viewerSessionIds: [],
      iceServers: [],
    };
    const settled = vi.fn();

    const attachPromise = handleOffscreenMessage({
      type: "screenmate:offscreen-attach-local-file",
      roomSession,
      fileId: "local-demo",
      metadata: {
        id: "local-demo",
        name: "demo.mp4",
        size: 4,
        type: "video/mp4",
        updatedAt: 123,
      },
    });
    attachPromise.then(settled, settled);

    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);
    readyState = HTMLMediaElement.HAVE_CURRENT_DATA;
    document
      .getElementById("screenmate-offscreen-local-video")
      ?.dispatchEvent(new Event("loadeddata"));

    await expect(attachPromise).resolves.toMatchObject({
      sourceLabel: "demo.mp4",
    });
    expect(captureStream).toHaveBeenCalledTimes(2);
  });

  it("reports active local playback state for the offscreen-owned source", async () => {
    Object.defineProperty(HTMLMediaElement.prototype, "paused", {
      configurable: true,
      get: () => false,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "duration", {
      configurable: true,
      get: () => 120,
    });
    const localStream = createMockStream(createMockTrack());
    Object.defineProperty(HTMLVideoElement.prototype, "captureStream", {
      configurable: true,
      value: vi.fn(() => localStream),
    });
    const { handleOffscreenMessage } = await import("../../entrypoints/offscreen/main");
    const roomSession = {
      roomId: "room_123",
      sessionId: "host_1",
      viewerSessionIds: [],
      iceServers: [],
    };

    await handleOffscreenMessage({
      type: "screenmate:offscreen-attach-local-file",
      roomSession,
      fileId: "local-demo",
      metadata: {
        id: "local-demo",
        name: "demo.mp4",
        size: 4,
        type: "video/mp4",
        updatedAt: 123,
      },
    });
    const video = document.getElementById(
      "screenmate-offscreen-local-video",
    ) as HTMLVideoElement;
    video.currentTime = 42;

    await expect(
      handleOffscreenMessage({
        type: "screenmate:offscreen-get-local-playback-state",
      }),
    ).resolves.toEqual({
      status: "local-playback-state",
      active: true,
      currentTime: 42,
      duration: 120,
      paused: false,
      sourceLabel: "demo.mp4",
    });
  });
});
