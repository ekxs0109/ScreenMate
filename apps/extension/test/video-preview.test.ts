// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  clearVideoSelectionPreview,
  showVideoSelectionPreview,
} from "../entrypoints/content/video-preview";

function setVideoRect(element: Element | null, width: number, height: number) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      width,
      height,
      top: 12,
      left: 24,
      right: 24 + width,
      bottom: 12 + height,
    }),
  });
}

describe("video preview overlay", () => {
  it("renders a highlight for the selected video", () => {
    document.body.innerHTML = `<video id="target"></video>`;
    const video = document.getElementById("target") as HTMLVideoElement;
    setVideoRect(video, 320, 180);

    showVideoSelectionPreview({
      frameId: 5,
      label: "Demo video",
      video,
      videoId: "screenmate-video-1",
    });

    const overlay = document.querySelector(
      "[data-screenmate-preview='overlay']",
    ) as HTMLDivElement | null;

    expect(overlay).not.toBeNull();
    expect(overlay?.textContent).toContain("Demo video");
    expect(overlay?.textContent).toContain("iframe #5");
  });

  it("removes the preview overlay when cleared", () => {
    document.body.innerHTML = `<video id="target"></video>`;
    const video = document.getElementById("target") as HTMLVideoElement;
    setVideoRect(video, 320, 180);

    showVideoSelectionPreview({
      frameId: 0,
      label: "Demo video",
      video,
      videoId: "screenmate-video-1",
    });
    clearVideoSelectionPreview();

    expect(
      document.querySelector("[data-screenmate-preview='overlay']"),
    ).toBeNull();
  });
});
