type TurnRole = "host" | "viewer";

type TurnCredentialInput = {
  roomId: string;
  sessionId: string;
  role: TurnRole;
};

type TurnCredentialOptions = {
  now: number;
  secret: string;
  ttlSeconds: number;
  urls: string[];
};

const BASE_STUN_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.miwifi.com:3478"] },
  { urls: ["stun:stun.cloudflare.com:3478"] },
];

export async function issueTurnCredentials(
  input: TurnCredentialInput,
  options: TurnCredentialOptions,
) {
  const expiresAtSeconds = options.now + options.ttlSeconds;
  const username =
    `${expiresAtSeconds}:${input.roomId}:${input.sessionId}:${input.role}`;
  const credential = await hmacSha1Base64(username, options.secret);

  return {
    username,
    credential,
    urls: options.urls,
    expiresAt: expiresAtSeconds * 1_000,
  };
}

export async function buildSessionIceServers(
  input: TurnCredentialInput,
  options: TurnCredentialOptions,
) {
  const issued = await issueTurnCredentials(input, options);

  return {
    iceServers: [
      ...BASE_STUN_SERVERS,
      {
        urls: issued.urls,
        username: issued.username,
        credential: issued.credential,
      },
    ] satisfies RTCIceServer[],
    turnCredentialExpiresAt: issued.expiresAt,
  };
}

async function hmacSha1Base64(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );

  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}
