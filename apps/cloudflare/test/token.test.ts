import { describe, expect, it } from "vitest";
import { DEFAULT_ROOM_TOKEN_SECRET } from "../src/env";
import {
  issueScopedToken,
  verifyScopedToken,
} from "../src/lib/token";

describe("scoped room tokens", () => {
  it("issues a verifiable token with room role claims", async () => {
    const token = await issueScopedToken(
      {
        roomId: "room_demo",
        role: "host",
        sessionId: "session_host",
      },
      {
        secret: DEFAULT_ROOM_TOKEN_SECRET,
        now: 1_700_000_000,
        ttlSeconds: 300,
      },
    );

    expect(token.split(".")).toHaveLength(3);

    const payload = await verifyScopedToken(token, {
      secret: DEFAULT_ROOM_TOKEN_SECRET,
      now: 1_700_000_100,
    });

    expect(payload).toEqual({
      roomId: "room_demo",
      role: "host",
      sessionId: "session_host",
      exp: 1_700_000_300,
    });
  });

  it("rejects tampered or expired tokens", async () => {
    const token = await issueScopedToken(
      {
        roomId: "room_demo",
        role: "viewer",
        sessionId: "session_viewer",
      },
      {
        secret: DEFAULT_ROOM_TOKEN_SECRET,
        now: 2_000,
        ttlSeconds: 60,
      },
    );

    const tamperedToken = `${token}x`;

    await expect(
      verifyScopedToken(tamperedToken, {
        secret: DEFAULT_ROOM_TOKEN_SECRET,
        now: 2_030,
      }),
    ).resolves.toBeNull();

    await expect(
      verifyScopedToken(token, {
        secret: DEFAULT_ROOM_TOKEN_SECRET,
        now: 2_100,
      }),
    ).resolves.toBeNull();
  });
});
