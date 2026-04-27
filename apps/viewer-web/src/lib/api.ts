import {
  errorCodes,
  type RoomSourceState,
  type RoomState,
} from "@screenmate/shared";
import { viewerErrorCodes } from "../viewer-errors";

export type JoinRoomResponse = {
  roomId: string;
  sessionId: string;
  viewerSessionId?: string;
  viewerToken: string;
  signalingUrl?: string;
  wsUrl: string;
  iceServers: RTCIceServer[];
};

export type RoomStateResponse = {
  roomId: string;
  hostSessionId: string | null;
  hostConnected: boolean;
  viewerCount: number;
  state: RoomState;
  sourceState: RoomSourceState;
  requiresPassword?: boolean;
};

export type RoomApiError = Error & {
  code: string;
  status: number;
  details?: Record<string, unknown>;
};

export async function joinRoom(
  baseUrl: string,
  roomId: string,
  password = "",
  previousViewerToken?: string | null,
  fetchFn: typeof fetch = fetch,
): Promise<JoinRoomResponse> {
  const response = await fetchFn(new URL(`/rooms/${roomId}/join`, baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      password,
      ...(previousViewerToken ? { previousViewerToken } : {}),
    }),
  });

  if (!response.ok) {
    throw await toRoomApiError(response, "ROOM_JOIN_FAILED");
  }

  return response.json();
}

export async function getRoomState(
  baseUrl: string,
  roomId: string,
  fetchFn: typeof fetch = fetch,
) {
  const response = await fetchFn(new URL(`/rooms/${roomId}`, baseUrl));

  if (!response.ok) {
    throw await toRoomApiError(response, "ROOM_STATE_FAILED");
  }

  return response.json() as Promise<RoomStateResponse>;
}

async function toRoomApiError(
  response: Response,
  fallbackCode: string,
): Promise<RoomApiError> {
  let details: Record<string, unknown> | undefined;

  try {
    details = (await response.json()) as Record<string, unknown>;
  } catch {
    details = undefined;
  }

  const code =
    typeof details?.error === "string" ? details.error : fallbackCode;
  const error = new Error(toErrorMessage(code, details)) as RoomApiError;

  error.code = code;
  error.status = response.status;
  error.details = details;

  return error;
}

function toErrorMessage(
  code: string,
  details?: Record<string, unknown>,
): string {
  if (details?.state === "closed") {
    return viewerErrorCodes.ROOM_ALREADY_CLOSED;
  }

  if (code === errorCodes.ROOM_NOT_FOUND) {
    return errorCodes.ROOM_NOT_FOUND;
  }

  if (code === errorCodes.ROOM_EXPIRED) {
    return errorCodes.ROOM_EXPIRED;
  }

  return code;
}
