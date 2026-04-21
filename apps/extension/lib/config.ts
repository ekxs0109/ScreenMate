const DEFAULT_SCREENMATE_API_BASE_URL = "http://localhost:8787";
const DEFAULT_SCREENMATE_VIEWER_BASE_URL = "http://localhost:4173";

type ExtensionEnv = {
  WXT_PUBLIC_SCREENMATE_API_BASE_URL?: string;
  WXT_PUBLIC_SCREENMATE_VIEWER_BASE_URL?: string;
};

export function getScreenMateApiBaseUrl(
  env: ExtensionEnv = (import.meta as ImportMeta & { env?: ExtensionEnv }).env ?? {},
): string {
  const baseUrl =
    env.WXT_PUBLIC_SCREENMATE_API_BASE_URL?.trim() ||
    DEFAULT_SCREENMATE_API_BASE_URL;

  return normalizeBaseUrl(baseUrl);
}

export function getScreenMateViewerBaseUrl(
  env: ExtensionEnv = (import.meta as ImportMeta & { env?: ExtensionEnv }).env ?? {},
): string {
  const baseUrl =
    env.WXT_PUBLIC_SCREENMATE_VIEWER_BASE_URL?.trim() ||
    DEFAULT_SCREENMATE_VIEWER_BASE_URL;

  return normalizeBaseUrl(baseUrl);
}

export function buildScreenMateViewerRoomUrl(
  roomId: string,
  viewerBaseUrl = getScreenMateViewerBaseUrl(),
): string {
  const url = new URL(`${normalizeBaseUrl(viewerBaseUrl)}/`);
  const basePath = url.pathname.replace(/\/+$/, "");
  url.pathname = `${basePath}/rooms/${encodeURIComponent(roomId)}`.replace(
    /\/{2,}/g,
    "/",
  );
  url.search = "";
  url.hash = "";

  return url.toString();
}

export function toScreenMateWebSocketUrl(
  signalingUrl: string,
  token: string,
  apiBaseUrl = getScreenMateApiBaseUrl(),
): string {
  const url = new URL(signalingUrl, apiBaseUrl);

  if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else if (url.protocol === "http:") {
    url.protocol = "ws:";
  }

  url.searchParams.set("token", token);
  return url.toString();
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}
