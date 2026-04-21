import { signalEnvelopeSchema } from "@screenmate/shared";

export type SignalEnvelope = typeof signalEnvelopeSchema._output;
export type SocketLike = Pick<
  WebSocket,
  "addEventListener" | "close" | "readyState" | "send"
>;
export type CreateWebSocket = (url: string) => SocketLike;

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
    options.onOpen?.();
  });

  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") {
      return;
    }

    let parsedJson: unknown;

    try {
      parsedJson = JSON.parse(event.data);
    } catch {
      return;
    }

    const parsed = signalEnvelopeSchema.safeParse(parsedJson);
    if (parsed.success) {
      options.onMessage(parsed.data);
    }
  });
  socket.addEventListener("close", (event) => {
    options.onClose?.(event);
  });
  socket.addEventListener("error", () => {
    options.onError?.();
  });

  return {
    socket,
    close() {
      socket.close();
    },
    send(message: SignalEnvelope) {
      socket.send(JSON.stringify(message));
    },
  };
}
