import { useCallback, useEffect, useRef, useState } from "react";
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
  const [needsInteraction, setNeedsInteraction] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    video.srcObject = stream;

    if (!stream) {
      setNeedsInteraction(false);
      return;
    }

    // Start muted to guarantee autoplay succeeds (browser policy).
    // Then try to unmute – if the browser blocks it, show a tap-to-unmute overlay.
    video.muted = true;

    const playPromise = video.play().catch(() => {
      // Even muted play failed (very rare) – show interaction prompt.
      setNeedsInteraction(true);
    });

    void Promise.resolve(playPromise).then(() => {
      // Attempt to unmute after muted playback started.
      video.muted = false;

      // Some browsers will pause the video when we unmute without a gesture.
      // Detect this by checking if the video is still playing after a tick.
      requestAnimationFrame(() => {
        if (video.paused && stream) {
          // Unmuting caused a pause – revert to muted playback and prompt user.
          video.muted = true;
          void video.play().catch(() => {});
          setNeedsInteraction(true);
        } else {
          setNeedsInteraction(false);
        }
      });
    });
  }, [stream]);

  const handleInteraction = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    video.muted = false;
    void video.play().then(() => {
      setNeedsInteraction(false);
    }).catch(() => {
      // Fallback: keep it muted but playing.
      video.muted = true;
      void video.play().catch(() => {});
      setNeedsInteraction(false);
    });
  }, []);

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
      <div className="viewer-video-container">
        <video autoPlay playsInline ref={videoRef} />
        {needsInteraction && stream ? (
          <button
            className="viewer-unmute-overlay"
            onClick={handleInteraction}
            type="button"
          >
            🔇 Click to unmute
          </button>
        ) : null}
      </div>
    </section>
  );
}
