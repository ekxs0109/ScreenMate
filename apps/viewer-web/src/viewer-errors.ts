import { errorCodes } from "@screenmate/shared";

export const viewerErrorCodes = {
  ...errorCodes,
  HOST_ENDED_ROOM: "HOST_ENDED_ROOM",
  ROOM_ALREADY_CLOSED: "ROOM_ALREADY_CLOSED",
  ROOM_CONNECTION_CLOSED: "ROOM_CONNECTION_CLOSED",
  ROOM_JOIN_FAILED: "ROOM_JOIN_FAILED",
  ROOM_STATE_FAILED: "ROOM_STATE_FAILED",
  SIGNALING_FAILED: "SIGNALING_FAILED",
} as const;

export type ViewerErrorCode =
  (typeof viewerErrorCodes)[keyof typeof viewerErrorCodes];
