export type RoomCreateResponse = {
  roomId: string;
  hostSessionId?: string;
  hostToken: string;
  signalingUrl: string;
  iceServers?: RTCIceServer[];
};

export async function requestRoomCreation(
  fetchImpl: typeof fetch,
  apiBaseUrl: string,
): Promise<RoomCreateResponse> {
  const response = await fetchImpl(`${apiBaseUrl}/rooms`, {
    method: "POST",
  });

  if (!response.ok) {
    const errorDetails = await readResponseErrorDetails(response);
    throw new Error(`Failed to create room (${response.status}): ${errorDetails}`);
  }

  const payload = (await response.json()) as RoomCreateResponse;

  if (!payload.roomId || !payload.hostToken || !payload.signalingUrl) {
    throw new Error("Room creation returned an incomplete response.");
  }

  return payload;
}

async function readResponseErrorDetails(response: Response): Promise<string> {
  try {
    const text = (await response.text()).trim();
    if (!text) {
      return "No error body returned.";
    }

    try {
      const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
      if (typeof parsed.error === "string") {
        return parsed.error;
      }

      if (typeof parsed.message === "string") {
        return parsed.message;
      }
    } catch {
      // Fall through to the raw response body.
    }

    return text;
  } catch {
    return "Could not read error response body.";
  }
}
