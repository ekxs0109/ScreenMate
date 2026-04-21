import { describe, expect, it, vi } from "vitest";

const { getLoggerDouble, resetLoggerDoubles } = vi.hoisted(() => {
  const loggerDoubles = new Map<
    string,
    {
      debug: ReturnType<typeof vi.fn>;
      info: ReturnType<typeof vi.fn>;
      warn: ReturnType<typeof vi.fn>;
      error: ReturnType<typeof vi.fn>;
    }
  >();

  return {
    getLoggerDouble(scope: string) {
      let logger = loggerDoubles.get(scope);
      if (!logger) {
        logger = {
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        };
        loggerDoubles.set(scope, logger);
      }

      return logger;
    },
    resetLoggerDoubles() {
      for (const logger of loggerDoubles.values()) {
        logger.debug.mockReset();
        logger.info.mockReset();
        logger.warn.mockReset();
        logger.error.mockReset();
      }
    },
  };
});

vi.mock("../src/lib/logger", () => ({
  createLogger(scope: string) {
    return getLoggerDouble(scope);
  },
}));

import { ViewerSession } from "../src/viewer-session";

class FakeWebSocket {
  static readonly OPEN = 1;
  readyState = FakeWebSocket.OPEN;
  readonly sentMessages: string[] = [];
  private readonly listeners = {
    open: new Set<() => void>(),
    message: new Set<(event: { data: string }) => void>(),
    close: new Set<(event: { reason?: string; code?: number }) => void>(),
    error: new Set<() => void>(),
  };

  addEventListener(
    type: "open" | "message" | "close" | "error",
    listener:
      | (() => void)
      | ((event: { data: string }) => void)
      | ((event: { reason?: string; code?: number }) => void),
  ) {
    this.listeners[type].add(listener as never);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    for (const listener of this.listeners.close) {
      listener({ reason: "closed", code: 1000 });
    }
  }

  emitOpen() {
    for (const listener of this.listeners.open) {
      listener();
    }
  }
}

class FakePeerConnection {
  connectionState: RTCPeerConnectionState = "new";
  iceConnectionState: RTCIceConnectionState = "new";
  iceGatheringState: RTCIceGatheringState = "new";
  localDescription: { type: string; sdp: string } | null = null;
  remoteDescription: { type: string; sdp: string } | null = null;
  onicecandidate: ((event: { candidate: RTCIceCandidate | null }) => void) | null =
    null;
  ontrack:
    | ((event: { streams: MediaStream[] }) => void)
    | null = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  onicegatheringstatechange: (() => void) | null = null;

  async setRemoteDescription(description: { type: string; sdp: string }) {
    this.remoteDescription = description;
  }

  async createAnswer() {
    return { type: "answer", sdp: "viewer-answer" } as RTCSessionDescriptionInit;
  }

  async setLocalDescription(description: { type?: string; sdp?: string | null }) {
    this.localDescription = {
      type: description.type ?? "answer",
      sdp: description.sdp ?? "",
    };
  }

  async addIceCandidate() {
    return;
  }

  async getStats() {
    return new Map<string, Record<string, unknown>>([
      [
        "local-1",
        {
          id: "local-1",
          type: "local-candidate",
          candidateType: "host",
          protocol: "udp",
          address: "192.168.1.2",
          port: 5000,
        },
      ],
      [
        "remote-1",
        {
          id: "remote-1",
          type: "remote-candidate",
          candidateType: "srflx",
          protocol: "udp",
          address: "203.0.113.8",
          port: 3478,
        },
      ],
      [
        "pair-1",
        {
          id: "pair-1",
          type: "candidate-pair",
          state: "in-progress",
          nominated: false,
          localCandidateId: "local-1",
          remoteCandidateId: "remote-1",
          bytesSent: 1024,
          bytesReceived: 2048,
        },
      ],
    ]) as never;
  }

  close() {
    this.connectionState = "closed";
  }

  fail() {
    this.iceGatheringState = "complete";
    this.iceConnectionState = "failed";
    this.connectionState = "failed";
    this.onicegatheringstatechange?.();
    this.oniceconnectionstatechange?.();
    this.onconnectionstatechange?.();
  }
}

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("viewer WebRTC logging", () => {
  it("logs WebRTC diagnostics when direct peer connectivity fails", async () => {
    resetLoggerDoubles();
    const socket = new FakeWebSocket();
    const peer = new FakePeerConnection();
    const session = new ViewerSession({
      apiBaseUrl: "https://api.example",
      fetchFn: async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();

        if (url.endsWith("/rooms/room_demo") && !init?.method) {
          return Response.json({
            roomId: "room_demo",
            state: "hosting",
            hostConnected: true,
            viewerCount: 0,
            hostSessionId: "host_1",
          });
        }

        return Response.json({
          roomId: "room_demo",
          sessionId: "viewer_1",
          viewerToken: "viewer-token",
          wsUrl: "ws://signal.example/rooms/room_demo/ws",
          iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }],
        });
      },
      createWebSocket: () => socket as never,
      createPeerConnection: () => peer as never,
    });

    await session.join("room_demo");
    socket.emitOpen();

    peer.fail();
    await flushPromises();

    expect(session.getSnapshot()).toMatchObject({
      status: "error",
      error: "Direct peer connectivity failed.",
    });
    expect(getLoggerDouble("viewer:session").error).toHaveBeenCalledWith(
      "Viewer peer connectivity failed.",
      expect.objectContaining({
        roomId: "room_demo",
        sessionId: "viewer_1",
        state: "failed",
      }),
    );
    expect(getLoggerDouble("viewer:peer").error).toHaveBeenCalledWith(
      "Viewer peer connection failed.",
      expect.objectContaining({
        connectionState: "failed",
        iceConnectionState: "failed",
        diagnostics: expect.objectContaining({
          candidatePairStates: [
            expect.objectContaining({
              localCandidate: expect.objectContaining({
                candidateType: "host",
              }),
              remoteCandidate: expect.objectContaining({
                candidateType: "srflx",
              }),
              state: "in-progress",
            }),
          ],
        }),
      }),
    );
  });
});
