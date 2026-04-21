// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  collectVisibleVideos,
  getVideoHandle,
  listVisibleVideoSources,
} from "../entrypoints/content/video-detector";
import { createVideoMessageListener } from "../entrypoints/content";

function setVideoRect(element: Element | null, width: number, height: number) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ width, height, top: 0, left: 0, right: width, bottom: height }),
  });
}

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

describe("listVisibleVideoSources", () => {
  it("returns stable handles and useful labels", () => {
    document.body.innerHTML = `
      <video id="named" src="https://example.com/a.mp4"></video>
      <video id=""></video>
    `;

    const named = document.querySelectorAll("video")[0] as HTMLVideoElement;
    const unnamed = document.querySelectorAll("video")[1] as HTMLVideoElement;

    setVideoRect(named, 300, 200);
    setVideoRect(unnamed, 200, 100);

    const firstPass = listVisibleVideoSources();
    const secondPass = listVisibleVideoSources();

    expect(firstPass).toEqual(secondPass);
    expect(firstPass[0]).toEqual({
      id: getVideoHandle(named),
      label: "https://example.com/a.mp4",
    });
    expect(firstPass[1]).toEqual({
      id: getVideoHandle(unnamed),
      label: "Video 2",
    });
  });
});

describe("createVideoMessageListener", () => {
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
      {
        id: getVideoHandle(video),
        label: "https://example.com/message.mp4",
      },
    ]);
  });
});
