import { errorCodes } from "@screenmate/shared";

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
  state: "idle" | "hosting" | "streaming" | "degraded" | "closed";
};

export type RoomApiError = Error & {
  code: string;
  status: number;
  details?: Record<string, unknown>;
};

export async function joinRoom(
  baseUrl: string,
  roomId: string,
  fetchFn: typeof fetch = fetch,
): Promise<JoinRoomResponse> {
  const response = await fetchFn(new URL(`/rooms/${roomId}/join`, baseUrl), {
    method: "POST",
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
  if (code === errorCodes.ROOM_NOT_FOUND) {
    return "That room code is not active.";
  }

  if (code === errorCodes.ROOM_EXPIRED) {
    return "That room has expired.";
  }

  if (details?.state === "closed") {
    return "The host has already ended this room.";
  }

  return "We couldn’t join that room.";
}
