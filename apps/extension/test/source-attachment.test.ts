// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { createSourceAttachmentRuntime } from "../entrypoints/content/source-attachment";
import { getVideoHandle } from "../entrypoints/content/video-detector";

function setVideoRect(element: Element | null, width: number, height: number) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ width, height, top: 0, left: 0, right: width, bottom: height }),
  });
}

describe("createSourceAttachmentRuntime", () => {
  it("marks the source detached when the captured track ends", async () => {
    document.body.innerHTML = `<video id="host" src="https://example.com/host.mp4"></video>`;
    const video = document.getElementById("host") as HTMLVideoElement;
    setVideoRect(video, 640, 360);
    const track = {
      kind: "video",
      stop: vi.fn(),
      addEventListener: vi.fn((type: string, listener: () => void) => {
        if (type === "ended") {
          listener();
        }
      }),
    } as unknown as MediaStreamTrack;

    Object.defineProperty(video, "captureStream", {
      configurable: true,
      value: vi.fn(() => ({ getTracks: () => [track] })),
    });

    const onSourceDetached = vi.fn();
    const runtime = createSourceAttachmentRuntime({
      now: () => 10,
      onSignal: vi.fn(),
      onSourceDetached,
      RTCPeerConnectionImpl: class {
        addEventListener() {}
        addTrack() {}
        async createOffer() {
          return { sdp: "offer-sdp" };
        }
        async setLocalDescription() {}
        async setRemoteDescription() {}
        async addIceCandidate() {}
        close() {}
      } as never,
    });

    await runtime.attachSource({
      roomId: "room_123",
      sessionId: "host_1",
      videoId: getVideoHandle(video),
      viewerSessionIds: [],
      iceServers: [],
    });

    expect(onSourceDetached).toHaveBeenCalledWith({
      reason: "track-ended",
      roomId: "room_123",
    });
  });

  it("returns a visible-list fingerprint index when hidden videos exist", async () => {
    document.body.innerHTML = `
      <video id="hidden" src="https://example.com/hidden.mp4" hidden></video>
      <video id="host" src="https://example.com/host.mp4"></video>
    `;
    const hidden = document.getElementById("hidden") as HTMLVideoElement;
    const video = document.getElementById("host") as HTMLVideoElement;
    setVideoRect(hidden, 1, 1);
    setVideoRect(video, 640, 360);

    const track = {
      kind: "video",
      stop: vi.fn(),
      addEventListener: vi.fn(),
    } as unknown as MediaStreamTrack;

    Object.defineProperty(video, "captureStream", {
      configurable: true,
      value: vi.fn(() => ({ getTracks: () => [track] })),
    });

    const runtime = createSourceAttachmentRuntime({
      now: () => 10,
      onSignal: vi.fn(),
      onSourceDetached: vi.fn(),
      RTCPeerConnectionImpl: class {
        addEventListener() {}
        addTrack() {}
        async createOffer() {
          return { sdp: "offer-sdp" };
        }
        async setLocalDescription() {}
        async setRemoteDescription() {}
        async addIceCandidate() {}
        close() {}
      } as never,
    });

    const result = await runtime.attachSource({
      roomId: "room_123",
      sessionId: "host_1",
      videoId: getVideoHandle(video),
      viewerSessionIds: [],
      iceServers: [],
    });

    expect(result.fingerprint).toMatchObject({
      primaryUrl: "https://example.com/host.mp4",
      elementId: "host",
      label: "https://example.com/host.mp4",
      visibleIndex: 0,
    });
  });
});
