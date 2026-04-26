import { errorCodes } from "@screenmate/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { nanoid } from "nanoid";
import {
  type CloudflareBindings,
  getNow,
  getRoomTokenSecret,
  getTurnAuthSecret,
  getTurnTtlSeconds,
  getTurnUrls,
} from "./env.js";
export { RoomObject } from "./do/room-object.js";
import { getDefaultIcePool } from "./lib/ice-pool.js";
import { hashRoomPassword } from "./lib/room-password.js";
import { buildSessionIceServers } from "./lib/turn-credentials.js";
import { issueScopedToken, verifyScopedToken } from "./lib/token.js";

const app = new Hono<{ Bindings: CloudflareBindings }>();
const ROOM_INITIAL_TTL_MS = 2 * 60 * 60 * 1_000;
const ROOM_MAX_TTL_MS = 12 * 60 * 60 * 1_000;
const ROOM_TOKEN_TTL_SECONDS = ROOM_MAX_TTL_MS / 1_000;

app.use(
  "*",
  cors({
    allowMethods: ["GET", "POST", "PUT", "OPTIONS"],
    origin(origin) {
      return origin || "*";
    },
  }),
);

app.get("/config/ice", (c) => {
  return c.json({ iceServers: getDefaultIcePool() });
});

app.post("/rooms", async (c) => {
  const now = getNow(c.env);
  const roomId = `room_${nanoid(8)}`;
  const hostSessionId = `host_${nanoid(12)}`;
  const hostToken = await issueScopedToken(
    {
      roomId,
      role: "host",
      sessionId: hostSessionId,
    },
    {
      secret: getRoomTokenSecret(c.env),
      now: Math.floor(now / 1_000),
      ttlSeconds: ROOM_TOKEN_TTL_SECONDS,
    },
  );
  const ice = await buildIceResponse(c.env, {
    roomId,
    sessionId: hostSessionId,
    role: "host",
  });
  const roomObject = getRoomObject(c.env, roomId);

  await roomObject.fetch(
    buildInternalRequest("/internal/initialize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        roomId,
        hostSessionId,
        createdAt: now,
        expiresAt: now + ROOM_INITIAL_TTL_MS,
        maxExpiresAt: now + ROOM_MAX_TTL_MS,
      }),
    }),
  );

  return c.json(
    {
      roomId,
      hostSessionId,
      hostToken,
      signalingUrl: `/rooms/${roomId}/ws`,
      wsUrl: buildWebSocketUrl(c.req.url, roomId),
      iceServers: ice.iceServers,
      turnCredentialExpiresAt: ice.turnCredentialExpiresAt,
    },
    201,
  );
});

app.get("/rooms/:roomId", async (c) => {
  const roomObject = getRoomObject(c.env, c.req.param("roomId"));

  return roomObject.fetch(buildInternalRequest("/internal/state"));
});

app.post("/rooms/:roomId/join", async (c) => {
  const roomId = c.req.param("roomId");
  const body = await c.req.json().catch(() => ({})) as { password?: unknown };
  const password = typeof body.password === "string" ? body.password : "";
  const roomObject = getRoomObject(c.env, roomId);
  const joinValidation = await roomObject.fetch(
    buildInternalRequest("/internal/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    }),
  );

  if (!joinValidation.ok) {
    return joinValidation;
  }

  const now = getNow(c.env);
  const viewerSessionId = `viewer_${nanoid(12)}`;
  const viewerToken = await issueScopedToken(
    {
      roomId,
      role: "viewer",
      sessionId: viewerSessionId,
    },
    {
      secret: getRoomTokenSecret(c.env),
      now: Math.floor(now / 1_000),
      ttlSeconds: ROOM_TOKEN_TTL_SECONDS,
    },
  );
  const ice = await buildIceResponse(c.env, {
    roomId,
    sessionId: viewerSessionId,
    role: "viewer",
  });

  return c.json({
    roomId,
    sessionId: viewerSessionId,
    viewerSessionId,
    viewerToken,
    signalingUrl: `/rooms/${roomId}/ws`,
    wsUrl: buildWebSocketUrl(c.req.url, roomId),
    iceServers: ice.iceServers,
    turnCredentialExpiresAt: ice.turnCredentialExpiresAt,
  });
});

app.put("/rooms/:roomId/access", async (c) => {
  const roomId = c.req.param("roomId");
  const authHeader = c.req.header("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const claims = await verifyScopedToken(token, {
    secret: getRoomTokenSecret(c.env),
    now: Math.floor(getNow(c.env) / 1_000),
  });

  if (!claims || claims.roomId !== roomId || claims.role !== "host") {
    return c.json({ error: errorCodes.ROOM_NOT_FOUND }, 401);
  }

  const roomObject = getRoomObject(c.env, roomId);
  const roomStateResponse = await roomObject.fetch(
    buildInternalRequest("/internal/state"),
  );

  if (!roomStateResponse.ok) {
    return c.json({ error: errorCodes.ROOM_NOT_FOUND }, 401);
  }

  const roomState = (await roomStateResponse.json()) as {
    hostSessionId?: unknown;
    state?: unknown;
  };

  if (
    roomState.state === "closed" ||
    roomState.hostSessionId !== claims.sessionId
  ) {
    return c.json({ error: errorCodes.ROOM_NOT_FOUND }, 401);
  }

  const body = await c.req.json().catch(() => ({})) as { password?: unknown };
  const password = typeof body.password === "string" ? body.password.trim() : "";
  const passwordHash = password ? await hashRoomPassword(password) : null;

  return roomObject.fetch(
    buildInternalRequest("/internal/access", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passwordHash }),
    }),
  );
});

app.post("/rooms/:roomId/host/ice", async (c) => {
  const roomId = c.req.param("roomId");
  const authHeader = c.req.header("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const claims = await verifyScopedToken(token, {
    secret: getRoomTokenSecret(c.env),
    now: Math.floor(getNow(c.env) / 1_000),
  });

  if (!claims || claims.roomId !== roomId || claims.role !== "host") {
    return c.json({ error: errorCodes.ROOM_NOT_FOUND }, 401);
  }

  const roomObject = getRoomObject(c.env, roomId);
  const roomStateResponse = await roomObject.fetch(
    buildInternalRequest("/internal/state"),
  );

  if (!roomStateResponse.ok) {
    return c.json({ error: errorCodes.ROOM_NOT_FOUND }, 401);
  }

  const roomState = (await roomStateResponse.json()) as {
    hostSessionId?: unknown;
    state?: unknown;
  };

  if (
    roomState.state === "closed" ||
    roomState.hostSessionId !== claims.sessionId
  ) {
    return c.json({ error: errorCodes.ROOM_NOT_FOUND }, 401);
  }

  const ice = await buildIceResponse(c.env, {
    roomId,
    sessionId: claims.sessionId,
    role: "host",
  });

  return c.json(ice);
});

app.get("/rooms/:roomId/ws", async (c) => {
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
    return c.text("WebSocket upgrade required", 426);
  }

  const roomId = c.req.param("roomId");
  const token = c.req.query("token");

  if (!token) {
    return c.json({ error: errorCodes.ROOM_NOT_FOUND }, 401);
  }

  const claims = await verifyScopedToken(token, {
    secret: getRoomTokenSecret(c.env),
    now: Math.floor(getNow(c.env) / 1_000),
  });

  if (!claims || claims.roomId !== roomId) {
    return c.json({ error: errorCodes.ROOM_NOT_FOUND }, 401);
  }

  const headers = new Headers(c.req.raw.headers);
  headers.set("x-screenmate-room-id", claims.roomId);
  headers.set("x-screenmate-role", claims.role);
  headers.set("x-screenmate-session-id", claims.sessionId);

  const roomObject = getRoomObject(c.env, roomId);

  return roomObject.fetch(
    buildInternalRequest("/internal/ws", {
      method: "GET",
      headers,
    }),
  );
});

export default app;

function getRoomObject(
  env: CloudflareBindings,
  roomId: string,
): DurableObjectStub {
  return env.ROOM_OBJECT.get(env.ROOM_OBJECT.idFromName(roomId));
}

function buildInternalRequest(path: string, init?: RequestInit): Request {
  return new Request(`https://room.internal${path}`, init);
}

function buildWebSocketUrl(requestUrl: string, roomId: string): string {
  const url = new URL(requestUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/rooms/${roomId}/ws`;
  url.search = "";

  return url.toString();
}

async function buildIceResponse(
  env: CloudflareBindings,
  input: { roomId: string; sessionId: string; role: "host" | "viewer" },
) {
  const urls = getTurnUrls(env);

  if (urls.length === 0) {
    return buildSessionIceServers(input, {
      nowSeconds: Math.floor(getNow(env) / 1_000),
      secret: "",
      ttlSeconds: getTurnTtlSeconds(env),
      urls,
    });
  }

  return buildSessionIceServers(input, {
    nowSeconds: Math.floor(getNow(env) / 1_000),
    secret: getTurnAuthSecret(env),
    ttlSeconds: getTurnTtlSeconds(env),
    urls,
  });
}
