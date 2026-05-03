const DEFAULT_VIEWER_API_BASE_URL = "http://127.0.0.1:8787";
const ROOM_ROUTE_PATTERN = /^\/rooms\/([^/]+)$/;

type ViewerEnv = {
  VITE_SCREENMATE_API_BASE_URL?: string;
  VITE_API_BASE_URL?: string;
};

export function getViewerApiBaseUrl(
  env: ViewerEnv = (import.meta as ImportMeta & { env?: ViewerEnv }).env ?? {},
): string {
  const configuredBaseUrl =
    env.VITE_SCREENMATE_API_BASE_URL?.trim() ||
    env.VITE_API_BASE_URL?.trim() ||
    DEFAULT_VIEWER_API_BASE_URL;

  return configuredBaseUrl.replace(/\/+$/, "");
}

export function getViewerRoomIdFromLocation(
  locationLike: Pick<Location, "pathname"> = window.location,
): string | null {
  const match = ROOM_ROUTE_PATTERN.exec(locationLike.pathname);
  if (!match) {
    return null;
  }

  const encodedRoomId = match[1];
  if (!encodedRoomId) {
    return null;
  }

  try {
    return decodeURIComponent(encodedRoomId);
  } catch {
    return encodedRoomId;
  }
}

export function getViewerRoomPasswordFromLocation(
  locationLike: Pick<Location, "search"> = window.location,
): string {
  return new URLSearchParams(locationLike.search).get("password") ?? "";
}
