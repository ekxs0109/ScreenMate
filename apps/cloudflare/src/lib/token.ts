import { tokenPayloadSchema } from "@screenmate/shared";

type ScopedTokenClaims = Omit<
  typeof tokenPayloadSchema._output,
  "exp"
>;

type IssueScopedTokenOptions = {
  now?: number;
  secret: string;
  ttlSeconds?: number;
};

type VerifyScopedTokenOptions = {
  now?: number;
  secret: string;
};

const DEFAULT_TTL_SECONDS = 60 * 5;
const TOKEN_VERSION = "v1";

export async function issueScopedToken(
  claims: ScopedTokenClaims,
  options: IssueScopedTokenOptions,
): Promise<string> {
  const payload = tokenPayloadSchema.parse({
    ...claims,
    exp: (options.now ?? nowInSeconds()) + (options.ttlSeconds ?? DEFAULT_TTL_SECONDS),
  });
  const encodedPayload = encodeText(JSON.stringify(payload));
  const encodedSignature = encodeBytes(
    await signToken(`${TOKEN_VERSION}.${encodedPayload}`, options.secret),
  );

  return `${TOKEN_VERSION}.${encodedPayload}.${encodedSignature}`;
}

export async function verifyScopedToken(
  token: string,
  options: VerifyScopedTokenOptions,
): Promise<typeof tokenPayloadSchema._output | null> {
  const [version, encodedPayload, encodedSignature] = token.split(".");

  if (
    version !== TOKEN_VERSION ||
    !encodedPayload ||
    !encodedSignature
  ) {
    return null;
  }

  const isValid = await verifySignature(
    `${version}.${encodedPayload}`,
    encodedSignature,
    options.secret,
  );

  if (!isValid) {
    return null;
  }

  const parsedPayload = tokenPayloadSchema.safeParse(
    JSON.parse(decodeText(encodedPayload)),
  );

  if (!parsedPayload.success) {
    return null;
  }

  if (parsedPayload.data.exp <= (options.now ?? nowInSeconds())) {
    return null;
  }

  return parsedPayload.data;
}

async function signToken(value: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(value));

  return new Uint8Array(signature);
}

async function verifySignature(
  value: string,
  encodedSignature: string,
  secret: string,
): Promise<boolean> {
  const expectedSignature = await signToken(value, secret);
  const receivedSignature = decodeBytes(encodedSignature);

  if (expectedSignature.length !== receivedSignature.length) {
    return false;
  }

  let mismatch = 0;

  for (let index = 0; index < expectedSignature.length; index += 1) {
    mismatch |= expectedSignature[index] ^ receivedSignature[index];
  }

  return mismatch === 0;
}

function encodeText(value: string): string {
  return encodeBytes(textEncoder.encode(value));
}

function decodeText(value: string): string {
  return textDecoder.decode(decodeBytes(value));
}

function encodeBytes(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBytes(value: string): Uint8Array {
  const normalizedValue = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binaryValue = atob(normalizedValue);

  return Uint8Array.from(binaryValue, (character) => character.charCodeAt(0));
}

function nowInSeconds(): number {
  return Math.floor(Date.now() / 1_000);
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
