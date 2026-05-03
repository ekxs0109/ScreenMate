import { describe, expect, it } from "vitest";
import {
  ROOM_PASSWORD_RULES,
  validateRoomPassword,
} from "../src/room-password";

describe("validateRoomPassword", () => {
  it("allows blank passwords so hosts can clear room access", () => {
    expect(validateRoomPassword("   ")).toEqual({ ok: true, password: "" });
  });

  it("allows 4 to 32 letters, digits, underscores, and hyphens", () => {
    expect(validateRoomPassword(" room_123-OK ")).toEqual({
      ok: true,
      password: "room_123-OK",
    });
    expect(validateRoomPassword("a".repeat(ROOM_PASSWORD_RULES.maxLength))).toEqual({
      ok: true,
      password: "a".repeat(ROOM_PASSWORD_RULES.maxLength),
    });
  });

  it("rejects short, long, or unsupported password formats", () => {
    expect(validateRoomPassword("abc")).toEqual({ ok: false, error: "length" });
    expect(validateRoomPassword("a".repeat(ROOM_PASSWORD_RULES.maxLength + 1))).toEqual({
      ok: false,
      error: "length",
    });
    expect(validateRoomPassword("bad password")).toEqual({
      ok: false,
      error: "format",
    });
    expect(validateRoomPassword("中文密码")).toEqual({
      ok: false,
      error: "format",
    });
  });
});
