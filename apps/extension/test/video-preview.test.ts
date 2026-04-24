// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  clearVideoSelectionPreview,
  createVideoPreviewController,
  showVideoSelectionPreview,
} from "../entrypoints/content/video-preview";
import { getVideoHandle } from "../entrypoints/content/video-detector";

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
    expect(overlay?.textContent).not.toContain("Currently previewing this tab");
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

  it("falls back to the largest visible video when the selected source is hidden", async () => {
    document.body.innerHTML = `
      <video id="hidden-source" hidden></video>
      <video id="visible-target"></video>
    `;
    const hiddenSource = document.getElementById("hidden-source") as HTMLVideoElement;
    const visibleTarget = document.getElementById("visible-target") as HTMLVideoElement;
    setVideoRect(hiddenSource, 0, 0);
    setVideoRect(visibleTarget, 640, 360);

    const controller = createVideoPreviewController();
    controller.preview({
      active: true,
      frameId: 0,
      label: "Hidden stream",
      videoId: getVideoHandle(hiddenSource),
    });

    await new Promise((resolve) => window.setTimeout(resolve, 20));

    const overlay = document.querySelector(
      "[data-screenmate-preview='overlay']",
    ) as HTMLDivElement | null;

    expect(overlay).not.toBeNull();
    expect(overlay?.style.width).toBe("640px");
    expect(overlay?.style.height).toBe("360px");
    expect(overlay?.textContent).toContain("Hidden stream");
    controller.destroy();
  });
});
