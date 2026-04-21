import { Hono } from "hono";
import { nanoid } from "nanoid";
import {
  type CloudflareBindings,
  getRoomTokenSecret,
} from "./env.js";
import { getDefaultIcePool } from "./lib/ice-pool.js";
import { issueScopedToken } from "./lib/token.js";

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.get("/config/ice", (c) => {
  return c.json({ iceServers: getDefaultIcePool() });
});

app.post("/rooms", async (c) => {
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
    },
  );

  return c.json(
    {
      roomId,
      hostToken,
      signalingUrl: `/rooms/${roomId}/ws`,
      iceServers: getDefaultIcePool()
    },
    201
  );
});

export default app;
