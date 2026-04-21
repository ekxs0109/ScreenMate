import { browser } from "wxt/browser";
import { normalizeIceServers } from "@screenmate/webrtc-core";
import {
  errorCodes,
  signalEnvelopeSchema,
  tokenPayloadSchema,
} from "@screenmate/shared";
import {
  getScreenMateApiBaseUrl,
  toScreenMateWebSocketUrl,
} from "../../lib/config";
import { createLogger } from "../../lib/logger";
import {
  requestRoomCreation,
  type RoomCreateResponse,
} from "../../lib/room-api";
import { createHostSessionStore, type HostSnapshot } from "./host-session";
import { createPeerRegistry } from "./peer-manager";
import { captureVideoStream } from "./video-capture";
import {
  collectVisibleVideos,
  findVisibleVideoByHandle,
} from "./video-detector";

type HostSocket = Pick<
  WebSocket,
  "addEventListener" | "removeEventListener" | "send" | "close" | "readyState"
>;

type HostPeerConnection = Pick<
  RTCPeerConnection,
  | "addEventListener"
  | "removeEventListener"
  | "addTrack"
  | "createOffer"
  | "setLocalDescription"
  | "setRemoteDescription"
  | "addIceCandidate"
  | "close"
>;

type HostControllerDependencies = {
  apiBaseUrl?: string;
  createRoomImpl?: (apiBaseUrl: string) => Promise<RoomCreateResponse>;
  fetchImpl?: typeof fetch;
  WebSocketImpl?: new (url: string) => HostSocket;
  RTCPeerConnectionImpl?: new (
    configuration?: RTCConfiguration,
  ) => HostPeerConnection;
  now?: () => number;
};

type ActiveHostRoom = {
  roomId: string;
  sessionId: string;
  socket: HostSocket;
  stream: MediaStream;
  iceServers: RTCIceServer[];
};

const hostLogger = createLogger("host");

export function createHostController(
  dependencies: HostControllerDependencies = {},
) {
  const store = createHostSessionStore();
  const peers = createPeerRegistry<HostPeerConnection>();
  const apiBaseUrl = dependencies.apiBaseUrl ?? getScreenMateApiBaseUrl();
  const createRoomImpl =
    dependencies.createRoomImpl ??
    (dependencies.fetchImpl
      ? ((baseUrl: string) => createRoomWithFetch(dependencies.fetchImpl!, baseUrl))
      : requestRoomCreationFromBackground);
  const WebSocketImpl = dependencies.WebSocketImpl ?? globalThis.WebSocket;
  const RTCPeerConnectionImpl =
    dependencies.RTCPeerConnectionImpl ?? globalThis.RTCPeerConnection;
  const now = dependencies.now ?? Date.now;

  let activeRoom: ActiveHostRoom | null = null;
  let startPromise: Promise<HostSnapshot> | null = null;

  async function start(selectedVideoId?: string): Promise<HostSnapshot> {
    if (startPromise) {
      return startPromise;
    }

    if (activeRoom) {
      return store.getSnapshot();
    }

    startPromise = startInternal(selectedVideoId).finally(() => {
      startPromise = null;
    });

    return startPromise;
  }

  async function startInternal(selectedVideoId?: string): Promise<HostSnapshot> {
    try {
      const video = selectedVideoId
        ? findVisibleVideoByHandle(selectedVideoId)
        : collectVisibleVideos()[0];

      if (!video) {
        throw new Error(errorCodes.NO_VIDEO_FOUND);
      }

      const sourceLabel = video.currentSrc || video.src || "Visible video";
      hostLogger.info("Preparing to share selected video.", {
        selectedVideoId: selectedVideoId ?? null,
        sourceLabel,
        videoCurrentTime: video.currentTime,
        videoReadyState: video.readyState,
      });
      store.beginStarting(sourceLabel);

      const stream = captureVideoStream(video);
      const streamTracks = stream.getTracks();
      hostLogger.info("Captured media stream from selected video.", {
        audioTracks: streamTracks.filter((track) => track.kind === "audio").length,
        trackKinds: streamTracks.map((track) => track.kind),
        totalTracks: streamTracks.length,
        videoTracks: streamTracks.filter((track) => track.kind === "video").length,
      });
      if (streamTracks.length === 0) {
        throw new Error(
          `${errorCodes.CAPTURE_NOT_SUPPORTED}: stream has no tracks`,
        );
      }

      const roomResponse = await createRoomImpl(apiBaseUrl);
      hostLogger.info("Created host room.", {
        iceServerCount: roomResponse.iceServers?.length ?? 0,
        roomId: roomResponse.roomId,
        signalingUrl: roomResponse.signalingUrl,
      });
      const sessionId =
        roomResponse.hostSessionId ??
        decodeHostToken(roomResponse.hostToken)?.sessionId ??
        "host";

      if (!WebSocketImpl || !RTCPeerConnectionImpl) {
        throw new Error("This browser does not support the required realtime APIs.");
      }

      const socket = new WebSocketImpl(
        toScreenMateWebSocketUrl(
          roomResponse.signalingUrl,
          roomResponse.hostToken,
          apiBaseUrl,
        ),
      );
      const room: ActiveHostRoom = {
        roomId: roomResponse.roomId,
        sessionId,
        socket,
        stream,
        iceServers: normalizeIceServers(
          roomResponse.iceServers ?? [],
        ) as RTCIceServer[],
      };

      attachSocketListeners(room);
      hostLogger.info("Connecting signaling socket.", {
        roomId: room.roomId,
        sessionId,
        socketUrl: toScreenMateWebSocketUrl(
          roomResponse.signalingUrl,
          roomResponse.hostToken,
          apiBaseUrl,
        ),
      });
      await waitForSocketOpen(socket);

      activeRoom = room;
      store.setRoom(room.roomId);
      return store.getSnapshot();
    } catch (error) {
      hostLogger.error("Starting share failed.", {
        error: toErrorMessage(error),
      });
      cleanupSession();
      return store.setError(toHostErrorMessage(error));
    }
  }

  async function stop(): Promise<HostSnapshot> {
    if (activeRoom && activeRoom.socket.readyState === WebSocket.OPEN) {
      sendEnvelope("room-closed", {
        reason: "closed",
      });
    }

    cleanupSession();
    return store.reset();
  }

  function destroy() {
    cleanupSession();
    store.reset();
  }

  function getSnapshot() {
    return store.getSnapshot();
  }

  function cleanupSession() {
    peers.closeAll();

    const stream = activeRoom?.stream;
    for (const track of stream?.getTracks() ?? []) {
      track.stop();
    }

    try {
      activeRoom?.socket.close();
    } catch {
      // Ignore teardown failures during invalidation.
    }

    activeRoom = null;
  }

  function attachSocketListeners(room: ActiveHostRoom) {
    room.socket.addEventListener("message", (event) => {
      void handleSocketMessage(room, event);
    });
    room.socket.addEventListener("open", () => {
      hostLogger.info("Signaling socket opened.", {
        roomId: room.roomId,
      });
    });
    room.socket.addEventListener("close", () => {
      hostLogger.warn("Signaling socket closed.", {
        roomId: room.roomId,
      });
      if (!activeRoom || activeRoom.roomId !== room.roomId) {
        return;
      }

      if (store.getSnapshot().status !== "idle") {
        store.setError("Signaling disconnected.", "degraded");
      }
    });
    room.socket.addEventListener("error", () => {
      hostLogger.error("Signaling socket errored.", {
        roomId: room.roomId,
      });
      if (!activeRoom || activeRoom.roomId !== room.roomId) {
        return;
      }

      store.setError("Signaling connection failed.", "degraded");
    });
  }

  async function handleSocketMessage(
    room: ActiveHostRoom,
    event: Event | MessageEvent,
  ) {
    if (!activeRoom || activeRoom.roomId !== room.roomId) {
      return;
    }

    const messageEvent = event as MessageEvent;
    const rawPayload =
      typeof messageEvent.data === "string"
        ? JSON.parse(messageEvent.data)
        : messageEvent.data;
    const parsedEnvelope = signalEnvelopeSchema.safeParse(rawPayload);

    if (!parsedEnvelope.success) {
      store.setError("Received an invalid signaling message.", "degraded");
      return;
    }

    const envelope = parsedEnvelope.data;
    hostLogger.debug("Received signaling message.", {
      messageType: envelope.messageType,
      roomId: envelope.roomId,
      sessionId: envelope.sessionId,
    });
    if (envelope.roomId !== room.roomId) {
      return;
    }

    if (envelope.messageType === "viewer-joined") {
      await beginViewerNegotiation(envelope.payload.viewerSessionId);
      return;
    }

    if (envelope.messageType === "viewer-left") {
      peers.remove(envelope.payload.viewerSessionId);
      store.setViewerCount(peers.size());
      return;
    }

    if (envelope.messageType === "answer") {
      const peer = peers.get(envelope.sessionId);
      if (!peer) {
        return;
      }

      await peer.connection.setRemoteDescription({
        type: "answer",
        sdp: envelope.payload.sdp,
      });
      peers.connected(envelope.sessionId);
      return;
    }

    if (envelope.messageType === "ice-candidate") {
      const peer = peers.get(envelope.sessionId);
      if (!peer) {
        return;
      }

      await peer.connection.addIceCandidate({
        candidate: envelope.payload.candidate,
        sdpMid: envelope.payload.sdpMid ?? null,
        sdpMLineIndex: envelope.payload.sdpMLineIndex ?? null,
      });
      return;
    }

    if (envelope.messageType === "negotiation-failed") {
      peers.failed(envelope.sessionId);
      store.setError(
        `${errorCodes.NEGOTIATION_FAILED}: Viewer negotiation failed.`,
        "degraded",
      );
      return;
    }

    if (envelope.messageType === "room-state") {
      store.setStatus(
        envelope.payload.state === "idle" ? "hosting" : envelope.payload.state,
      );
      return;
    }

    if (envelope.messageType === "room-closed") {
      cleanupSession();
      store.close(`Room closed: ${envelope.payload.reason}.`);
      return;
    }

    if (envelope.messageType === "host-left") {
      cleanupSession();
      store.close(`Host session ended: ${envelope.payload.reason}.`);
    }
  }

  async function beginViewerNegotiation(viewerSessionId: string) {
    if (!activeRoom || peers.get(viewerSessionId)) {
      return;
    }

    try {
      const connection = new RTCPeerConnectionImpl({
        iceServers: activeRoom.iceServers,
      });

      peers.begin(viewerSessionId, connection);

      for (const track of activeRoom.stream.getTracks()) {
        connection.addTrack(track, activeRoom.stream);
      }

      connection.addEventListener("icecandidate", (event) => {
        if (!activeRoom || !event.candidate) {
          return;
        }

        sendEnvelope("ice-candidate", {
          targetSessionId: viewerSessionId,
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid ?? null,
          sdpMLineIndex: event.candidate.sdpMLineIndex ?? null,
        });
      });

      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      sendEnvelope("offer", {
        targetSessionId: viewerSessionId,
        sdp: offer.sdp ?? "",
      });

      store.setViewerCount(peers.size());
    } catch (error) {
      peers.failed(viewerSessionId);
      sendEnvelope("negotiation-failed", {
        targetSessionId: viewerSessionId,
        code: errorCodes.NEGOTIATION_FAILED,
      });
      store.setError(toHostErrorMessage(error), "degraded");
    }
  }

  function sendEnvelope(messageType: string, payload: Record<string, unknown>) {
    if (!activeRoom || activeRoom.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    activeRoom.socket.send(
      JSON.stringify({
        roomId: activeRoom.roomId,
        sessionId: activeRoom.sessionId,
        role: "host",
        messageType,
        timestamp: now(),
        payload,
      }),
    );
  }

  return {
    start,
    stop,
    destroy,
    getSnapshot,
  };
}

async function createRoomWithFetch(
  fetchImpl: typeof fetch,
  apiBaseUrl: string,
): Promise<RoomCreateResponse> {
  hostLogger.info("Requesting room creation from API.", {
    endpoint: `${apiBaseUrl}/rooms`,
    networkContext: "content-fetch",
  });
  try {
    return await requestRoomCreation(fetchImpl, apiBaseUrl);
  } catch (error) {
    hostLogger.error("Room creation request failed.", {
      error: toErrorMessage(error),
      networkContext: "content-fetch",
    });
    throw error;
  }
}

async function requestRoomCreationFromBackground(
  apiBaseUrl: string,
): Promise<RoomCreateResponse> {
  hostLogger.info("Requesting room creation via extension background.", {
    endpoint: `${apiBaseUrl}/rooms`,
    networkContext: "extension-background",
  });

  const response = await browser.runtime.sendMessage({
    type: "screenmate:create-room",
    apiBaseUrl,
  });

  if (
    !response ||
    typeof response !== "object" ||
    typeof (response as RoomCreateResponse).roomId !== "string" ||
    typeof (response as RoomCreateResponse).hostToken !== "string" ||
    typeof (response as RoomCreateResponse).signalingUrl !== "string"
  ) {
    const error =
      typeof (response as { error?: unknown })?.error === "string"
        ? (response as { error: string }).error
        : "Background room creation returned an invalid response.";
    hostLogger.error("Background room creation failed.", {
      error,
      networkContext: "extension-background",
    });
    throw new Error(error);
  }

  return response as RoomCreateResponse;
}

function decodeHostToken(token: string) {
  const encodedPayload = token.split(".")[1];
  if (!encodedPayload) {
    return null;
  }

  try {
    const normalizedPayload = encodedPayload
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(encodedPayload.length / 4) * 4, "=");
    const parsedPayload = tokenPayloadSchema.safeParse(
      JSON.parse(atob(normalizedPayload)),
    );

    return parsedPayload.success ? parsedPayload.data : null;
  } catch {
    return null;
  }
}

function waitForSocketOpen(socket: HostSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const handleOpen = () => {
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("close", handleClose);
      socket.removeEventListener("error", handleError);
      resolve();
    };
    const handleClose = () => {
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("close", handleClose);
      socket.removeEventListener("error", handleError);
      reject(new Error("Signaling socket closed before the room became active."));
    };
    const handleError = () => {
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("close", handleClose);
      socket.removeEventListener("error", handleError);
      reject(new Error("Signaling socket failed to connect."));
    };

    socket.addEventListener("open", handleOpen);
    socket.addEventListener("close", handleClose);
    socket.addEventListener("error", handleError);
  });
}

function toHostErrorMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown error";

  if (message.includes(errorCodes.NO_VIDEO_FOUND)) {
    return `${errorCodes.NO_VIDEO_FOUND}: No visible video was found to share in this tab.`;
  }

  if (message.includes(errorCodes.CAPTURE_NOT_SUPPORTED)) {
    return `${errorCodes.CAPTURE_NOT_SUPPORTED}: This page's video source cannot be captured.`;
  }

  return message;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown error";
}
