// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectPageVideos,
  collectVisibleVideos,
  findVisibleVideoByHandle,
  getVideoHandle,
  listVisibleVideoCandidates,
  listVisibleVideoSources,
} from "../../entrypoints/content/video-detector";
import {
  createContentReadyNotifier,
  createLazyContentChatWidgetController,
  createVideoChangeNotifier,
  createVideoMessageListener,
  getScreenMatePageKind,
} from "../../entrypoints/content";
import { ContentScriptContext } from "wxt/utils/content-script-context";

function setVideoRect(element: Element | null, width: number, height: number) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ width, height, top: 0, left: 0, right: width, bottom: height }),
  });
}

afterEach(() => {
  document.documentElement.removeAttribute("data-screenmate-app");
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("collectVisibleVideos", () => {
  it("returns visible videos ordered by size", () => {
    document.body.innerHTML = `
      <video id="small"></video>
      <video id="large"></video>
    `;

    setVideoRect(document.getElementById("small"), 100, 100);
    setVideoRect(document.getElementById("large"), 400, 400);

    const videos = collectVisibleVideos();

    expect(videos.map((video) => video.id)).toEqual(["large", "small"]);
  });

  it("prioritizes playing visible videos before larger paused videos", () => {
    document.body.innerHTML = `
      <video id="large-paused"></video>
      <video id="small-playing"></video>
    `;

    const largePaused = document.getElementById("large-paused") as HTMLVideoElement;
    const smallPlaying = document.getElementById("small-playing") as HTMLVideoElement;
    setVideoRect(largePaused, 800, 450);
    setVideoRect(smallPlaying, 320, 180);
    Object.defineProperty(largePaused, "paused", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(smallPlaying, "paused", {
      configurable: true,
      value: false,
    });
    Object.defineProperty(smallPlaying, "ended", {
      configurable: true,
      value: false,
    });

    const videos = collectVisibleVideos();

    expect(videos.map((video) => video.id)).toEqual(["small-playing", "large-paused"]);
  });

  it("excludes hidden and non-displayable videos", () => {
    document.body.innerHTML = `
      <video id="visible"></video>
      <video id="display-none" style="display: none;"></video>
      <video id="visibility-hidden" style="visibility: hidden;"></video>
      <video id="hidden-attr" hidden></video>
      <video id="zero-size"></video>
    `;

    setVideoRect(document.getElementById("visible"), 320, 180);
    setVideoRect(document.getElementById("display-none"), 320, 180);
    setVideoRect(document.getElementById("visibility-hidden"), 320, 180);
    setVideoRect(document.getElementById("hidden-attr"), 320, 180);
    setVideoRect(document.getElementById("zero-size"), 0, 0);

    const videos = collectVisibleVideos();

    expect(videos.map((video) => video.id)).toEqual(["visible"]);
  });

  it("returns stable handles for repeated lookups", () => {
    document.body.innerHTML = `
      <video id="first"></video>
      <video id="second"></video>
    `;

    const first = document.getElementById("first") as HTMLVideoElement;
    const second = document.getElementById("second") as HTMLVideoElement;

    expect(getVideoHandle(first)).toBe(getVideoHandle(first));
    expect(getVideoHandle(first)).not.toBe(getVideoHandle(second));
  });
});

describe("collectPageVideos", () => {
  it("includes hidden videos and open shadow-dom videos", () => {
    document.body.innerHTML = `
      <video id="visible"></video>
      <video id="hidden" hidden></video>
      <div id="shadow-host"></div>
    `;

    const visible = document.getElementById("visible") as HTMLVideoElement;
    const hidden = document.getElementById("hidden") as HTMLVideoElement;
    const shadowHost = document.getElementById("shadow-host") as HTMLDivElement;
    const shadowRoot = shadowHost.attachShadow({ mode: "open" });
    const shadowVideo = document.createElement("video");
    shadowVideo.id = "shadow-video";
    shadowRoot.appendChild(shadowVideo);

    setVideoRect(visible, 320, 180);
    setVideoRect(hidden, 0, 0);
    setVideoRect(shadowVideo, 200, 100);

    const videos = collectPageVideos();

    expect(videos.map((video) => video.id)).toEqual([
      "visible",
      "shadow-video",
      "hidden",
    ]);
  });

  it("detects videos even when HTMLVideoElement instanceof checks are unreliable", () => {
    document.body.innerHTML = `<video id="cross-realm"></video>`;
    const video = document.getElementById("cross-realm") as HTMLVideoElement;
    const originalVideoCtor = globalThis.HTMLVideoElement;

    setVideoRect(video, 320, 180);
    Object.defineProperty(globalThis, "HTMLVideoElement", {
      configurable: true,
      value: class HTMLVideoElementMock extends HTMLElement {},
    });

    try {
      const videos = collectPageVideos();
      expect(videos.map((item) => item.id)).toContain("cross-realm");
    } finally {
      Object.defineProperty(globalThis, "HTMLVideoElement", {
        configurable: true,
        value: originalVideoCtor,
      });
    }
  });
});

describe("listVisibleVideoSources", () => {
  it("returns stable handles and useful labels", () => {
    window.history.replaceState({}, "", "/video/BV1demo");
    document.body.innerHTML = `
      <video id="named" src="https://example.com/a.mp4"></video>
      <video id="hidden" hidden></video>
    `;

    const named = document.querySelectorAll("video")[0] as HTMLVideoElement;
    const hidden = document.querySelectorAll("video")[1] as HTMLVideoElement;

    setVideoRect(named, 300, 200);
    setVideoRect(hidden, 0, 0);

    const firstPass = listVisibleVideoSources();
    const secondPass = listVisibleVideoSources();

    expect(firstPass).toEqual(secondPass);
    expect(firstPass[0]).toMatchObject({
      id: getVideoHandle(named),
      label: "https://example.com/a.mp4",
      primaryUrl: "https://example.com/a.mp4",
      format: "mp4",
      isVisible: true,
      isPlaying: false,
      visibleArea: 60_000,
      fingerprint: {
        primaryUrl: "https://example.com/a.mp4",
        pageUrl: "http://localhost:3000/video/BV1demo",
        elementId: "named",
        label: "https://example.com/a.mp4",
        visibleIndex: 0,
      },
    });
    expect(firstPass[1]).toMatchObject({
      id: getVideoHandle(hidden),
      label: "hidden (not visible)",
      primaryUrl: null,
      isVisible: false,
    });
  });

  it("captures a best-effort thumbnail from a readable video frame", () => {
    document.body.innerHTML = `<video id="with-frame" src="https://example.com/a.mp4"></video>`;
    const video = document.getElementById("with-frame") as HTMLVideoElement;
    setVideoRect(video, 300, 200);
    Object.defineProperty(video, "readyState", {
      configurable: true,
      value: HTMLMediaElement.HAVE_CURRENT_DATA,
    });
    Object.defineProperty(video, "videoWidth", {
      configurable: true,
      value: 1280,
    });
    Object.defineProperty(video, "videoHeight", {
      configurable: true,
      value: 720,
    });

    const originalCreateElement = document.createElement.bind(document);
    const drawImage = vi.fn();
    vi.spyOn(document, "createElement").mockImplementation((tagName) => {
      if (tagName === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext: vi.fn(() => ({ drawImage })),
          toDataURL: vi.fn(() => "data:image/webp;base64,frame"),
        } as unknown as HTMLCanvasElement;
      }

      return originalCreateElement(tagName);
    });

    const [source] = listVisibleVideoSources();

    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 320, 180);
    expect(source?.thumbnailUrl).toBe("data:image/webp;base64,frame");
  });

  it("omits the frame thumbnail when the video cannot be read", () => {
    document.body.innerHTML = `<video id="tainted" src="https://example.com/a.mp4"></video>`;
    const video = document.getElementById("tainted") as HTMLVideoElement;
    setVideoRect(video, 300, 200);
    Object.defineProperty(video, "readyState", {
      configurable: true,
      value: HTMLMediaElement.HAVE_CURRENT_DATA,
    });
    Object.defineProperty(video, "videoWidth", {
      configurable: true,
      value: 1280,
    });
    Object.defineProperty(video, "videoHeight", {
      configurable: true,
      value: 720,
    });

    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName) => {
      if (tagName === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext: vi.fn(() => ({
            drawImage: vi.fn(() => {
              throw new DOMException("Tainted canvas", "SecurityError");
            }),
          })),
          toDataURL: vi.fn(),
        } as unknown as HTMLCanvasElement;
      }

      return originalCreateElement(tagName);
    });

    const [source] = listVisibleVideoSources();

    expect(source?.thumbnailUrl).toBeNull();
  });
});

describe("listVisibleVideoCandidates", () => {
  it("returns a recovery fingerprint for each visible video candidate", () => {
    window.history.replaceState({}, "", "/video/BV1demo");
    document.body.innerHTML = `<video id="hero" src="https://example.com/hero.mp4"></video>`;
    const video = document.getElementById("hero") as HTMLVideoElement;
    setVideoRect(video, 640, 360);

    const [candidate] = listVisibleVideoCandidates();

    expect(candidate).toMatchObject({
      id: expect.stringMatching(/^screenmate-video-/),
      label: "https://example.com/hero.mp4",
      fingerprint: {
        primaryUrl: "https://example.com/hero.mp4",
        pageUrl: "http://localhost:3000/video/BV1demo",
        elementId: "hero",
        label: "https://example.com/hero.mp4",
        visibleIndex: 0,
      },
    });
  });

  it("indexes candidates within the visible-video list when hidden videos exist", () => {
    document.body.innerHTML = `
      <video id="visible-large" src="https://example.com/large.mp4"></video>
      <video id="hidden" src="https://example.com/hidden.mp4" hidden></video>
      <video id="visible-small" src="https://example.com/small.mp4"></video>
    `;

    const visibleLarge = document.getElementById(
      "visible-large",
    ) as HTMLVideoElement;
    const hidden = document.getElementById("hidden") as HTMLVideoElement;
    const visibleSmall = document.getElementById(
      "visible-small",
    ) as HTMLVideoElement;

    setVideoRect(visibleLarge, 640, 360);
    setVideoRect(hidden, 1, 1);
    setVideoRect(visibleSmall, 320, 180);

    const candidates = listVisibleVideoCandidates();

    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.label)).toEqual([
      "https://example.com/large.mp4",
      "https://example.com/small.mp4",
    ]);
    expect(candidates.map((candidate) => candidate.fingerprint.visibleIndex)).toEqual(
      [0, 1],
    );
  });
});

describe("findVisibleVideoByHandle", () => {
  it("returns the matching visible video by handle", () => {
    document.body.innerHTML = `
      <video id="first"></video>
      <video id="second"></video>
    `;

    const first = document.getElementById("first") as HTMLVideoElement;
    const second = document.getElementById("second") as HTMLVideoElement;
    setVideoRect(first, 100, 100);
    setVideoRect(second, 200, 100);

    const secondHandle = getVideoHandle(second);

    expect(findVisibleVideoByHandle(secondHandle)).toBe(second);
  });
});

describe("createVideoMessageListener", () => {
  it("does not expose viewer page playback as selectable videos", async () => {
    document.documentElement.dataset.screenmateApp = "viewer";
    document.body.innerHTML = `<video id="viewer-video" src="https://example.com/viewer.mp4"></video>`;
    setVideoRect(document.getElementById("viewer-video"), 400, 225);

    const listener = createVideoMessageListener();
    const sendResponse = vi.fn();

    const shouldKeepOpen = listener({ type: "screenmate:list-videos" }, {} as never, sendResponse);

    expect(shouldKeepOpen).toBe(true);

    await Promise.resolve();

    expect(sendResponse).toHaveBeenCalledWith([]);
  });

  it("responds through sendResponse and keeps the channel open", async () => {
    document.body.innerHTML = `<video id="message-video" src="https://example.com/message.mp4"></video>`;
    const video = document.getElementById("message-video") as HTMLVideoElement;
    setVideoRect(video, 400, 225);

    const listener = createVideoMessageListener();
    const sendResponse = vi.fn();

    const shouldKeepOpen = listener({ type: "screenmate:list-videos" }, {} as never, sendResponse);

    expect(shouldKeepOpen).toBe(true);

    await Promise.resolve();

    expect(sendResponse).toHaveBeenCalledWith([
      expect.objectContaining({
        id: getVideoHandle(video),
        label: "https://example.com/message.mp4",
        primaryUrl: "https://example.com/message.mp4",
        format: "mp4",
        isVisible: true,
      }),
    ]);
  });

  it("routes preview messages to the preview controller", async () => {
    const previewController = {
      clear: vi.fn(() => ({ ok: true as const })),
      destroy: vi.fn(),
      preview: vi.fn(() => ({ ok: true as const })),
      refresh: vi.fn(),
    };
    const listener = createVideoMessageListener(undefined, previewController);
    const sendResponse = vi.fn();

    const shouldKeepOpen = listener(
      {
        type: "screenmate:preview-video",
        active: true,
        frameId: 5,
        label: "Preview video",
        videoId: "screenmate-video-1",
      },
      {} as never,
      sendResponse,
    );

    expect(shouldKeepOpen).toBe(true);

    await Promise.resolve();

    expect(previewController.preview).toHaveBeenCalledWith({
      active: true,
      frameId: 5,
      label: "Preview video",
      videoId: "screenmate-video-1",
    });
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });

  it("tears down the active attachment on explicit detach control messages", async () => {
    const sourceAttachmentRuntime = {
      attachSource: vi.fn(),
      beginViewerNegotiation: vi.fn(),
      destroy: vi.fn(),
      handleSignal: vi.fn(),
    };
    const listener = createVideoMessageListener(
      sourceAttachmentRuntime as never,
    );
    const sendResponse = vi.fn();

    const shouldKeepOpen = listener(
      { type: "screenmate:detach-source" },
      {} as never,
      sendResponse,
    );

    expect(shouldKeepOpen).toBe(true);

    await Promise.resolve();

    expect(sourceAttachmentRuntime.destroy).toHaveBeenCalledWith("manual-detach");
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });

  it("keeps video listing independent from chat widget load failures", async () => {
    document.body.innerHTML = `<video id="message-video" src="https://example.com/message.mp4"></video>`;
    const video = document.getElementById("message-video") as HTMLVideoElement;
    setVideoRect(video, 400, 225);

    const chatWidget = createLazyContentChatWidgetController(
      new ContentScriptContext("content-chat-widget-test"),
      {
        importWidget: vi.fn().mockRejectedValue(new Error("ui unavailable")),
        onError: vi.fn(),
      },
    );
    const listener = createVideoMessageListener(undefined, undefined, chatWidget);
    const sendResponse = vi.fn();

    chatWidget.show();
    const shouldKeepOpen = listener({ type: "screenmate:list-videos" }, {} as never, sendResponse);

    expect(shouldKeepOpen).toBe(true);

    await Promise.resolve();

    expect(sendResponse).toHaveBeenCalledWith([
      expect.objectContaining({
        id: getVideoHandle(video),
        label: "https://example.com/message.mp4",
        primaryUrl: "https://example.com/message.mp4",
      }),
    ]);
  });
});

describe("getScreenMatePageKind", () => {
  it("detects the viewer page from the shared DOM marker", () => {
    document.documentElement.dataset.screenmateApp = "viewer";

    expect(getScreenMatePageKind()).toBe("viewer");
  });

  it("detects the viewer page from the meta marker", () => {
    document.documentElement.removeAttribute("data-screenmate-app");
    document.head.innerHTML = `<meta name="screenmate-app" content="viewer" />`;

    expect(getScreenMatePageKind()).toBe("viewer");
  });
});

describe("createContentReadyNotifier", () => {
  it("only sends the initial notification on ScreenMate viewer pages", () => {
    const notify = vi.fn();
    const createNotifier = vi.fn(() => ({
      start: vi.fn(),
      stop: vi.fn(),
    }));

    const notifier = createContentReadyNotifier({
      createNotifier,
      getPageKind: () => "viewer",
      notify,
    });

    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith("initial");
    expect(createNotifier).not.toHaveBeenCalled();

    notifier.stop();
  });
});

describe("createVideoChangeNotifier", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    document.title = "";
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("debounces DOM video additions into a content-ready notification", async () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    const notifier = createVideoChangeNotifier({
      debounceMs: 250,
      highFrequencyLifetimeMs: 15_000,
      notify,
      pollIntervalMs: 1_000,
    });

    notifier.start();
    expect(notify).toHaveBeenCalledTimes(1);

    document.body.appendChild(document.createElement("video"));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(249);
    expect(notify).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(notify).toHaveBeenCalledTimes(2);

    notifier.stop();
  });

  it("notifies when an existing video's media metadata changes", async () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    const notifier = createVideoChangeNotifier({
      debounceMs: 100,
      highFrequencyLifetimeMs: 15_000,
      notify,
      pollIntervalMs: 1_000,
    });
    const video = document.createElement("video");
    document.body.appendChild(video);

    notifier.start();
    expect(notify).toHaveBeenCalledTimes(1);

    video.dispatchEvent(new Event("loadedmetadata"));
    await vi.advanceTimersByTimeAsync(100);

    expect(notify).toHaveBeenCalledTimes(2);
    notifier.stop();
  });

  it("notifies when playback starts so the thumbnail can refresh", async () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    const notifier = createVideoChangeNotifier({
      debounceMs: 100,
      highFrequencyLifetimeMs: 15_000,
      notify,
      pollIntervalMs: 1_000,
    });
    const video = document.createElement("video");
    document.body.appendChild(video);

    notifier.start();
    expect(notify).toHaveBeenCalledTimes(1);

    video.dispatchEvent(new Event("playing"));
    await vi.advanceTimersByTimeAsync(100);

    expect(notify).toHaveBeenCalledTimes(2);
    notifier.stop();
  });

  it("throttles timeupdate thumbnail refreshes while video keeps playing", async () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    const notifier = createVideoChangeNotifier({
      debounceMs: 100,
      highFrequencyLifetimeMs: 15_000,
      notify,
      pollIntervalMs: 1_000,
      thumbnailRefreshMinMs: 1_000,
    });
    const video = document.createElement("video");
    document.body.appendChild(video);

    notifier.start();
    expect(notify).toHaveBeenCalledTimes(1);

    video.dispatchEvent(new Event("timeupdate"));
    await vi.advanceTimersByTimeAsync(100);
    expect(notify).toHaveBeenCalledTimes(2);

    video.dispatchEvent(new Event("timeupdate"));
    await vi.advanceTimersByTimeAsync(999);
    expect(notify).toHaveBeenCalledTimes(2);

    video.dispatchEvent(new Event("timeupdate"));
    await vi.advanceTimersByTimeAsync(100);
    expect(notify).toHaveBeenCalledTimes(3);
    notifier.stop();
  });

  it("notifies on SPA location changes without waiting for polling", async () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    const notifier = createVideoChangeNotifier({
      debounceMs: 100,
      highFrequencyLifetimeMs: 15_000,
      notify,
      pollIntervalMs: 1_000,
    });

    notifier.start();
    expect(notify).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("wxt:locationchange"));
    await vi.advanceTimersByTimeAsync(99);
    expect(notify).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(notify).toHaveBeenCalledTimes(2);
    notifier.stop();
  });

  it("notifies when the page title changes even if the video element is reused", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "MutationObserver",
      class NoopMutationObserver {
        observe() {}
        disconnect() {}
      },
    );
    document.title = "Old video title";
    const notify = vi.fn();
    const notifier = createVideoChangeNotifier({
      debounceMs: 100,
      highFrequencyLifetimeMs: 15_000,
      notify,
      pollIntervalMs: 1_000,
    });
    document.body.appendChild(document.createElement("video"));

    notifier.start();
    expect(notify).toHaveBeenCalledTimes(1);

    document.title = "New video title";
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(100);

    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenLastCalledWith("page-title-changed");
    notifier.stop();
  });

  it("notifies when the SPA URL changes without replacing the video element", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "MutationObserver",
      class NoopMutationObserver {
        observe() {}
        disconnect() {}
      },
    );
    window.history.replaceState({}, "", "/watch/old");
    const notify = vi.fn();
    const notifier = createVideoChangeNotifier({
      debounceMs: 100,
      highFrequencyLifetimeMs: 15_000,
      notify,
      pollIntervalMs: 1_000,
    });
    document.body.appendChild(document.createElement("video"));

    notifier.start();
    expect(notify).toHaveBeenCalledTimes(1);

    window.history.replaceState({}, "", "/watch/new");
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(100);

    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenLastCalledWith("page-location-changed");
    notifier.stop();
  });

  it("keeps polling source changes promptly after the high-frequency window", async () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    const notifier = createVideoChangeNotifier({
      debounceMs: 100,
      highFrequencyLifetimeMs: 250,
      notify,
      pollIntervalMs: 50,
    });
    const video = document.createElement("video");
    Object.defineProperty(video, "currentSrc", {
      configurable: true,
      value: "",
    });
    document.body.appendChild(video);

    notifier.start();
    expect(notify).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(250);
    Object.defineProperty(video, "currentSrc", {
      configurable: true,
      value: "https://example.com/next.mp4",
    });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(notify).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(100);

    expect(notify).toHaveBeenCalledTimes(2);
    notifier.stop();
  });

  it("detects srcObject changes as a media landscape change", async () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    const notifier = createVideoChangeNotifier({
      debounceMs: 100,
      highFrequencyLifetimeMs: 15_000,
      notify,
      pollIntervalMs: 1_000,
    });
    const video = document.createElement("video");
    document.body.appendChild(video);

    notifier.start();
    expect(notify).toHaveBeenCalledTimes(1);

    Object.defineProperty(video, "srcObject", {
      configurable: true,
      value: {},
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(100);

    expect(notify).toHaveBeenCalledTimes(2);
    notifier.stop();
  });
});
