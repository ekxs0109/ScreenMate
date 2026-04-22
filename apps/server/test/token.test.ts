import { describe, expect, it } from "vitest";
import { getRoomTokenSecret } from "../src/env";
import {
  issueScopedToken,
  verifyScopedToken,
} from "../src/lib/token";

const TEST_SECRET = "screenmate-test-secret";

describe("scoped room tokens", () => {
  it("issues a verifiable token with room role claims", async () => {
    const token = await issueScopedToken(
      {
        roomId: "room_demo",
        role: "host",
        sessionId: "session_host",
      },
      {
        secret: TEST_SECRET,
        now: 1_700_000_000,
        ttlSeconds: 300,
      },
    );

    expect(token.split(".")).toHaveLength(3);

    const payload = await verifyScopedToken(token, {
      secret: TEST_SECRET,
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
        secret: TEST_SECRET,
        now: 2_000,
        ttlSeconds: 60,
      },
    );

    const tamperedToken = `${token}x`;

    await expect(
      verifyScopedToken(tamperedToken, {
        secret: TEST_SECRET,
        now: 2_030,
      }),
    ).resolves.toBeNull();

    await expect(
      verifyScopedToken(token, {
        secret: TEST_SECRET,
        now: 2_100,
      }),
    ).resolves.toBeNull();
  });

  it("returns null for malformed token input", async () => {
    await expect(
      verifyScopedToken("v1.%not-base64%.signature", {
        secret: TEST_SECRET,
      }),
    ).resolves.toBeNull();

    await expect(
      verifyScopedToken("v1.bm90LWpzb24.signature", {
        secret: TEST_SECRET,
      }),
    ).resolves.toBeNull();

    await expect(
      verifyScopedToken("v1.eyJyb29tSWQiOiJyb29tIiwiZXhwIjoxfQ.%bad-signature%", {
        secret: TEST_SECRET,
      }),
    ).resolves.toBeNull();
  });
});

describe("room token secret handling", () => {
  it("requires an explicit runtime secret", () => {
    expect(() => getRoomTokenSecret()).toThrow(
      "ROOM_TOKEN_SECRET binding is required",
    );
  });

  it("reads the runtime secret when provided", () => {
    expect(
      getRoomTokenSecret({ ROOM_TOKEN_SECRET: TEST_SECRET }),
    ).toBe(TEST_SECRET);
  });
});
