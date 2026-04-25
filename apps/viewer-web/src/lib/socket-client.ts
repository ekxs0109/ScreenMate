import { signalEnvelopeSchema } from "@screenmate/shared";
import { createLogger } from "./logger";

export type SignalEnvelope = typeof signalEnvelopeSchema._output;
export type SocketLike = Pick<
  WebSocket,
  "addEventListener" | "close" | "readyState" | "send"
>;
export type CreateWebSocket = (url: string) => SocketLike;

const signalLogger = createLogger("viewer:signal");
const websocketOpenState = 1;

export function createSocketClient(
  wsUrl: string,
  token: string,
  options: {
    onMessage: (message: SignalEnvelope) => void;
    onOpen?: () => void;
    onClose?: (event: CloseEvent | { reason?: string }) => void;
    onError?: () => void;
    createWebSocket?: CreateWebSocket;
  },
) {
  const url = new URL(wsUrl);
  url.searchParams.set("token", token);

  const socket =
    options.createWebSocket?.(url.toString()) ?? new WebSocket(url);
  const redactedWsUrl = redactUrlToken(url.toString());

  socket.addEventListener("open", () => {
    signalLogger.info("Viewer signaling socket opened.", {
      wsUrl: redactedWsUrl,
    });
    options.onOpen?.();
  });

  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") {
      signalLogger.warn("Viewer signaling socket received a non-text payload.", {
        payloadType: typeof event.data,
      });
      return;
    }

    let parsedJson: unknown;

    try {
      parsedJson = JSON.parse(event.data);
    } catch {
      signalLogger.warn("Viewer signaling socket received invalid JSON.", {
        payloadLength: event.data.length,
      });
      return;
    }

    const parsed = signalEnvelopeSchema.safeParse(parsedJson);
    if (parsed.success) {
      signalLogger.debug("Viewer signaling socket received a message.", {
        messageType: parsed.data.messageType,
        roomId: parsed.data.roomId,
        sessionId: parsed.data.sessionId,
      });
      options.onMessage(parsed.data);
      return;
    }

    signalLogger.warn("Viewer signaling socket received an invalid envelope.", {
      payloadLength: event.data.length,
    });
  });
  socket.addEventListener("close", (event) => {
    signalLogger.warn("Viewer signaling socket closed.", {
      code: "code" in event ? event.code : null,
      reason: event.reason ?? null,
    });
    options.onClose?.(event);
  });
  socket.addEventListener("error", () => {
    signalLogger.error("Viewer signaling socket errored.", {
      wsUrl: redactedWsUrl,
    });
    options.onError?.();
  });

  return {
    socket,
    close() {
      signalLogger.info("Closing viewer signaling socket.", {
        wsUrl: redactedWsUrl,
      });
      socket.close();
    },
    send(message: SignalEnvelope) {
      if (socket.readyState !== websocketOpenState) {
        signalLogger.warn("Viewer signaling socket skipped sending while not open.", {
          messageType: message.messageType,
          readyState: socket.readyState,
          roomId: message.roomId,
          sessionId: message.sessionId,
        });
        return false;
      }

      signalLogger.debug("Viewer signaling socket sent a message.", {
        messageType: message.messageType,
        roomId: message.roomId,
        sessionId: message.sessionId,
        targetSessionId:
          "targetSessionId" in message.payload
            ? message.payload.targetSessionId
            : null,
      });
      socket.send(JSON.stringify(message));
      return true;
    },
  };
}

export function redactUrlToken(rawUrl: string) {
  const redactedUrl = new URL(rawUrl);

  if (redactedUrl.searchParams.has("token")) {
    redactedUrl.searchParams.set("token", "[redacted]");
  }

  return redactedUrl.toString();
}
