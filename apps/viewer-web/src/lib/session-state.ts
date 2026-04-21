export type ViewerStatus =
  | "idle"
  | "joining"
  | "waiting"
  | "connecting"
  | "connected"
  | "ended"
  | "error";

export type ViewerSessionState = {
  roomId: string | null;
  sessionId: string | null;
  viewerToken: string | null;
  hostSessionId: string | null;
  roomState: "idle" | "hosting" | "streaming" | "degraded" | "closed" | null;
  status: ViewerStatus;
  error: string | null;
  endedReason: string | null;
  remoteStream: MediaStream | null;
};

export const initialViewerSessionState: ViewerSessionState = {
  roomId: null,
  sessionId: null,
  viewerToken: null,
  hostSessionId: null,
  roomState: null,
  status: "idle",
  error: null,
  endedReason: null,
  remoteStream: null,
};
