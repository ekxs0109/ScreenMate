export type CloudflareBindings = {
  ROOM_OBJECT: DurableObjectNamespace;
  ROOM_TOKEN_SECRET?: string;
  SCREENMATE_NOW?: number;
  TURN_AUTH_SECRET?: string;
  TURN_REALM?: string;
  TURN_URLS?: string;
  TURN_TTL_SECONDS?: number;
};

export function getRoomTokenSecret(
  bindings?: Partial<CloudflareBindings>,
): string {
  const secret = bindings?.ROOM_TOKEN_SECRET;

  if (!secret) {
    throw new Error("ROOM_TOKEN_SECRET binding is required");
  }

  return secret;
}

export function getNow(bindings?: Partial<CloudflareBindings>): number {
  return bindings?.SCREENMATE_NOW ?? Date.now();
}

export function getTurnAuthSecret(
  bindings?: Partial<CloudflareBindings>,
): string {
  const secret = bindings?.TURN_AUTH_SECRET;

  if (!secret) {
    throw new Error("TURN_AUTH_SECRET binding is required");
  }

  return secret;
}

export function getTurnRealm(bindings?: Partial<CloudflareBindings>): string {
  return bindings?.TURN_REALM ?? "screenmate.local";
}

export function getTurnUrls(bindings?: Partial<CloudflareBindings>): string[] {
  const raw = bindings?.TURN_URLS ?? "";

  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function getTurnTtlSeconds(
  bindings?: Partial<CloudflareBindings>,
): number {
  return Number(bindings?.TURN_TTL_SECONDS ?? 600);
}
