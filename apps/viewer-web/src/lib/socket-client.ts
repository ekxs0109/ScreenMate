import { signalEnvelopeSchema } from "@screenmate/shared";
import { createLogger } from "./logger";

export type SignalEnvelope = typeof signalEnvelopeSchema._output;
export type SocketLike = Pick<
  WebSocket,
  "addEventListener" | "close" | "readyState" | "send"
>;
export type CreateWebSocket = (url: string) => SocketLike;

const signalLogger = createLogger("viewer:signal");

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

  socket.addEventListener("open", () => {
    signalLogger.info("Viewer signaling socket opened.", {
      wsUrl: url.toString(),
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
        rawDataPreview: event.data.slice(0, 200),
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
      rawDataPreview: event.data.slice(0, 200),
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
      wsUrl: url.toString(),
    });
    options.onError?.();
  });

  return {
    socket,
    close() {
      signalLogger.info("Closing viewer signaling socket.", {
        wsUrl: url.toString(),
      });
      socket.close();
    },
    send(message: SignalEnvelope) {
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
    },
  };
}
