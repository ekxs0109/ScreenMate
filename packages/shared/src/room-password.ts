export const ROOM_PASSWORD_RULES = {
  maxLength: 32,
  minLength: 4,
  pattern: /^[A-Za-z0-9_-]+$/,
} as const;

export type RoomPasswordValidationResult =
  | { ok: true; password: string }
  | { ok: false; error: "format" | "length" };

export function normalizeRoomPassword(password: string): string {
  return password.trim();
}

export function validateRoomPassword(
  password: string,
): RoomPasswordValidationResult {
  const normalized = normalizeRoomPassword(password);
  if (normalized.length === 0) {
    return { ok: true, password: "" };
  }

  if (
    normalized.length < ROOM_PASSWORD_RULES.minLength ||
    normalized.length > ROOM_PASSWORD_RULES.maxLength
  ) {
    return { ok: false, error: "length" };
  }

  if (!ROOM_PASSWORD_RULES.pattern.test(normalized)) {
    return { ok: false, error: "format" };
  }

  return { ok: true, password: normalized };
}
