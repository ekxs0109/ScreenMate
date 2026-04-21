// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { collectVisibleVideos } from "../entrypoints/content/video-detector";

describe("collectVisibleVideos", () => {
  it("returns visible videos ordered by size", () => {
    document.body.innerHTML = `
      <video id="small"></video>
      <video id="large"></video>
    `;

    Object.defineProperty(document.getElementById("small"), "getBoundingClientRect", {
      value: () => ({ width: 100, height: 100, top: 0, left: 0 }),
    });
    Object.defineProperty(document.getElementById("large"), "getBoundingClientRect", {
      value: () => ({ width: 400, height: 400, top: 0, left: 0 }),
    });

    const videos = collectVisibleVideos();

    expect(videos.map((video) => video.id)).toEqual(["large", "small"]);
  });
});
