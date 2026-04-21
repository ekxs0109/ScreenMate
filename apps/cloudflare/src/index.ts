import { Hono } from "hono";
import { nanoid } from "nanoid";
import { getDefaultIcePool } from "./lib/ice-pool";
import { issueScopedToken } from "./lib/token";

const app = new Hono();

app.get("/config/ice", (c) => {
  return c.json({ iceServers: getDefaultIcePool() });
});

app.post("/rooms", (c) => {
  const roomId = `room_${nanoid(8)}`;

  return c.json(
    {
      roomId,
      hostToken: issueScopedToken(roomId, "host"),
      signalingUrl: `/rooms/${roomId}/ws`,
      iceServers: getDefaultIcePool()
    },
    201
  );
});

export default app;
