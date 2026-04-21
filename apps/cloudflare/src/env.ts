export type CloudflareBindings = {
  ROOM_OBJECT: DurableObjectNamespace;
  ROOM_TOKEN_SECRET?: string;
};

export const DEFAULT_ROOM_TOKEN_SECRET = "screenmate-dev-secret";

export function getRoomTokenSecret(
  bindings?: Partial<CloudflareBindings>,
): string {
  return bindings?.ROOM_TOKEN_SECRET ?? DEFAULT_ROOM_TOKEN_SECRET;
}
