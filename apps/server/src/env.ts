export type CloudflareBindings = {
  ROOM_OBJECT: DurableObjectNamespace;
  ROOM_TOKEN_SECRET?: string;
  SCREENMATE_NOW?: number;
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
