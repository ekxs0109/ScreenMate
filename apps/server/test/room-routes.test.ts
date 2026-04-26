import { describe, expect, it } from "vitest";
import app from "../src/index";
import { issueScopedToken, verifyScopedToken } from "../src/lib/token";

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
    expect(body.iceServers).toHaveLength(4);
    expect(body.iceServers[0].urls[0]).toContain("stun:");
    expect(body.iceServers.every((server) => "username" in server)).toBe(false);
  });

  it("returns session-scoped turn credentials from POST /rooms", async () => {
    const roomNamespace = createRoomNamespace(async (roomId, request) => {
      expect(roomId).toMatch(/^room_/);
      expect(new URL(request.url).pathname).toBe("/internal/initialize");
      expect(request.method).toBe("POST");

      const body = (await request.json()) as {
        roomId: string;
        hostSessionId: string;
        createdAt: number;
        expiresAt: number;
        maxExpiresAt: number;
      };

      expect(body.roomId).toBe(roomId);
      expect(body.hostSessionId).toMatch(/^host_/);
      expect(body.createdAt).toBe(TEST_NOW);
      expect(body.expiresAt).toBe(TEST_NOW + 2 * 60 * 60 * 1_000);
      expect(body.maxExpiresAt).toBe(TEST_NOW + 12 * 60 * 60 * 1_000);

      return Response.json({
        roomId,
        state: "degraded",
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
        TURN_AUTH_SECRET: "turn-secret",
        TURN_URLS:
          "turn:turn.screenmate.local:3478?transport=udp,turn:turn.screenmate.local:3478?transport=tcp,turns:turn.screenmate.local:5349?transport=tcp",
        SCREENMATE_NOW: TEST_NOW,
      } as never,
    );
    const body = (await response.json()) as {
      roomId: string;
      hostToken: string;
      signalingUrl: string;
      wsUrl: string;
      iceServers: RTCIceServer[];
      turnCredentialExpiresAt: number;
    };

    expect(response.status).toBe(201);
    expect(body.roomId).toMatch(/^room_/);
    expect(body.hostToken.length).toBeGreaterThan(10);
    expect(body.signalingUrl).toBe(`/rooms/${body.roomId}/ws`);
    expect(body.wsUrl).toBe(`ws://localhost/rooms/${body.roomId}/ws`);
    expect(body.iceServers).toHaveLength(3);
    expect(body.iceServers[2]).toMatchObject({
      urls: [
        "turn:turn.screenmate.local:3478?transport=udp",
        "turn:turn.screenmate.local:3478?transport=tcp",
        "turns:turn.screenmate.local:5349?transport=tcp",
      ],
      username: expect.stringMatching(/^1700000600:room_/),
      credential: expect.any(String),
    });
    expect(body.turnCredentialExpiresAt).toBe(TEST_NOW + 10 * 60 * 1_000);
    expect(roomNamespace.calls).toHaveLength(1);

    const payload = await verifyScopedToken(body.hostToken, {
      secret: TEST_SECRET,
      now: Math.floor(TEST_NOW / 1_000),
    });

    expect(payload?.roomId).toBe(body.roomId);
    expect(payload?.role).toBe("host");
    expect(payload?.sessionId).toMatch(/^host_/);
    expect(payload?.exp).toBe(Math.floor(TEST_NOW / 1_000) + 12 * 60 * 60);
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

  it("allows the viewer app to fetch room state from a different origin", async () => {
    const roomNamespace = createRoomNamespace((roomId) => {
      expect(roomId).toBe("room_demo");

      return Response.json({
        roomId,
        state: "hosting",
        hostConnected: true,
        viewerCount: 2,
      });
    });
    const response = await app.request(
      "/rooms/room_demo",
      {
        headers: {
          Origin: "http://localhost:4173",
        },
      },
      { ROOM_OBJECT: roomNamespace, ROOM_TOKEN_SECRET: TEST_SECRET } as never,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:4173",
    );
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
        TURN_AUTH_SECRET: "turn-secret",
        TURN_URLS:
          "turn:turn.screenmate.local:3478?transport=udp,turn:turn.screenmate.local:3478?transport=tcp,turns:turn.screenmate.local:5349?transport=tcp",
        SCREENMATE_NOW: TEST_NOW,
      } as never,
    );
    const body = (await response.json()) as {
      roomId: string;
      sessionId: string;
      viewerToken: string;
      wsUrl: string;
      iceServers: RTCIceServer[];
      turnCredentialExpiresAt: number;
    };

    expect(response.status).toBe(200);
    expect(body.roomId).toBe("room_demo");
    expect(body.sessionId).toMatch(/^viewer_/);
    expect(body.wsUrl).toBe("ws://localhost/rooms/room_demo/ws");
    expect(body.iceServers).toHaveLength(3);

    const payload = await verifyScopedToken(body.viewerToken, {
      secret: TEST_SECRET,
      now: Math.floor(TEST_NOW / 1_000),
    });

    expect(payload).toEqual({
      roomId: "room_demo",
      role: "viewer",
      sessionId: body.sessionId,
      exp: Math.floor(TEST_NOW / 1_000) + 12 * 60 * 60,
    });
    expect(body.turnCredentialExpiresAt).toBe(TEST_NOW + 10 * 60 * 1_000);
  });

  it("stores host access password through a validated host bearer token", async () => {
    const roomNamespace = createRoomNamespace(async (roomId, request) => {
      expect(roomId).toBe("room_demo");
      const pathname = new URL(request.url).pathname;

      if (pathname === "/internal/state") {
        expect(request.method).toBe("GET");
        return Response.json({
          roomId,
          hostSessionId: "host_123",
          hostConnected: true,
          viewerCount: 0,
          state: "hosting",
          sourceState: "attached",
        });
      }

      expect(pathname).toBe("/internal/access");
      expect(request.method).toBe("PUT");
      const body = (await request.json()) as { passwordHash: string | null };
      expect(body.passwordHash).toMatch(/^pbkdf2-sha256:/);
      expect(body.passwordHash).not.toContain("letmein");

      return Response.json({ roomId, requiresPassword: true });
    });
    const token = await issueScopedToken(
      { roomId: "room_demo", role: "host", sessionId: "host_123" },
      {
        secret: TEST_SECRET,
        now: Math.floor(TEST_NOW / 1_000),
        ttlSeconds: 2 * 60 * 60,
      },
    );

    const response = await app.request(
      "/rooms/room_demo/access",
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ password: "letmein" }),
      },
      {
        ROOM_OBJECT: roomNamespace,
        ROOM_TOKEN_SECRET: TEST_SECRET,
        SCREENMATE_NOW: TEST_NOW,
      } as never,
    );
    const body = (await response.json()) as {
      roomId: string;
      requiresPassword: boolean;
    };

    expect(response.status).toBe(200);
    expect(body).toEqual({ roomId: "room_demo", requiresPassword: true });
    expect(roomNamespace.calls).toHaveLength(2);
  });

  it("clears host access password when the host saves an empty password", async () => {
    const roomNamespace = createRoomNamespace(async (roomId, request) => {
      expect(roomId).toBe("room_demo");
      const pathname = new URL(request.url).pathname;

      if (pathname === "/internal/state") {
        return Response.json({
          roomId,
          hostSessionId: "host_123",
          hostConnected: true,
          viewerCount: 0,
          state: "hosting",
          sourceState: "attached",
        });
      }

      expect(pathname).toBe("/internal/access");
      const body = (await request.json()) as { passwordHash: string | null };
      expect(body.passwordHash).toBeNull();

      return Response.json({ roomId, requiresPassword: false });
    });
    const token = await issueScopedToken(
      { roomId: "room_demo", role: "host", sessionId: "host_123" },
      {
        secret: TEST_SECRET,
        now: Math.floor(TEST_NOW / 1_000),
        ttlSeconds: 2 * 60 * 60,
      },
    );

    const response = await app.request(
      "/rooms/room_demo/access",
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ password: "   " }),
      },
      {
        ROOM_OBJECT: roomNamespace,
        ROOM_TOKEN_SECRET: TEST_SECRET,
        SCREENMATE_NOW: TEST_NOW,
      } as never,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      roomId: "room_demo",
      requiresPassword: false,
    });
  });

  it("rejects room access updates without a valid host bearer token", async () => {
    const roomNamespace = createRoomNamespace(() => {
      throw new Error("unexpected durable object request");
    });

    const missingTokenResponse = await app.request(
      "/rooms/room_demo/access",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "letmein" }),
      },
      {
        ROOM_OBJECT: roomNamespace,
        ROOM_TOKEN_SECRET: TEST_SECRET,
        SCREENMATE_NOW: TEST_NOW,
      } as never,
    );
    const invalidTokenResponse = await app.request(
      "/rooms/room_demo/access",
      {
        method: "PUT",
        headers: {
          Authorization: "Bearer bad-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ password: "letmein" }),
      },
      {
        ROOM_OBJECT: roomNamespace,
        ROOM_TOKEN_SECRET: TEST_SECRET,
        SCREENMATE_NOW: TEST_NOW,
      } as never,
    );

    expect(missingTokenResponse.status).toBe(401);
    expect(invalidTokenResponse.status).toBe(401);
    expect(roomNamespace.calls).toHaveLength(0);
  });

  it("passes viewer passwords to the durable object during join", async () => {
    const roomNamespace = createRoomNamespace(async (roomId, request) => {
      expect(roomId).toBe("room_demo");
      expect(new URL(request.url).pathname).toBe("/internal/join");
      expect(request.method).toBe("POST");

      const body = (await request.json()) as { password: string };
      expect(body.password).toBe("letmein");

      return Response.json({
        roomId,
        state: "hosting",
        hostConnected: true,
        viewerCount: 1,
      });
    });

    const response = await app.request(
      "/rooms/room_demo/join",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "letmein" }),
      },
      {
        ROOM_OBJECT: roomNamespace,
        ROOM_TOKEN_SECRET: TEST_SECRET,
        SCREENMATE_NOW: TEST_NOW,
      } as never,
    );

    expect(response.status).toBe(200);
    expect(roomNamespace.calls).toHaveLength(1);
  });

  it("refreshes host turn credentials when presented with a valid host bearer token", async () => {
    const roomNamespace = createRoomNamespace((roomId, request) => {
      expect(roomId).toBe("room_demo");
      expect(new URL(request.url).pathname).toBe("/internal/state");
      expect(request.method).toBe("GET");

      return Response.json({
        roomId: "room_demo",
        hostSessionId: "host_123",
        hostConnected: true,
        viewerCount: 0,
        state: "hosting",
        sourceState: "attached",
      });
    });
    const token = await issueScopedToken(
      { roomId: "room_demo", role: "host", sessionId: "host_123" },
      {
        secret: TEST_SECRET,
        now: Math.floor(TEST_NOW / 1_000),
        ttlSeconds: 2 * 60 * 60,
      },
    );

    const response = await app.request(
      "/rooms/room_demo/host/ice",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      },
      {
        ROOM_OBJECT: roomNamespace,
        ROOM_TOKEN_SECRET: TEST_SECRET,
        TURN_AUTH_SECRET: "turn-secret",
        TURN_URLS:
          "turn:turn.screenmate.local:3478?transport=udp,turn:turn.screenmate.local:3478?transport=tcp,turns:turn.screenmate.local:5349?transport=tcp",
        SCREENMATE_NOW: TEST_NOW,
      } as never,
    );
    const body = (await response.json()) as {
      iceServers: RTCIceServer[];
      turnCredentialExpiresAt: number;
    };

    expect(response.status).toBe(200);
    expect(roomNamespace.calls).toHaveLength(1);
    expect(body.iceServers[2]).toMatchObject({
      username: "1700000600:room_demo:host_123:host",
    });
    expect(body.turnCredentialExpiresAt).toBe(TEST_NOW + 10 * 60 * 1_000);
  });

  it("rejects host ice refresh when the room is closed", async () => {
    const roomNamespace = createRoomNamespace(() =>
      Response.json({
        roomId: "room_demo",
        hostSessionId: "host_123",
        hostConnected: false,
        viewerCount: 0,
        state: "closed",
        sourceState: "detached",
      }),
    );
    const token = await issueScopedToken(
      { roomId: "room_demo", role: "host", sessionId: "host_123" },
      {
        secret: TEST_SECRET,
        now: Math.floor(TEST_NOW / 1_000),
        ttlSeconds: 2 * 60 * 60,
      },
    );

    const response = await app.request(
      "/rooms/room_demo/host/ice",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      },
      {
        ROOM_OBJECT: roomNamespace,
        ROOM_TOKEN_SECRET: TEST_SECRET,
        TURN_AUTH_SECRET: "turn-secret",
        TURN_URLS:
          "turn:turn.screenmate.local:3478?transport=udp,turn:turn.screenmate.local:3478?transport=tcp,turns:turn.screenmate.local:5349?transport=tcp",
        SCREENMATE_NOW: TEST_NOW,
      } as never,
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(body.error).toBe("ROOM_NOT_FOUND");
    expect(roomNamespace.calls).toHaveLength(1);
  });

  it("rejects host ice refresh when the bearer token host session is stale", async () => {
    const roomNamespace = createRoomNamespace(() =>
      Response.json({
        roomId: "room_demo",
        hostSessionId: "host_current",
        hostConnected: true,
        viewerCount: 0,
        state: "hosting",
        sourceState: "attached",
      }),
    );
    const token = await issueScopedToken(
      { roomId: "room_demo", role: "host", sessionId: "host_stale" },
      {
        secret: TEST_SECRET,
        now: Math.floor(TEST_NOW / 1_000),
        ttlSeconds: 2 * 60 * 60,
      },
    );

    const response = await app.request(
      "/rooms/room_demo/host/ice",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      },
      {
        ROOM_OBJECT: roomNamespace,
        ROOM_TOKEN_SECRET: TEST_SECRET,
        TURN_AUTH_SECRET: "turn-secret",
        TURN_URLS:
          "turn:turn.screenmate.local:3478?transport=udp,turn:turn.screenmate.local:3478?transport=tcp,turns:turn.screenmate.local:5349?transport=tcp",
        SCREENMATE_NOW: TEST_NOW,
      } as never,
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(body.error).toBe("ROOM_NOT_FOUND");
    expect(roomNamespace.calls).toHaveLength(1);
  });

  it("rejects host ice refresh without a valid host bearer token", async () => {
    const roomNamespace = createRoomNamespace(() => {
      throw new Error("unexpected durable object request");
    });

    const missingTokenResponse = await app.request(
      "/rooms/room_demo/host/ice",
      { method: "POST" },
      {
        ROOM_OBJECT: roomNamespace,
        ROOM_TOKEN_SECRET: TEST_SECRET,
        TURN_AUTH_SECRET: "turn-secret",
        TURN_URLS:
          "turn:turn.screenmate.local:3478?transport=udp,turn:turn.screenmate.local:3478?transport=tcp,turns:turn.screenmate.local:5349?transport=tcp",
        SCREENMATE_NOW: TEST_NOW,
      } as never,
    );
    const invalidTokenResponse = await app.request(
      "/rooms/room_demo/host/ice",
      {
        method: "POST",
        headers: { Authorization: "Bearer bad-token" },
      },
      {
        ROOM_OBJECT: roomNamespace,
        ROOM_TOKEN_SECRET: TEST_SECRET,
        TURN_AUTH_SECRET: "turn-secret",
        TURN_URLS:
          "turn:turn.screenmate.local:3478?transport=udp,turn:turn.screenmate.local:3478?transport=tcp,turns:turn.screenmate.local:5349?transport=tcp",
        SCREENMATE_NOW: TEST_NOW,
      } as never,
    );

    expect(missingTokenResponse.status).toBe(401);
    expect(invalidTokenResponse.status).toBe(401);
    expect(roomNamespace.calls).toHaveLength(0);
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
