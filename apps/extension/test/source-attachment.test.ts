// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { createSourceAttachmentRuntime } from "../entrypoints/content/source-attachment";
import { getVideoHandle } from "../entrypoints/content/video-detector";

describe("createSourceAttachmentRuntime", () => {
  it("marks the source detached when the captured track ends", async () => {
    document.body.innerHTML = `<video id="host" src="https://example.com/host.mp4"></video>`;
    const video = document.getElementById("host") as HTMLVideoElement;
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
});
