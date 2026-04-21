export type CloudflareBindings = {
  ROOM_OBJECT: DurableObjectNamespace;
  ROOM_TOKEN_SECRET?: string;
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
