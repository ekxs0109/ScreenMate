// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { errorCodes } from "@screenmate/shared";
import { createSourceAttachmentRuntime } from "../../entrypoints/content/source-attachment";
import { getVideoHandle } from "../../entrypoints/content/video-detector";

const originalRTCRtpSender = globalThis.RTCRtpSender;

function setVideoRect(element: Element | null, width: number, height: number) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ width, height, top: 0, left: 0, right: width, bottom: height }),
  });
}

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createMockTrack(
  kind = "video",
  settings: MediaTrackSettings = {},
) {
  const listeners = new Map<string, Set<() => void>>();

  return {
    kind,
    getSettings: vi.fn(() => settings),
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

class MockRTCRtpSender {
  public readonly setParameters = vi.fn(async (parameters: RTCRtpSendParameters) => {
    this.parameters = parameters;
  });
  private parameters: RTCRtpSendParameters;

  constructor(
    parameters: RTCRtpSendParameters = {
      encodings: [{}],
    } as RTCRtpSendParameters,
  ) {
    this.parameters = parameters;
  }

  getParameters() {
    return this.parameters;
  }
}

class MockRTCRtpTransceiver {
  public readonly setCodecPreferences = vi.fn();

  constructor(public readonly sender = new MockRTCRtpSender()) {}
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
  public readonly senders: MockRTCRtpSender[] = [];
  public readonly transceivers: MockRTCRtpTransceiver[] = [];
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
    const sender = new MockRTCRtpSender();
    this.senders.push(sender);
    return sender;
  }

  addTransceiver(track: MediaStreamTrack, init: RTCRtpTransceiverInit) {
    this.addedTracks.push({
      track,
      stream: init.streams?.[0] as MediaStream,
    });
    const transceiver = new MockRTCRtpTransceiver();
    this.senders.push(transceiver.sender);
    this.transceivers.push(transceiver);
    return transceiver;
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
  afterEach(() => {
    Object.defineProperty(globalThis, "RTCRtpSender", {
      configurable: true,
      value: originalRTCRtpSender,
    });
  });

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
        addTransceiver() {
          return {
            sender: new MockRTCRtpSender(),
            setCodecPreferences: vi.fn(),
          };
        }
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

  it("configures video senders to preserve high source resolution", async () => {
    document.body.innerHTML = `<video id="host" src="https://example.com/host.mp4"></video>`;
    const video = document.getElementById("host") as HTMLVideoElement;
    setVideoRect(video, 1920, 1080);
    const track = createMockTrack("video", {
      frameRate: 60,
      height: 1080,
      width: 1920,
    }) as unknown as MediaStreamTrack;

    Object.defineProperty(video, "captureStream", {
      configurable: true,
      value: vi.fn(() => ({ getTracks: () => [track] })),
    });

    MockRTCPeerConnection.instances = [];
    const runtime = createSourceAttachmentRuntime({
      now: () => 25,
      onSignal: vi.fn(),
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

    const sender = MockRTCPeerConnection.instances[0]?.senders[0];

    expect(sender?.setParameters).toHaveBeenCalledWith({
      encodings: [
        expect.objectContaining({
          maxBitrate: 8_000_000,
          maxFramerate: 60,
          scaleResolutionDownBy: 1,
        }),
      ],
    });
  });

  it("falls back to source video dimensions when track settings are missing", async () => {
    document.body.innerHTML = `<video id="host" src="https://example.com/host.mp4"></video>`;
    const video = document.getElementById("host") as HTMLVideoElement;
    setVideoRect(video, 1920, 1080);
    Object.defineProperty(video, "videoWidth", {
      configurable: true,
      value: 1920,
    });
    Object.defineProperty(video, "videoHeight", {
      configurable: true,
      value: 1080,
    });
    const track = createMockTrack("video") as unknown as MediaStreamTrack;

    Object.defineProperty(video, "captureStream", {
      configurable: true,
      value: vi.fn(() => ({ getTracks: () => [track] })),
    });

    MockRTCPeerConnection.instances = [];
    const runtime = createSourceAttachmentRuntime({
      now: () => 25,
      onSignal: vi.fn(),
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

    const sender = MockRTCPeerConnection.instances[0]?.senders[0];

    expect(sender?.setParameters).toHaveBeenCalledWith({
      encodings: [
        expect.objectContaining({
          maxBitrate: 8_000_000,
          scaleResolutionDownBy: 1,
        }),
      ],
    });
  });

  it("prefers modern video codecs before creating a host offer", async () => {
    document.body.innerHTML = `<video id="host" src="https://example.com/host.mp4"></video>`;
    const video = document.getElementById("host") as HTMLVideoElement;
    setVideoRect(video, 1920, 1080);
    const track = createMockTrack("video", {
      height: 1080,
      width: 1920,
    }) as unknown as MediaStreamTrack;
    const codecs = [
      { mimeType: "video/H264", clockRate: 90_000 },
      { mimeType: "video/VP8", clockRate: 90_000 },
      { mimeType: "video/AV1", clockRate: 90_000 },
      { mimeType: "video/rtx", clockRate: 90_000 },
      { mimeType: "video/VP9", clockRate: 90_000 },
      { mimeType: "video/H265", clockRate: 90_000 },
    ];
    Object.defineProperty(globalThis, "RTCRtpSender", {
      configurable: true,
      value: {
        getCapabilities: vi.fn(() => ({ codecs, headerExtensions: [] })),
      },
    });

    Object.defineProperty(video, "captureStream", {
      configurable: true,
      value: vi.fn(() => ({ getTracks: () => [track] })),
    });

    MockRTCPeerConnection.instances = [];
    const runtime = createSourceAttachmentRuntime({
      now: () => 25,
      onSignal: vi.fn(),
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

    expect(
      MockRTCPeerConnection.instances[0]?.transceivers[0]?.setCodecPreferences,
    ).toHaveBeenCalledWith([
      codecs[2],
      codecs[4],
      codecs[0],
      codecs[1],
      codecs[3],
      codecs[5],
    ]);
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

  it("removes departed viewer peers and renegotiates when they rejoin", async () => {
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
      now: () => 75,
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

    const firstPeer = MockRTCPeerConnection.instances[0];

    await runtime.handleSignal({
      messageType: "viewer-left",
      sessionId: "viewer_1",
      payload: {
        viewerSessionId: "viewer_1",
      },
    });

    expect(firstPeer?.closed).toBe(true);

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

    expect(MockRTCPeerConnection.instances).toHaveLength(2);
    expect(offerSignals).toHaveLength(2);
    expect(offerSignals.at(-1)).toMatchObject({
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

  it("updates active attachment ICE servers in place for later viewer negotiation", async () => {
    document.body.innerHTML = `<video id="host" src="https://example.com/host.mp4"></video>`;
    const video = document.getElementById("host") as HTMLVideoElement;
    setVideoRect(video, 640, 360);
    const track = createMockTrack() as unknown as MediaStreamTrack;

    Object.defineProperty(video, "captureStream", {
      configurable: true,
      value: vi.fn(() => ({ getTracks: () => [track] })),
    });

    MockRTCPeerConnection.instances = [];
    const runtime = createSourceAttachmentRuntime({
      now: () => 90,
      onSignal: vi.fn(),
      onSourceDetached: vi.fn(),
      RTCPeerConnectionImpl: MockRTCPeerConnection as never,
    });

    await runtime.attachSource({
      roomId: "room_123",
      sessionId: "host_1",
      videoId: getVideoHandle(video),
      viewerSessionIds: ["viewer_1"],
      iceServers: [{ urls: ["turn:old.screenmate.dev"] }],
    });

    runtime.updateIceServers([{ urls: ["turn:new.screenmate.dev"] }]);

    await runtime.handleSignal({
      messageType: "viewer-joined",
      sessionId: "viewer_2",
      payload: {
        viewerSessionId: "viewer_2",
      },
    });

    expect(track.stop).not.toHaveBeenCalled();
    expect(MockRTCPeerConnection.instances).toHaveLength(2);
    expect(MockRTCPeerConnection.instances[0]?.config).toEqual({
      iceServers: [{ urls: ["turn:old.screenmate.dev"] }],
    });
    expect(MockRTCPeerConnection.instances[1]?.config).toEqual({
      iceServers: [{ urls: ["turn:new.screenmate.dev"] }],
    });
  });

  it("keeps existing peer callbacks alive after ICE refresh", async () => {
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
      now: () => 95,
      onSignal,
      onSourceDetached: vi.fn(),
      RTCPeerConnectionImpl: MockRTCPeerConnection as never,
    });

    await runtime.attachSource({
      roomId: "room_123",
      sessionId: "host_1",
      videoId: getVideoHandle(video),
      viewerSessionIds: ["viewer_1"],
      iceServers: [{ urls: ["turn:old.screenmate.dev"] }],
    });

    onSignal.mockClear();
    runtime.updateIceServers([{ urls: ["turn:new.screenmate.dev"] }]);
    MockRTCPeerConnection.instances[0]?.emitIceCandidate({
      candidate: "candidate:2 1 UDP 1 0.0.0.0 3478 typ relay",
      sdpMid: "0",
      sdpMLineIndex: 0,
    });
    await flushPromises();

    expect(onSignal).toHaveBeenCalledWith({
      roomId: "room_123",
      sessionId: "host_1",
      role: "host",
      messageType: "ice-candidate",
      timestamp: 95,
      payload: {
        targetSessionId: "viewer_1",
        candidate: "candidate:2 1 UDP 1 0.0.0.0 3478 typ relay",
        sdpMid: "0",
        sdpMLineIndex: 0,
      },
    });
  });

  it("returns a visible-list fingerprint index when hidden videos exist", async () => {
    window.history.replaceState({}, "", "/video/BV1demo");
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
      pageUrl: "http://localhost:3000/video/BV1demo",
      elementId: "host",
      label: "https://example.com/host.mp4",
      visibleIndex: 0,
    });
  });
});
