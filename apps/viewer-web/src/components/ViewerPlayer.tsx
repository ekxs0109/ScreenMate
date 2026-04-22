import { useEffect, useRef } from "react";
import type { RoomSourceState, RoomState } from "@screenmate/shared";
import type { ViewerStatus } from "../lib/session-state";

export function ViewerPlayer({
  roomId,
  roomState,
  sourceState,
  status,
  stream,
}: {
  roomId: string | null;
  roomState: RoomState | null;
  sourceState: RoomSourceState | null;
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
        {roomState === "closed"
          ? "The host ended the room."
          : sourceState === "recovering"
            ? "Host is reconnecting the video source"
            : sourceState === "missing"
              ? "Waiting for host to attach a video"
              : status === "connected"
                ? "Connected to host stream"
                : `Status: ${status}${roomState ? ` · ${roomState}` : ""}`}
      </div>
      <video autoPlay muted={false} playsInline ref={videoRef} />
    </section>
  );
}
