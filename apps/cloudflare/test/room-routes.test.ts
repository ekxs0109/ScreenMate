import { describe, expect, it } from "vitest";
import app from "../src/index";
import { verifyScopedToken } from "../src/lib/token";

const TEST_SECRET = "screenmate-dev-secret";

describe("room routes", () => {
  it("returns the ICE pool from GET /config/ice", async () => {
    const response = await app.request("/config/ice");
    const body = (await response.json()) as {
      iceServers: Array<{ urls: string[] }>;
    };

    expect(response.status).toBe(200);
    expect(body.iceServers[0].urls[0]).toContain("stun:");
  });

  it("creates a room token from POST /rooms", async () => {
    const response = await app.request(
      "/rooms",
      { method: "POST" },
      { ROOM_TOKEN_SECRET: TEST_SECRET } as never,
    );
    const body = (await response.json()) as {
      roomId: string;
      hostToken: string;
      signalingUrl: string;
      iceServers: Array<{ urls: string[] }>;
    };

    expect(response.status).toBe(201);
    expect(body.roomId).toMatch(/^room_/);
    expect(body.hostToken.length).toBeGreaterThan(10);
    expect(body.signalingUrl).toBe(`/rooms/${body.roomId}/ws`);
    expect(body.iceServers).toHaveLength(4);

    const payload = await verifyScopedToken(body.hostToken, {
      secret: TEST_SECRET,
    });

    expect(payload?.roomId).toBe(body.roomId);
    expect(payload?.role).toBe("host");
    expect(payload?.sessionId).toMatch(/^host_/);
  });

  it("returns the websocket placeholder response from GET /rooms/:roomId/ws", async () => {
    const response = await app.request("/rooms/room_test/ws");
    const body = await response.text();

    expect(response.status).toBe(426);
    expect(body).toBe("WebSocket upgrade handled in a later step");
  });

  it("requires a token secret for POST /rooms", async () => {
    const response = await app.request("/rooms", { method: "POST" });

    expect(response.status).toBe(500);
  });
});
