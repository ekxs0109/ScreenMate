// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { errorCodes } from "@screenmate/shared";
import { createHostController } from "../entrypoints/content/host-controller";
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

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  public readonly sent: string[] = [];
  public readonly listeners = new Map<string, Set<(event: Event | MessageEvent) => void>>();
  public readyState = 0;

  constructor(public readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: Event | MessageEvent) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: Event | MessageEvent) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.emit("close", new Event("close"));
  }

  open() {
    this.readyState = 1;
    this.emit("open", new Event("open"));
  }

  receive(payload: unknown) {
    this.emit(
      "message",
      new MessageEvent("message", { data: JSON.stringify(payload) }),
    );
  }

  private emit(type: string, event: Event | MessageEvent) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

class MockRTCPeerConnection {
  static instances: MockRTCPeerConnection[] = [];

  public readonly listeners = new Map<string, Set<(event: Event & { candidate?: RTCIceCandidateInit | null }) => void>>();
  public localDescription: RTCSessionDescriptionInit | null = null;
  public remoteDescription: RTCSessionDescriptionInit | null = null;
  public readonly addedTracks: Array<{ track: MediaStreamTrack; stream: MediaStream }> = [];
  public closed = false;

  constructor(public readonly config: RTCConfiguration) {
    MockRTCPeerConnection.instances.push(this);
  }

  addEventListener(
    type: string,
    listener: (event: Event & { candidate?: RTCIceCandidateInit | null }) => void,
  ) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(
    type: string,
    listener: (event: Event & { candidate?: RTCIceCandidateInit | null }) => void,
  ) {
    this.listeners.get(type)?.delete(listener);
  }

  addTrack(track: MediaStreamTrack, stream: MediaStream) {
    this.addedTracks.push({ track, stream });
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: "offer", sdp: "offer-sdp" };
  }

  async setLocalDescription(description: RTCSessionDescriptionInit) {
    this.localDescription = description;
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    this.remoteDescription = description;
  }

  async addIceCandidate() {
    return undefined;
  }

  close() {
    this.closed = true;
  }
}

describe("createHostController", () => {
  it("creates a room from the selected visible video and exposes the real room code", async () => {
    document.body.innerHTML = `
      <video id="small" src="https://example.com/small.mp4"></video>
      <video id="large" src="https://example.com/large.mp4"></video>
    `;

    const small = document.getElementById("small") as HTMLVideoElement;
    const large = document.getElementById("large") as HTMLVideoElement;
    setVideoRect(small, 200, 100);
    setVideoRect(large, 500, 300);

    const track = { stop: vi.fn(), kind: "video" } as unknown as MediaStreamTrack;
    const stream = { getTracks: () => [track] } as unknown as MediaStream;
    const smallCapture = vi.fn(() => stream);
    const largeCapture = vi.fn(() => stream);
    Object.defineProperty(small, "captureStream", { configurable: true, value: smallCapture });
    Object.defineProperty(large, "captureStream", { configurable: true, value: largeCapture });
    const selectedVideoId = getVideoHandle(small);

    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        roomId: "room_123",
        hostToken: "host-token",
        signalingUrl: "/rooms/room_123/ws",
        iceServers: [{ urls: ["stun:stun.screenmate.dev"] }],
      }),
    });

    const controller = createHostController({
      apiBaseUrl: "https://api.screenmate.dev",
      fetchImpl,
      WebSocketImpl: MockWebSocket as never,
      RTCPeerConnectionImpl: MockRTCPeerConnection as never,
      now: () => 123,
    });

    const startPromise = controller.start(selectedVideoId);
    await flushPromises();
    const socket = MockWebSocket.instances.at(-1)!;
    socket.open();

    const snapshot = await startPromise;

    expect(snapshot).toEqual({
      status: "hosting",
      roomId: "room_123",
      viewerCount: 0,
      errorMessage: null,
      sourceLabel: "https://example.com/small.mp4",
    });
    expect(fetchImpl).toHaveBeenCalledWith("https://api.screenmate.dev/rooms", {
      method: "POST",
    });
    expect(socket.url).toBe("wss://api.screenmate.dev/rooms/room_123/ws?token=host-token");
    expect(smallCapture).toHaveBeenCalledTimes(1);
    expect(largeCapture).not.toHaveBeenCalled();
  });

  it("creates a viewer peer and sends an offer when a viewer joins", async () => {
    document.body.innerHTML = `<video id="host" src="https://example.com/host.mp4"></video>`;

    const video = document.getElementById("host") as HTMLVideoElement;
    setVideoRect(video, 640, 360);

    const track = { stop: vi.fn(), kind: "video" } as unknown as MediaStreamTrack;
    const stream = { getTracks: () => [track] } as unknown as MediaStream;
    Object.defineProperty(video, "captureStream", {
      configurable: true,
      value: vi.fn(() => stream),
    });
    const selectedVideoId = getVideoHandle(video);

    const controller = createHostController({
      apiBaseUrl: "https://api.screenmate.dev",
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          roomId: "room_123",
          hostToken: "host-token",
          signalingUrl: "/rooms/room_123/ws",
          iceServers: [{ urls: ["stun:stun.screenmate.dev"] }],
        }),
      }),
      WebSocketImpl: MockWebSocket as never,
      RTCPeerConnectionImpl: MockRTCPeerConnection as never,
      now: () => 456,
    });

    const startPromise = controller.start(selectedVideoId);
    await flushPromises();
    const socket = MockWebSocket.instances.at(-1)!;
    socket.open();
    await startPromise;

    socket.receive({
      roomId: "room_123",
      sessionId: "viewer_1",
      role: "viewer",
      messageType: "viewer-joined",
      timestamp: 999,
      payload: { viewerSessionId: "viewer_1" },
    });

    await flushPromises();

    expect(controller.getSnapshot().viewerCount).toBe(1);
    expect(controller.getSnapshot().status).toBe("streaming");
    expect(MockRTCPeerConnection.instances.length).toBeGreaterThanOrEqual(1);
    expect(MockRTCPeerConnection.instances.at(-1)?.addedTracks).toHaveLength(1);

    const offerMessage = JSON.parse(socket.sent[0] ?? "{}") as {
      messageType?: string;
      payload?: { targetSessionId?: string; sdp?: string };
    };

    expect(offerMessage.messageType).toBe("offer");
    expect(offerMessage.payload?.targetSessionId).toBe("viewer_1");
    expect(offerMessage.payload?.sdp).toBe("offer-sdp");
  });

  it("surfaces an explicit error when no visible video can be captured", async () => {
    document.body.innerHTML = `<div>No videos here</div>`;

    const controller = createHostController({
      apiBaseUrl: "https://api.screenmate.dev",
      fetchImpl: vi.fn(),
      WebSocketImpl: MockWebSocket as never,
      RTCPeerConnectionImpl: MockRTCPeerConnection as never,
      now: () => 789,
    });

    const snapshot = await controller.start();

    expect(snapshot.status).toBe("idle");
    expect(snapshot.roomId).toBeNull();
    expect(snapshot.errorMessage).toContain(errorCodes.NO_VIDEO_FOUND);
  });

  it("surfaces an explicit error when the selected video is no longer available", async () => {
    document.body.innerHTML = `<video id="host" src="https://example.com/host.mp4"></video>`;

    const video = document.getElementById("host") as HTMLVideoElement;
    setVideoRect(video, 640, 360);
    const selectedVideoId = getVideoHandle(video);
    video.remove();

    const controller = createHostController({
      apiBaseUrl: "https://api.screenmate.dev",
      fetchImpl: vi.fn(),
      WebSocketImpl: MockWebSocket as never,
      RTCPeerConnectionImpl: MockRTCPeerConnection as never,
      now: () => 999,
    });

    const snapshot = await controller.start(selectedVideoId);

    expect(snapshot.status).toBe("idle");
    expect(snapshot.errorMessage).toContain(errorCodes.NO_VIDEO_FOUND);
  });
});
