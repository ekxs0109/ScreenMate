import { useEffect, useRef } from "react";
import type { ViewerStatus } from "../lib/session-state";

export function ViewerPlayer({
  roomId,
  roomState,
  status,
  stream,
}: {
  roomId: string | null;
  roomState: string | null;
  status: ViewerStatus;
  stream: MediaStream | null;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <section className="viewer-player">
      <div className="viewer-status">
        {roomId ? `Room: ${roomId}` : "Waiting for a room code"}
      </div>
      <div className="viewer-status">
        {status === "connected"
          ? "Connected to host stream"
          : `Status: ${status}${roomState ? ` · ${roomState}` : ""}`}
      </div>
      <video autoPlay muted={false} playsInline ref={videoRef} />
    </section>
  );
}
