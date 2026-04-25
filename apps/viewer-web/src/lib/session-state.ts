import type { RoomSourceState, RoomState } from "@screenmate/shared";
import type { ViewerErrorCode } from "../viewer-errors";

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
  roomState: RoomState | null;
  sourceState: RoomSourceState | null;
  status: ViewerStatus;
  errorCode: ViewerErrorCode | null;
  endedReasonCode: ViewerErrorCode | null;
  remoteStream: MediaStream | null;
};

export const initialViewerSessionState: ViewerSessionState = {
  roomId: null,
  sessionId: null,
  viewerToken: null,
  hostSessionId: null,
  roomState: null,
  sourceState: null,
  status: "idle",
  errorCode: null,
  endedReasonCode: null,
  remoteStream: null,
};
