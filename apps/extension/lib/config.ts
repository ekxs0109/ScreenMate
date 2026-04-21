const DEFAULT_SCREENMATE_API_BASE_URL = "http://localhost:8787";

type ExtensionEnv = {
  WXT_PUBLIC_SCREENMATE_API_BASE_URL?: string;
};

export function getScreenMateApiBaseUrl(
  env: ExtensionEnv = (import.meta as ImportMeta & { env?: ExtensionEnv }).env ?? {},
): string {
  const configuredValue = env.WXT_PUBLIC_SCREENMATE_API_BASE_URL?.trim();
  const baseUrl = configuredValue || DEFAULT_SCREENMATE_API_BASE_URL;

  return baseUrl.replace(/\/+$/, "");
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
