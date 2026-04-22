// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { errorCodes } from "@screenmate/shared";
import { createSourceAttachmentRuntime } from "../entrypoints/content/source-attachment";
import { getVideoHandle } from "../entrypoints/content/video-detector";

function setVideoRect(element: Element | null, width: number, height: number) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ width, height, top: 0, left: 0, right: width, bottom: height }),
  });
}

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createMockTrack(kind = "video") {
  const listeners = new Map<string, Set<() => void>>();

  return {
    kind,
    stop: vi.fn(),
    addEventListener: vi.fn((type: string, listener: () => void) => {
      const typedListeners = listeners.get(type) ?? new Set();
      typedListeners.add(listener);
      listeners.set(type, typedListeners);
    }),
    emit(type: string) {
      for (const listener of listeners.get(type) ?? []) {
        listener();
      }
    },
  };
}

class MockRTCPeerConnection {
  static instances: MockRTCPeerConnection[] = [];
  static createOfferErrors: Error[] = [];
  static setLocalDescriptionErrors: Error[] = [];

  public readonly listeners = new Map<
    string,
    Set<(event: Event & { candidate?: RTCIceCandidateInit | null }) => void>
  >();
  public readonly addedTracks: Array<{ track: MediaStreamTrack; stream: MediaStream }> = [];
  public closed = false;

  constructor(public readonly config?: RTCConfiguration) {
    MockRTCPeerConnection.instances.push(this);
  }

  addEventListener(
    type: string,
    listener: (event: Event & { candidate?: RTCIceCandidateInit | null }) => void,
  ) {
    const typedListeners = this.listeners.get(type) ?? new Set();
    typedListeners.add(listener);
    this.listeners.set(type, typedListeners);
  }

  addTrack(track: MediaStreamTrack, stream: MediaStream) {
    this.addedTracks.push({ track, stream });
  }

  async createOffer() {
    const error = MockRTCPeerConnection.createOfferErrors.shift();
    if (error) {
      throw error;
    }

    return { sdp: `offer-sdp-${MockRTCPeerConnection.instances.length}` };
  }

  async setLocalDescription() {
    const error = MockRTCPeerConnection.setLocalDescriptionErrors.shift();
    if (error) {
      throw error;
    }
  }

  async setRemoteDescription() {}

  async addIceCandidate() {}

  close() {
    this.closed = true;
  }

  emitIceCandidate(candidate: RTCIceCandidateInit | null) {
    for (const listener of this.listeners.get("icecandidate") ?? []) {
      listener({
        candidate,
      } as Event & { candidate?: RTCIceCandidateInit | null });
    }
  }
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

  it("emits host ICE candidates for viewer peers", async () => {
    document.body.innerHTML = `<video id="host" src="https://example.com/host.mp4"></video>`;
    const video = document.getElementById("host") as HTMLVideoElement;
    setVideoRect(video, 640, 360);
    const track = createMockTrack() as unknown as MediaStreamTrack;

    Object.defineProperty(video, "captureStream", {
      configurable: true,
      value: vi.fn(() => ({ getTracks: () => [track] })),
    });

    MockRTCPeerConnection.instances = [];
    const onSignal = vi.fn();
    const runtime = createSourceAttachmentRuntime({
      now: () => 25,
      onSignal,
      onSourceDetached: vi.fn(),
      RTCPeerConnectionImpl: MockRTCPeerConnection as never,
    });

    await runtime.attachSource({
      roomId: "room_123",
      sessionId: "host_1",
      videoId: getVideoHandle(video),
      viewerSessionIds: ["viewer_1"],
      iceServers: [],
    });

    MockRTCPeerConnection.instances[0]?.emitIceCandidate({
      candidate: "candidate:1 1 UDP 1 0.0.0.0 3478 typ host",
      sdpMid: "0",
      sdpMLineIndex: 0,
    });
    await flushPromises();

    expect(onSignal).toHaveBeenCalledWith({
      roomId: "room_123",
      sessionId: "host_1",
      role: "host",
      messageType: "ice-candidate",
      timestamp: 25,
      payload: {
        targetSessionId: "viewer_1",
        candidate: "candidate:1 1 UDP 1 0.0.0.0 3478 typ host",
        sdpMid: "0",
        sdpMLineIndex: 0,
      },
    });
  });

  it("reports source detachment only once per attachment lifecycle", async () => {
    document.body.innerHTML = `<video id="host" src="https://example.com/host.mp4"></video>`;
    const video = document.getElementById("host") as HTMLVideoElement;
    setVideoRect(video, 640, 360);
    const firstTrack = createMockTrack();
    const secondTrack = createMockTrack();

    Object.defineProperty(video, "captureStream", {
      configurable: true,
      value: vi.fn(() => ({
        getTracks: () =>
          [firstTrack, secondTrack] as unknown as MediaStreamTrack[],
      })),
    });

    const onSourceDetached = vi.fn();
    const runtime = createSourceAttachmentRuntime({
      now: () => 10,
      onSignal: vi.fn(),
      onSourceDetached,
      RTCPeerConnectionImpl: MockRTCPeerConnection as never,
    });

    await runtime.attachSource({
      roomId: "room_123",
      sessionId: "host_1",
      videoId: getVideoHandle(video),
      viewerSessionIds: [],
      iceServers: [],
    });

    firstTrack.emit("ended");
    secondTrack.emit("ended");
    runtime.destroy();

    expect(onSourceDetached).toHaveBeenCalledTimes(1);
    expect(onSourceDetached).toHaveBeenCalledWith({
      reason: "track-ended",
      roomId: "room_123",
    });
  });

  it("tears down the previous attachment before reattaching and reoffers viewers", async () => {
    document.body.innerHTML = `
      <video id="first" src="https://example.com/first.mp4"></video>
      <video id="second" src="https://example.com/second.mp4"></video>
    `;
    const firstVideo = document.getElementById("first") as HTMLVideoElement;
    const secondVideo = document.getElementById("second") as HTMLVideoElement;
    setVideoRect(firstVideo, 640, 360);
    setVideoRect(secondVideo, 640, 360);

    const firstTrack = createMockTrack();
    const secondTrack = createMockTrack();

    Object.defineProperty(firstVideo, "captureStream", {
      configurable: true,
      value: vi.fn(() => ({
        getTracks: () => [firstTrack] as unknown as MediaStreamTrack[],
      })),
    });
    Object.defineProperty(secondVideo, "captureStream", {
      configurable: true,
      value: vi.fn(() => ({
        getTracks: () => [secondTrack] as unknown as MediaStreamTrack[],
      })),
    });

    MockRTCPeerConnection.instances = [];
    const onSignal = vi.fn();
    const runtime = createSourceAttachmentRuntime({
      now: () => 50,
      onSignal,
      onSourceDetached: vi.fn(),
      RTCPeerConnectionImpl: MockRTCPeerConnection as never,
    });

    await runtime.attachSource({
      roomId: "room_123",
      sessionId: "host_1",
      videoId: getVideoHandle(firstVideo),
      viewerSessionIds: ["viewer_1"],
      iceServers: [],
    });

    const firstPeer = MockRTCPeerConnection.instances[0];

    await runtime.attachSource({
      roomId: "room_123",
      sessionId: "host_1",
      videoId: getVideoHandle(secondVideo),
      viewerSessionIds: ["viewer_1"],
      iceServers: [],
    });

    expect(firstTrack.stop).toHaveBeenCalledTimes(1);
    expect(firstPeer?.closed).toBe(true);

    const offerSignals = onSignal.mock.calls
      .map(([envelope]) => envelope)
      .filter(
        (envelope) =>
          typeof envelope === "object" &&
          envelope !== null &&
          (envelope as { messageType?: string }).messageType === "offer",
      );

    expect(offerSignals).toHaveLength(2);
    expect(offerSignals.at(-1)).toMatchObject({
      roomId: "room_123",
      sessionId: "host_1",
      role: "host",
      messageType: "offer",
      timestamp: 50,
      payload: {
        targetSessionId: "viewer_1",
        sdp: "offer-sdp-2",
      },
    });
  });

  it("signals negotiation failures and allows retrying the same viewer", async () => {
    document.body.innerHTML = `<video id="host" src="https://example.com/host.mp4"></video>`;
    const video = document.getElementById("host") as HTMLVideoElement;
    setVideoRect(video, 640, 360);
    const track = createMockTrack() as unknown as MediaStreamTrack;

    Object.defineProperty(video, "captureStream", {
      configurable: true,
      value: vi.fn(() => ({ getTracks: () => [track] })),
    });

    MockRTCPeerConnection.instances = [];
    MockRTCPeerConnection.createOfferErrors = [new Error("offer failed")];
    MockRTCPeerConnection.setLocalDescriptionErrors = [];

    const onSignal = vi.fn();
    const runtime = createSourceAttachmentRuntime({
      now: () => 80,
      onSignal,
      onSourceDetached: vi.fn(),
      RTCPeerConnectionImpl: MockRTCPeerConnection as never,
    });

    await expect(
      runtime.attachSource({
        roomId: "room_123",
        sessionId: "host_1",
        videoId: getVideoHandle(video),
        viewerSessionIds: ["viewer_1"],
        iceServers: [],
      }),
    ).resolves.toMatchObject({
      sourceLabel: "https://example.com/host.mp4",
    });

    expect(MockRTCPeerConnection.instances[0]?.closed).toBe(true);
    expect(onSignal).toHaveBeenCalledWith({
      roomId: "room_123",
      sessionId: "host_1",
      role: "host",
      messageType: "negotiation-failed",
      timestamp: 80,
      payload: {
        targetSessionId: "viewer_1",
        code: errorCodes.NEGOTIATION_FAILED,
      },
    });

    await runtime.handleSignal({
      messageType: "viewer-joined",
      sessionId: "viewer_1",
      payload: {
        viewerSessionId: "viewer_1",
      },
    });

    const offerSignals = onSignal.mock.calls
      .map(([envelope]) => envelope)
      .filter(
        (envelope) =>
          typeof envelope === "object" &&
          envelope !== null &&
          (envelope as { messageType?: string }).messageType === "offer",
      );

    expect(offerSignals).toHaveLength(1);
    expect(offerSignals[0]).toMatchObject({
      roomId: "room_123",
      sessionId: "host_1",
      role: "host",
      messageType: "offer",
      timestamp: 80,
      payload: {
        targetSessionId: "viewer_1",
        sdp: "offer-sdp-2",
      },
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
      RTCPeerConnectionImpl: MockRTCPeerConnection as never,
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
