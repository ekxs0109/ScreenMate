import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomSourceState, RoomState } from "@screenmate/shared";
import type { ViewerStatus } from "../lib/session-state";
import { Badge } from "@/components/ui/badge";
import { VolumeX } from "lucide-react";

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

    video.muted = true;

    const playPromise = video.play().catch(() => {
      setNeedsInteraction(true);
    });

    void Promise.resolve(playPromise).then(() => {
      video.muted = false;

      requestAnimationFrame(() => {
        if (video.paused && stream) {
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
      video.muted = true;
      void video.play().catch(() => {});
      setNeedsInteraction(false);
    });
  }, []);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm text-slate-500 dark:text-slate-400">
        <div className="flex items-center gap-2">
          <span className="font-medium text-slate-700 dark:text-slate-300">Room:</span>
          <span className="font-mono bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md">{roomId || "Waiting..."}</span>
        </div>
        
        <div className="flex items-center">
          {roomState === "closed" ? (
            <span className="text-red-500 dark:text-red-400">Host ended the room</span>
          ) : sourceState === "recovering" ? (
            <span className="text-amber-500">Host is reconnecting video...</span>
          ) : sourceState === "missing" ? (
            <span>Waiting for video source...</span>
          ) : status === "connected" ? (
            <span className="text-emerald-500 dark:text-emerald-400 flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              Connected to host
            </span>
          ) : (
            <span className="capitalize">{status}{roomState ? ` · ${roomState}` : ""}</span>
          )}
        </div>
      </div>
      
      <div className="relative rounded-xl overflow-hidden bg-slate-900 shadow-inner border border-slate-200 dark:border-slate-800 group">
        <video 
          autoPlay 
          playsInline 
          ref={videoRef} 
          className="w-full aspect-video bg-black object-contain transition-opacity duration-300"
          style={{ opacity: stream ? 1 : 0.5 }}
        />
        
        {!stream && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-slate-400">
              <div className="h-12 w-12 rounded-full bg-slate-800 flex items-center justify-center animate-pulse">
                <span className="block w-2 h-2 rounded-full bg-slate-600"></span>
              </div>
              <p className="text-sm font-medium">Waiting for video stream</p>
            </div>
          </div>
        )}

        {needsInteraction && stream && (
          <button
            className="absolute inset-0 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm text-white transition-colors hover:bg-slate-900/70 cursor-pointer group"
            onClick={handleInteraction}
            type="button"
          >
            <div className="flex flex-col items-center gap-3 bg-slate-800/80 px-6 py-4 rounded-2xl shadow-xl transform transition-transform group-hover:scale-105 border border-slate-700">
              <VolumeX className="h-8 w-8 text-amber-400" />
              <span className="font-semibold text-lg">Click to unmute</span>
            </div>
          </button>
        )}
      </div>
    </section>
  );
}
