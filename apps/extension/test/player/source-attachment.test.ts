// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlayerSourceAttachmentRuntime } from "../../entrypoints/player/source-attachment";

function createMockTrack(kind = "video") {
  return {
    kind,
    addEventListener: vi.fn(),
    getSettings: vi.fn(() => ({ width: 1280, height: 720 })),
    stop: vi.fn(),
  } as unknown as MediaStreamTrack;
}

function createMockStream(track = createMockTrack()) {
  return {
    getTracks: () => [track],
  } as unknown as MediaStream;
}

describe("player source attachment", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("captures the currently playing local player video", async () => {
    const video = document.createElement("video");
    video.id = "screenmate-player-local-video";
    document.body.append(video);
    Object.defineProperty(video, "readyState", {
      configurable: true,
      get: () => 2,
    });
    Object.defineProperty(video, "videoWidth", {
      configurable: true,
      get: () => 1280,
    });
    Object.defineProperty(video, "videoHeight", {
      configurable: true,
      get: () => 720,
    });
    const stream = createMockStream();
    Object.defineProperty(video, "captureStream", {
      configurable: true,
      value: vi.fn(() => stream),
    });
    const runtime = createPlayerSourceAttachmentRuntime({
      getVideo: () => video,
      onSignal: vi.fn(),
      onSourceDetached: vi.fn(),
    });

    const response = await runtime.attachLocalVideo({
      roomSession: {
        roomId: "room_123",
        sessionId: "host_1",
        viewerSessionIds: [],
        iceServers: [],
      },
      sourceLabel: "demo.mp4",
    });

    expect(
      (video as HTMLVideoElement & { captureStream: () => MediaStream }).captureStream,
    ).toHaveBeenCalled();
    expect(response).toEqual({
      sourceLabel: "demo.mp4",
      fingerprint: {
        primaryUrl: "screenmate://player-local-video",
        pageUrl: "http://localhost:3000/",
        elementId: "screenmate-player-local-video",
        label: "demo.mp4",
        visibleIndex: 0,
      },
    });
  });

  it("waits for slow local player files to expose video tracks", async () => {
    vi.useFakeTimers();
    try {
      const video = document.createElement("video");
      video.id = "screenmate-player-local-video";
      document.body.append(video);
      Object.defineProperty(video, "readyState", {
        configurable: true,
        get: () => 2,
      });
      const emptyStream = {
        getTracks: () => [],
      } as unknown as MediaStream;
      const readyStream = createMockStream();
      let hasVideoTrack = false;
      Object.defineProperty(video, "captureStream", {
        configurable: true,
        value: vi.fn(() => (hasVideoTrack ? readyStream : emptyStream)),
      });
      const runtime = createPlayerSourceAttachmentRuntime({
        getVideo: () => video,
        onSignal: vi.fn(),
        onSourceDetached: vi.fn(),
      });

      const responsePromise = runtime.attachLocalVideo({
        roomSession: {
          roomId: "room_123",
          sessionId: "host_1",
          viewerSessionIds: [],
          iceServers: [],
        },
        sourceLabel: "mounted-demo.mp4",
      });

      vi.advanceTimersByTime(5_000);
      hasVideoTrack = true;
      video.dispatchEvent(new Event("loadeddata"));
      await Promise.resolve();

      await expect(responsePromise).resolves.toMatchObject({
        sourceLabel: "mounted-demo.mp4",
      });
      expect(
        (video as HTMLVideoElement & { captureStream: () => MediaStream })
          .captureStream,
      ).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for a slow mounted local player file to produce its first frame", async () => {
    vi.useFakeTimers();
    try {
      const video = document.createElement("video");
      video.id = "screenmate-player-local-video";
      document.body.append(video);
      let readyState = 1;
      Object.defineProperty(video, "readyState", {
        configurable: true,
        get: () => readyState,
      });
      const stream = createMockStream();
      Object.defineProperty(video, "captureStream", {
        configurable: true,
        value: vi.fn(() => stream),
      });
      const runtime = createPlayerSourceAttachmentRuntime({
        getVideo: () => video,
        onSignal: vi.fn(),
        onSourceDetached: vi.fn(),
      });
      const settled = vi.fn();

      const responsePromise = runtime.attachLocalVideo({
        roomSession: {
          roomId: "room_123",
          sessionId: "host_1",
          viewerSessionIds: [],
          iceServers: [],
        },
        sourceLabel: "mounted-demo.mp4",
      });
      responsePromise.then(settled, settled);

      await Promise.resolve();
      expect(settled).not.toHaveBeenCalled();

      vi.advanceTimersByTime(5_000);
      readyState = 2;
      video.dispatchEvent(new Event("loadeddata"));
      await Promise.resolve();

      await expect(responsePromise).resolves.toMatchObject({
        sourceLabel: "mounted-demo.mp4",
      });
      expect(
        (video as HTMLVideoElement & { captureStream: () => MediaStream })
          .captureStream,
      ).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects when the player video element is not ready", async () => {
    const runtime = createPlayerSourceAttachmentRuntime({
      getVideo: () => null,
      onSignal: vi.fn(),
      onSourceDetached: vi.fn(),
    });

    await expect(
      runtime.attachLocalVideo({
        roomSession: {
          roomId: "room_123",
          sessionId: "host_1",
          viewerSessionIds: [],
          iceServers: [],
        },
        sourceLabel: "demo.mp4",
      }),
    ).rejects.toThrow("Local player video is not ready.");
  });
});
