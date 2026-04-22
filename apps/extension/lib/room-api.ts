export type RoomCreateResponse = {
  roomId: string;
  hostSessionId?: string;
  hostToken: string;
  signalingUrl: string;
  iceServers?: RTCIceServer[];
  turnCredentialExpiresAt?: number | null;
};

export type HostIceRefreshResponse = {
  iceServers: RTCIceServer[];
  turnCredentialExpiresAt: number | null;
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

export async function refreshHostIce(
  fetchImpl: typeof fetch,
  apiBaseUrl: string,
  roomId: string,
  hostToken: string,
): Promise<HostIceRefreshResponse> {
  const response = await fetchImpl(`${apiBaseUrl}/rooms/${roomId}/host/ice`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${hostToken}`,
    },
  });

  if (!response.ok) {
    const errorDetails = await readResponseErrorDetails(response);
    throw new Error(
      `Failed to refresh host ICE (${response.status}): ${errorDetails}`,
    );
  }

  const payload = (await response.json()) as HostIceRefreshResponse;

  if (
    !Array.isArray(payload.iceServers) ||
    !("turnCredentialExpiresAt" in payload) ||
    (
      payload.turnCredentialExpiresAt !== null &&
      typeof payload.turnCredentialExpiresAt !== "number"
    )
  ) {
    throw new Error("Host ICE refresh returned an incomplete response.");
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
