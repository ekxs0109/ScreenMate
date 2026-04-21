import { describe, expect, it } from "vitest";
import app from "../src/index";
import { verifyScopedToken } from "../src/lib/token";

const TEST_SECRET = "screenmate-dev-secret";
const TEST_NOW = 1_700_000_000_000;

type DurableObjectCall = {
  roomId: string;
  request: Request;
};

type FakeRoomNamespace = DurableObjectNamespace & {
  calls: DurableObjectCall[];
};

function createRoomNamespace(
  handler: (roomId: string, request: Request) => Response | Promise<Response>,
): FakeRoomNamespace {
  const calls: DurableObjectCall[] = [];

  return {
    calls,
    idFromName(roomId: string) {
      return roomId as never;
    },
    get(id: DurableObjectId) {
      return {
        fetch(request: Request) {
          const roomId = String(id);
          calls.push({ roomId, request });

          return handler(roomId, request);
        },
      } as DurableObjectStub;
    },
  } as unknown as FakeRoomNamespace;
}

describe("room routes", () => {
  it("returns the ICE pool from GET /config/ice", async () => {
    const response = await app.request("/config/ice");
    const body = (await response.json()) as {
      iceServers: Array<{ urls: string[] }>;
    };

    expect(response.status).toBe(200);
    expect(body.iceServers[0].urls[0]).toContain("stun:");
  });

  it("creates a room token from POST /rooms and initializes the durable object", async () => {
    const roomNamespace = createRoomNamespace(async (roomId, request) => {
      expect(roomId).toMatch(/^room_/);
      expect(new URL(request.url).pathname).toBe("/internal/initialize");
      expect(request.method).toBe("POST");

      const body = (await request.json()) as {
        roomId: string;
        hostSessionId: string;
        createdAt: number;
        expiresAt: number;
      };

      expect(body.roomId).toBe(roomId);
      expect(body.hostSessionId).toMatch(/^host_/);
      expect(body.createdAt).toBe(TEST_NOW);
      expect(body.expiresAt).toBe(TEST_NOW + 2 * 60 * 60 * 1_000);

      return Response.json({
        roomId,
        state: "idle",
        hostConnected: false,
        viewerCount: 0,
      });
    });
    const response = await app.request(
      "/rooms",
      { method: "POST" },
      {
        ROOM_OBJECT: roomNamespace,
        ROOM_TOKEN_SECRET: TEST_SECRET,
        SCREENMATE_NOW: TEST_NOW,
      } as never,
    );
    const body = (await response.json()) as {
      roomId: string;
      hostToken: string;
      signalingUrl: string;
      wsUrl: string;
      iceServers: Array<{ urls: string[] }>;
    };

    expect(response.status).toBe(201);
    expect(body.roomId).toMatch(/^room_/);
    expect(body.hostToken.length).toBeGreaterThan(10);
    expect(body.signalingUrl).toBe(`/rooms/${body.roomId}/ws`);
    expect(body.wsUrl).toBe(`ws://localhost/rooms/${body.roomId}/ws`);
    expect(body.iceServers).toHaveLength(4);
    expect(roomNamespace.calls).toHaveLength(1);

    const payload = await verifyScopedToken(body.hostToken, {
      secret: TEST_SECRET,
      now: Math.floor(TEST_NOW / 1_000),
    });

    expect(payload?.roomId).toBe(body.roomId);
    expect(payload?.role).toBe("host");
    expect(payload?.sessionId).toMatch(/^host_/);
  });

  it("returns lightweight room state from GET /rooms/:roomId", async () => {
    const roomNamespace = createRoomNamespace((roomId, request) => {
      expect(roomId).toBe("room_demo");
      expect(new URL(request.url).pathname).toBe("/internal/state");
      expect(request.method).toBe("GET");

      return Response.json({
        roomId,
        state: "hosting",
        hostConnected: true,
        viewerCount: 2,
      });
    });
    const response = await app.request(
      "/rooms/room_demo",
      undefined,
      { ROOM_OBJECT: roomNamespace, ROOM_TOKEN_SECRET: TEST_SECRET } as never,
    );
    const body = (await response.json()) as {
      roomId: string;
      state: string;
      hostConnected: boolean;
      viewerCount: number;
    };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      roomId: "room_demo",
      state: "hosting",
      hostConnected: true,
      viewerCount: 2,
    });
  });

  it("issues a viewer token from POST /rooms/:roomId/join when the room is joinable", async () => {
    const roomNamespace = createRoomNamespace((roomId, request) => {
      expect(roomId).toBe("room_demo");
      expect(new URL(request.url).pathname).toBe("/internal/join");
      expect(request.method).toBe("POST");

      return Response.json({
        roomId,
        state: "hosting",
        hostConnected: true,
        viewerCount: 1,
      });
    });
    const response = await app.request(
      "/rooms/room_demo/join",
      { method: "POST" },
      {
        ROOM_OBJECT: roomNamespace,
        ROOM_TOKEN_SECRET: TEST_SECRET,
        SCREENMATE_NOW: TEST_NOW,
      } as never,
    );
    const body = (await response.json()) as {
      roomId: string;
      sessionId: string;
      viewerToken: string;
      wsUrl: string;
      iceServers: Array<{ urls: string[] }>;
    };

    expect(response.status).toBe(200);
    expect(body.roomId).toBe("room_demo");
    expect(body.sessionId).toMatch(/^viewer_/);
    expect(body.wsUrl).toBe("ws://localhost/rooms/room_demo/ws");
    expect(body.iceServers).toHaveLength(4);

    const payload = await verifyScopedToken(body.viewerToken, {
      secret: TEST_SECRET,
      now: Math.floor(TEST_NOW / 1_000),
    });

    expect(payload).toEqual({
      roomId: "room_demo",
      role: "viewer",
      sessionId: body.sessionId,
      exp: Math.floor(TEST_NOW / 1_000) + 300,
    });
  });

  it("rejects websocket upgrades with an invalid token", async () => {
    const roomNamespace = createRoomNamespace(() => {
      throw new Error("unexpected durable object request");
    });
    const response = await app.request(
      "http://localhost/rooms/room_demo/ws?token=bad-token",
      { headers: { Upgrade: "websocket" } },
      {
        ROOM_OBJECT: roomNamespace,
        ROOM_TOKEN_SECRET: TEST_SECRET,
      } as never,
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(body.error).toBe("ROOM_NOT_FOUND");
    expect(roomNamespace.calls).toHaveLength(0);
  });

  it("proxies validated websocket upgrades into the durable object", async () => {
    const roomNamespace = createRoomNamespace((roomId, request) => {
      expect(roomId).toBe("room_demo");
      expect(new URL(request.url).pathname).toBe("/internal/ws");
      expect(request.method).toBe("GET");
      expect(request.headers.get("upgrade")).toBe("websocket");
      expect(request.headers.get("x-screenmate-room-id")).toBe("room_demo");
      expect(request.headers.get("x-screenmate-role")).toBe("viewer");
      expect(request.headers.get("x-screenmate-session-id")).toBe("viewer_123");

      return new Response(null, { status: 204 });
    });

    const { issueScopedToken } = await import("../src/lib/token");
    const token = await issueScopedToken(
      {
        roomId: "room_demo",
        role: "viewer",
        sessionId: "viewer_123",
      },
      {
        secret: TEST_SECRET,
        now: Math.floor(TEST_NOW / 1_000),
      },
    );
    const response = await app.request(
      `http://localhost/rooms/room_demo/ws?token=${encodeURIComponent(token)}`,
      { headers: { Upgrade: "websocket" } },
      {
        ROOM_OBJECT: roomNamespace,
        ROOM_TOKEN_SECRET: TEST_SECRET,
        SCREENMATE_NOW: TEST_NOW,
      } as never,
    );

    expect(response.status).toBe(204);
    expect(roomNamespace.calls).toHaveLength(1);
  });

  it("requires a token secret for POST /rooms", async () => {
    const response = await app.request("/rooms", { method: "POST" });

    expect(response.status).toBe(500);
  });
});
