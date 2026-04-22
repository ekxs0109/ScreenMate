import { describe, expect, it } from "vitest";
import {
  buildSessionIceServers,
  issueTurnCredentials,
} from "../src/lib/turn-credentials";

const TURN_URLS = [
  "turn:turn.screenmate.local:3478?transport=udp",
  "turn:turn.screenmate.local:3478?transport=tcp",
  "turns:turn.screenmate.local:5349?transport=tcp",
];

describe("turn credentials", () => {
  it("issues coturn REST credentials with an embedded expiry timestamp", async () => {
    const issued = await issueTurnCredentials(
      {
        roomId: "room_demo",
        sessionId: "host_demo",
        role: "host",
      },
      {
        now: 1_700_000_000,
        secret: "turn-secret",
        ttlSeconds: 600,
        urls: TURN_URLS,
      },
    );

    expect(issued.username).toBe("1700000600:room_demo:host_demo:host");
    expect(issued.expiresAt).toBe(1_700_000_600_000);
    expect(issued.credential).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it("returns the fixed stun pair plus a turn entry", async () => {
    const ice = await buildSessionIceServers(
      {
        roomId: "room_demo",
        sessionId: "viewer_demo",
        role: "viewer",
      },
      {
        now: 1_700_000_000,
        secret: "turn-secret",
        ttlSeconds: 600,
        urls: TURN_URLS,
      },
    );

    expect(ice.turnCredentialExpiresAt).toBe(1_700_000_600_000);
    expect(ice.iceServers).toEqual([
      { urls: ["stun:stun.miwifi.com:3478"] },
      { urls: ["stun:stun.cloudflare.com:3478"] },
      {
        urls: TURN_URLS,
        username: "1700000600:room_demo:viewer_demo:viewer",
        credential: expect.any(String),
      },
    ]);
  });
});
