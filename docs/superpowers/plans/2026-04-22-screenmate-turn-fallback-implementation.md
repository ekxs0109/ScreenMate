# ScreenMate TURN Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure `coturn`-backed TURN fallback, host-driven room renewal, and local Docker TURN debugging without changing the existing room/signaling product flow.

**Architecture:** Keep the current Worker + Durable Object signaling model and the current “backend returns `iceServers`, clients treat it as opaque config” contract. Add a session-scoped TURN credential issuer on the server, persist room expiry as mutable Durable Object state renewed by host heartbeats, and teach the extension host runtime to heartbeat and refresh cached TURN credentials before negotiating late-joining viewers.

**Tech Stack:** Cloudflare Workers + Durable Objects, TypeScript, Vitest, WXT browser extension, Docker `coturn`, native WebRTC

---

## File Structure

- Modify: `apps/server/src/env.ts`
  - Add getters for TURN secrets, TURN URLs, TURN realm, TURN TTL, renewal window, and room max lifetime.
- Create: `apps/server/src/lib/turn-credentials.ts`
  - Own fixed STUN entries, `coturn` REST credential generation, and session-scoped ICE payload assembly.
- Modify: `apps/server/src/index.ts`
  - Return TURN-enabled ICE in `POST /rooms`, `POST /rooms/:roomId/join`, and a new authenticated host ICE refresh route.
- Modify: `apps/server/src/do/room-object.ts`
  - Persist mutable expiry fields and renew rooms on host heartbeats up to a hard maximum.
- Create: `apps/server/test/turn-credentials.test.ts`
  - Unit-test TURN credential generation and ICE pool assembly.
- Modify: `apps/server/test/room-routes.test.ts`
  - Cover TURN-enabled responses, long-lived host token issuance for refresh, and host ICE refresh authorization.
- Modify: `apps/server/test/room-object.test.ts`
  - Cover heartbeat-driven room renewal and viewer heartbeats not extending rooms.
- Modify: `apps/extension/lib/room-api.ts`
  - Add a typed host ICE refresh API helper and persist TURN expiry metadata from room creation.
- Modify: `apps/extension/entrypoints/background/host-room-snapshot.ts`
  - Persist `turnCredentialExpiresAt` in the host room session state.
- Modify: `apps/extension/entrypoints/background/host-room-runtime.ts`
  - Start/stop heartbeat timers with the signaling socket, update stored ICE servers after refresh, and expose a “needs refresh” check.
- Modify: `apps/extension/entrypoints/background.ts`
  - Refresh host ICE when a late viewer arrives and the active TURN lease is near expiry.
- Modify: `apps/extension/entrypoints/content.ts`
  - Add a content-control message that updates the active attachment’s ICE servers without tearing down the stream.
- Modify: `apps/extension/entrypoints/content/source-attachment.ts`
  - Replace cached `attachment.iceServers` on demand before negotiating a new viewer.
- Modify: `apps/extension/test/host-room-runtime.test.ts`
  - Cover heartbeat scheduling and ICE refresh state updates.
- Modify: `apps/extension/test/background.test.ts`
  - Cover “viewer joined after TURN expiry” triggering a host ICE refresh before forwarding the signal.
- Modify: `apps/extension/test/source-attachment.test.ts`
  - Cover in-place ICE server replacement for the active attachment.
- Create: `docker/coturn/turnserver.local.conf`
  - Local `coturn` shared-secret config with a narrow relay port range.
- Create: `docker-compose.turn.yml`
  - One-command local TURN startup for development and manual testing.
- Modify: `README.md`
  - Document TURN env vars and local Docker TURN startup.
- Modify: `docs/testing/manual-room-streaming-checklist.md`
  - Add TURN/relay verification steps.

## Assumptions Locked In

- Keep the STUN pool fixed to:
  - `stun:stun.miwifi.com:3478`
  - `stun:stun.cloudflare.com:3478`
- Use `coturn` shared-secret REST credentials, not static usernames/passwords.
- Add one authenticated host ICE refresh route because a 10-minute TURN lease is shorter than the room lifetime.
- Extend `hostToken` and `viewerToken` HTTP auth lifetime to the room window so host refresh remains possible without inventing a second token system in this branch.
- Keep `iceTransportPolicy` at browser default `"all"`.

### Task 1: TURN Config And Credential Helper

**Files:**
- Create: `apps/server/src/lib/turn-credentials.ts`
- Modify: `apps/server/src/env.ts`
- Test: `apps/server/test/turn-credentials.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @screenmate/cloudflare test -- test/turn-credentials.test.ts`

Expected: FAIL with `Cannot find module '../src/lib/turn-credentials'` and missing export errors.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/server/src/lib/turn-credentials.ts
type TurnRole = "host" | "viewer";

type TurnCredentialInput = {
  roomId: string;
  sessionId: string;
  role: TurnRole;
};

type TurnCredentialOptions = {
  now: number;
  secret: string;
  ttlSeconds: number;
  urls: string[];
};

const BASE_STUN_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.miwifi.com:3478"] },
  { urls: ["stun:stun.cloudflare.com:3478"] },
];

export async function issueTurnCredentials(
  input: TurnCredentialInput,
  options: TurnCredentialOptions,
) {
  const expiresAtSeconds = options.now + options.ttlSeconds;
  const username =
    `${expiresAtSeconds}:${input.roomId}:${input.sessionId}:${input.role}`;
  const credential = await hmacSha1Base64(username, options.secret);

  return {
    username,
    credential,
    urls: options.urls,
    expiresAt: expiresAtSeconds * 1_000,
  };
}

export async function buildSessionIceServers(
  input: TurnCredentialInput,
  options: TurnCredentialOptions,
) {
  const issued = await issueTurnCredentials(input, options);

  return {
    iceServers: [
      ...BASE_STUN_SERVERS,
      {
        urls: issued.urls,
        username: issued.username,
        credential: issued.credential,
      },
    ] satisfies RTCIceServer[],
    turnCredentialExpiresAt: issued.expiresAt,
  };
}

async function hmacSha1Base64(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );

  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}
```

```ts
// apps/server/src/env.ts
export function getTurnAuthSecret(bindings?: Partial<CloudflareBindings>): string {
  const secret = bindings?.TURN_AUTH_SECRET;
  if (!secret) {
    throw new Error("TURN_AUTH_SECRET binding is required");
  }
  return secret;
}

export function getTurnRealm(bindings?: Partial<CloudflareBindings>): string {
  return bindings?.TURN_REALM ?? "screenmate.local";
}

export function getTurnUrls(bindings?: Partial<CloudflareBindings>): string[] {
  const raw = bindings?.TURN_URLS ?? "";
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function getTurnTtlSeconds(bindings?: Partial<CloudflareBindings>): number {
  return Number(bindings?.TURN_TTL_SECONDS ?? 600);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @screenmate/cloudflare test -- test/turn-credentials.test.ts`

Expected: PASS with `2 passed`.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/env.ts apps/server/src/lib/turn-credentials.ts apps/server/test/turn-credentials.test.ts
git commit -m "feat(server): add coturn credential generator"
```

### Task 2: Return TURN ICE From Routes And Add Host ICE Refresh

**Files:**
- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/src/env.ts`
- Modify: `apps/server/test/room-routes.test.ts`
- Modify: `apps/extension/lib/room-api.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/server/test/room-routes.test.ts
it("returns session-scoped turn credentials from POST /rooms", async () => {
  const roomNamespace = createRoomNamespace(() => Response.json({ ok: true }));
  const response = await app.request(
    "/rooms",
    { method: "POST" },
    {
      ROOM_OBJECT: roomNamespace,
      ROOM_TOKEN_SECRET: TEST_SECRET,
      TURN_AUTH_SECRET: "turn-secret",
      TURN_URLS: "turn:turn.screenmate.local:3478?transport=udp,turn:turn.screenmate.local:3478?transport=tcp,turns:turn.screenmate.local:5349?transport=tcp",
      SCREENMATE_NOW: TEST_NOW,
    } as never,
  );
  const body = await response.json() as {
    hostToken: string;
    iceServers: RTCIceServer[];
    turnCredentialExpiresAt: number;
  };

  expect(response.status).toBe(201);
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

  const payload = await verifyScopedToken(body.hostToken, {
    secret: TEST_SECRET,
    now: Math.floor(TEST_NOW / 1_000) + 60 * 60,
  });
  expect(payload?.role).toBe("host");
});

it("refreshes host turn credentials when presented with a valid host bearer token", async () => {
  const roomNamespace = createRoomNamespace(() => Response.json({
    roomId: "room_demo",
    hostSessionId: "host_123",
    hostConnected: true,
    viewerCount: 0,
    state: "hosting",
    sourceState: "attached",
  }));
  const token = await issueScopedToken(
    { roomId: "room_demo", role: "host", sessionId: "host_123" },
    { secret: TEST_SECRET, now: Math.floor(TEST_NOW / 1_000), ttlSeconds: 2 * 60 * 60 },
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
      TURN_URLS: "turn:turn.screenmate.local:3478?transport=udp,turn:turn.screenmate.local:3478?transport=tcp,turns:turn.screenmate.local:5349?transport=tcp",
      SCREENMATE_NOW: TEST_NOW,
    } as never,
  );
  const body = await response.json() as {
    iceServers: RTCIceServer[];
    turnCredentialExpiresAt: number;
  };

  expect(response.status).toBe(200);
  expect(body.iceServers[2]).toMatchObject({
    username: "1700000600:room_demo:host_123:host",
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @screenmate/cloudflare test -- test/room-routes.test.ts`

Expected: FAIL because responses still return four STUN-only servers and `/rooms/:roomId/host/ice` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/server/src/index.ts
import {
  buildSessionIceServers,
} from "./lib/turn-credentials.js";
import {
  getTurnAuthSecret,
  getTurnTtlSeconds,
  getTurnUrls,
} from "./env.js";

const ROOM_INITIAL_TTL_MS = 2 * 60 * 60 * 1_000;
const ROOM_MAX_TTL_MS = 12 * 60 * 60 * 1_000;
const ROOM_TOKEN_TTL_SECONDS = ROOM_MAX_TTL_MS / 1_000;

async function buildIceResponse(
  env: CloudflareBindings,
  input: { roomId: string; sessionId: string; role: "host" | "viewer" },
) {
  return buildSessionIceServers(input, {
    now: Math.floor(getNow(env) / 1_000),
    secret: getTurnAuthSecret(env),
    ttlSeconds: getTurnTtlSeconds(env),
    urls: getTurnUrls(env),
  });
}

app.post("/rooms", async (c) => {
  const now = getNow(c.env);
  const roomId = `room_${nanoid(8)}`;
  const hostSessionId = `host_${nanoid(12)}`;
  const hostToken = await issueScopedToken(
    { roomId, role: "host", sessionId: hostSessionId },
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

  await roomObject.fetch(buildInternalRequest("/internal/initialize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      roomId,
      hostSessionId,
      createdAt: now,
      expiresAt: now + ROOM_INITIAL_TTL_MS,
      maxExpiresAt: now + ROOM_MAX_TTL_MS,
    }),
  }));

  return c.json({
    roomId,
    hostSessionId,
    hostToken,
    signalingUrl: `/rooms/${roomId}/ws`,
    wsUrl: buildWebSocketUrl(c.req.url, roomId),
    iceServers: ice.iceServers,
    turnCredentialExpiresAt: ice.turnCredentialExpiresAt,
  }, 201);
});

app.post("/rooms/:roomId/join", async (c) => {
  // existing join validation...
  const viewerToken = await issueScopedToken(
    { roomId, role: "viewer", sessionId: viewerSessionId },
    {
      secret: getRoomTokenSecret(c.env),
      now: Math.floor(getNow(c.env) / 1_000),
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

  const ice = await buildIceResponse(c.env, {
    roomId,
    sessionId: claims.sessionId,
    role: "host",
  });

  return c.json(ice);
});
```

```ts
// apps/extension/lib/room-api.ts
export type RoomCreateResponse = {
  roomId: string;
  hostSessionId?: string;
  hostToken: string;
  signalingUrl: string;
  iceServers?: RTCIceServer[];
  turnCredentialExpiresAt?: number | null;
};

export type HostIceRefreshResponse = {
  iceServers: RTCIceServer[];
  turnCredentialExpiresAt: number | null;
};

export async function refreshHostIce(
  fetchImpl: typeof fetch,
  apiBaseUrl: string,
  roomId: string,
  hostToken: string,
): Promise<HostIceRefreshResponse> {
  const response = await fetchImpl(`${apiBaseUrl}/rooms/${roomId}/host/ice`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${hostToken}`,
    },
  });

  if (!response.ok) {
    const errorDetails = await readResponseErrorDetails(response);
    throw new Error(`Failed to refresh host ICE (${response.status}): ${errorDetails}`);
  }

  return response.json() as Promise<HostIceRefreshResponse>;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @screenmate/cloudflare test -- test/room-routes.test.ts`

Expected: PASS with route tests green and new TURN assertions included.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/index.ts apps/server/src/env.ts apps/server/test/room-routes.test.ts apps/extension/lib/room-api.ts
git commit -m "feat(server): return session-scoped turn ice"
```

### Task 3: Add Local Docker `coturn` And Update Developer Docs

**Files:**
- Create: `docker/coturn/turnserver.local.conf`
- Create: `docker-compose.turn.yml`
- Modify: `README.md`
- Modify: `docs/testing/manual-room-streaming-checklist.md`

- [ ] **Step 1: Write the failing docs check**

```md
<!-- Add this checklist requirement to docs/testing/manual-room-streaming-checklist.md -->
- [ ] Start local TURN with `docker compose -f docker-compose.turn.yml up -d`.
- [ ] Confirm the worker has `TURN_AUTH_SECRET`, `TURN_REALM`, and `TURN_URLS` configured.
- [ ] Verify the room creation response contains a TURN server entry before opening the extension.
- [ ] In `chrome://webrtc-internals`, confirm at least one successful session reports a selected `relay` candidate pair when direct connectivity is blocked.
```

```text
# README.md additions
- `TURN_AUTH_SECRET`
  Shared secret used to sign coturn REST credentials.
- `TURN_REALM`
  TURN auth realm. Example: `screenmate.local`.
- `TURN_URLS`
  Comma-separated TURN URLs returned to clients.
- `TURN_TTL_SECONDS`
  Lifetime of issued TURN credentials. Default: `600`.

Local TURN:
1. `docker compose -f docker-compose.turn.yml up -d`
2. Set `TURN_AUTH_SECRET`, `TURN_REALM`, and `TURN_URLS` for `apps/server`
3. Run `pnpm --filter @screenmate/cloudflare dev`
```

- [ ] **Step 2: Run a quick existence check to verify it fails**

Run: `test -f docker-compose.turn.yml && test -f docker/coturn/turnserver.local.conf`

Expected: command exits non-zero because neither local TURN file exists yet.

- [ ] **Step 3: Write minimal implementation**

```yaml
# docker-compose.turn.yml
services:
  coturn:
    image: coturn/coturn:4.6.3
    command:
      - -c
      - /etc/coturn/turnserver.conf
    ports:
      - "3478:3478"
      - "3478:3478/udp"
      - "5349:5349"
      - "49160-49200:49160-49200/udp"
    volumes:
      - ./docker/coturn/turnserver.local.conf:/etc/coturn/turnserver.conf:ro
    environment:
      TURN_SHARED_SECRET: screenmate-local-turn-secret
```

```ini
# docker/coturn/turnserver.local.conf
listening-port=3478
tls-listening-port=5349
fingerprint
stale-nonce
use-auth-secret
static-auth-secret=screenmate-local-turn-secret
realm=screenmate.local
no-cli
no-loopback-peers
min-port=49160
max-port=49200
log-file=stdout
simple-log
```

```md
# README.md excerpt
Local TURN for ScreenMate runs through Docker so local ICE responses match non-local environments.

~~~bash
docker compose -f docker-compose.turn.yml up -d
export TURN_AUTH_SECRET=screenmate-local-turn-secret
export TURN_REALM=screenmate.local
export TURN_URLS="turn:127.0.0.1:3478?transport=udp,turn:127.0.0.1:3478?transport=tcp,turns:127.0.0.1:5349?transport=tcp"
pnpm --filter @screenmate/cloudflare dev
~~~
```

- [ ] **Step 4: Run the existence check and docs sanity read**

Run: `test -f docker-compose.turn.yml && test -f docker/coturn/turnserver.local.conf && sed -n '1,140p' README.md`

Expected: the `test` command succeeds and the README shows TURN env var documentation plus local Docker startup instructions.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.turn.yml docker/coturn/turnserver.local.conf README.md docs/testing/manual-room-streaming-checklist.md
git commit -m "docs(dev): add local coturn workflow"
```

### Task 4: Persist Mutable Room Expiry And Renew On Host Heartbeats

**Files:**
- Modify: `apps/server/src/do/room-object.ts`
- Modify: `apps/server/test/room-object.test.ts`
- Modify: `apps/server/test/room-routes.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/server/test/room-object.test.ts
it("extends room expiry when the host sends heartbeats", async () => {
  let currentNow = 1_000;
  const room = new RoomState(
    {
      roomId: "room_demo",
      hostSessionId: "host_1",
      createdAt: 0,
      expiresAt: 3_600_000,
      maxExpiresAt: 43_200_000,
      closedAt: null,
      closedReason: null,
    },
    {
      now: () => currentNow,
      onPersist: async (record) => {
        persisted = record;
      },
    },
  );
  let persisted: { expiresAt: number } | null = null;
  const host = createSocketPair();

  room.connectSession({
    roomId: "room_demo",
    role: "host",
    sessionId: "host_1",
    socket: host.server,
  });

  currentNow = 3_500_000;
  room.handleSocketMessage(
    {
      roomId: "room_demo",
      role: "host",
      sessionId: "host_1",
      socket: host.server,
    },
    JSON.stringify({
      roomId: "room_demo",
      sessionId: "host_1",
      role: "host",
      messageType: "heartbeat",
      timestamp: currentNow,
      payload: { sequence: 1 },
    }),
  );
  await Promise.resolve();

  expect(persisted?.expiresAt).toBe(5_300_000);
});

it("does not extend room expiry when a viewer sends heartbeats", async () => {
  let persistedCalls = 0;
  const room = new RoomState(
    {
      roomId: "room_demo",
      hostSessionId: "host_1",
      createdAt: 0,
      expiresAt: 3_600_000,
      maxExpiresAt: 43_200_000,
      closedAt: null,
      closedReason: null,
    },
    {
      now: () => 3_500_000,
      onPersist: async () => {
        persistedCalls += 1;
      },
    },
  );
  const viewer = createSocketPair();

  room.connectSession({
    roomId: "room_demo",
    role: "viewer",
    sessionId: "viewer_1",
    socket: viewer.server,
  });

  room.handleSocketMessage(
    {
      roomId: "room_demo",
      role: "viewer",
      sessionId: "viewer_1",
      socket: viewer.server,
    },
    JSON.stringify({
      roomId: "room_demo",
      sessionId: "viewer_1",
      role: "viewer",
      messageType: "heartbeat",
      timestamp: 3_500_000,
      payload: { sequence: 1 },
    }),
  );
  await Promise.resolve();

  expect(persistedCalls).toBe(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @screenmate/cloudflare test -- test/room-object.test.ts`

Expected: FAIL because `maxExpiresAt` and `onPersist` do not exist and heartbeat handling is still a no-op.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/server/src/do/room-object.ts
type RoomInitialization = {
  roomId: string;
  hostSessionId: string;
  createdAt: number;
  expiresAt: number;
  maxExpiresAt: number;
};

type PersistedRoomRecord = RoomInitialization & {
  closedAt: number | null;
  closedReason: CloseReason | null;
};

const ROOM_RENEWAL_WINDOW_MS = 30 * 60 * 1_000;

export class RoomState {
  private readonly createdAt: number;
  private expiresAt: number;
  private readonly maxExpiresAt: number;

  constructor(
    record: PersistedRoomRecord,
    private readonly options: {
      now?: () => number;
      onPersist?: (record: PersistedRoomRecord) => void | Promise<void>;
      onClose?: (closure: { closedAt: number; reason: CloseReason }) => void | Promise<void>;
    } = {},
  ) {
    this.createdAt = record.createdAt;
    this.expiresAt = record.expiresAt;
    this.maxExpiresAt = record.maxExpiresAt;
    // existing assignments...
  }

  private async renewFromHostActivity() {
    const nextExpiresAt = Math.min(
      this.maxExpiresAt,
      Math.max(this.expiresAt, this.now() + ROOM_RENEWAL_WINDOW_MS),
    );

    if (nextExpiresAt === this.expiresAt) {
      return;
    }

    this.expiresAt = nextExpiresAt;
    await this.options.onPersist?.({
      roomId: this.roomId,
      hostSessionId: this.hostSessionId,
      createdAt: this.createdAt,
      expiresAt: this.expiresAt,
      maxExpiresAt: this.maxExpiresAt,
      closedAt: this.closedAt,
      closedReason: this.closedReason,
    });
  }

  handleSocketMessage(connection: RoomConnection, rawData: unknown) {
    // existing parsing...
    switch (envelope.messageType) {
      case "heartbeat":
        if (connection.role === "host") {
          void this.renewFromHostActivity();
        }
        break;
      // existing cases...
    }
  }
}
```

```ts
// apps/server/src/do/room-object.ts createRoomState
private createRoomState(record: PersistedRoomRecord): RoomState {
  return new RoomState(record, {
    onPersist: async (nextRecord) => {
      this.record = nextRecord;
      await this.state.storage.put(ROOM_RECORD_KEY, nextRecord);
    },
    onClose: async ({ closedAt, reason }) => {
      this.record = {
        ...(this.record ?? record),
        closedAt,
        closedReason: reason,
      };
      await this.state.storage.put(ROOM_RECORD_KEY, this.record);
    },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @screenmate/cloudflare test -- test/room-object.test.ts`

Expected: PASS with new heartbeat-renewal coverage green.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/do/room-object.ts apps/server/test/room-object.test.ts apps/server/test/room-routes.test.ts
git commit -m "feat(server): renew rooms from host heartbeats"
```

### Task 5: Send Host Heartbeats From The Extension Runtime

**Files:**
- Modify: `apps/extension/entrypoints/background/host-room-runtime.ts`
- Modify: `apps/extension/test/host-room-runtime.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/extension/test/host-room-runtime.test.ts
it("sends heartbeats while the host signaling socket stays open", async () => {
  vi.useFakeTimers();
  const storage = {
    get: vi.fn().mockResolvedValue({}),
    set: vi.fn(),
    remove: vi.fn(),
  };
  const sockets: MockHostSocket[] = [];
  const runtime = createHostRoomRuntime({
    storage,
    now: () => 1_000,
    WebSocketImpl: class {
      constructor(_url: string) {
        const socket = new MockHostSocket();
        sockets.push(socket);
        return socket as never;
      }
    } as never,
  });

  await runtime.startRoom({
    roomId: "room_123",
    hostSessionId: "host_1",
    hostToken: "host-token",
    signalingUrl: "/rooms/room_123/ws",
    iceServers: [],
    turnCredentialExpiresAt: 10_000,
    activeTabId: 42,
    activeFrameId: 0,
    viewerSessionIds: [],
    viewerCount: 0,
    sourceFingerprint: null,
    recoverByTimestamp: null,
  });

  const connectPromise = runtime.connectSignaling(vi.fn());
  sockets[0]!.readyState = 1;
  sockets[0]!.emit("open");
  await connectPromise;

  vi.advanceTimersByTime(20_000);
  vi.advanceTimersByTime(20_000);

  const heartbeatPayloads = sockets[0]!.send.mock.calls
    .map(([payload]) => JSON.parse(payload as string))
    .filter((message) => message.messageType === "heartbeat");

  expect(heartbeatPayloads).toEqual([
    {
      roomId: "room_123",
      sessionId: "host_1",
      role: "host",
      messageType: "heartbeat",
      timestamp: 1_000,
      payload: { sequence: 1 },
    },
    {
      roomId: "room_123",
      sessionId: "host_1",
      role: "host",
      messageType: "heartbeat",
      timestamp: 1_000,
      payload: { sequence: 2 },
    },
  ]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @screenmate/extension test -- test/host-room-runtime.test.ts`

Expected: FAIL because no `heartbeat` messages are emitted.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/extension/entrypoints/background/host-room-runtime.ts
const HEARTBEAT_INTERVAL_MS = 20_000;

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatSequence = 0;

function stopHeartbeat() {
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function sendHeartbeat() {
  if (!session) {
    return false;
  }

  heartbeatSequence += 1;
  return sendSignal(
    signalEnvelopeSchema.parse({
      roomId: session.roomId,
      sessionId: session.hostSessionId,
      role: "host",
      messageType: "heartbeat",
      timestamp: now(),
      payload: {
        sequence: heartbeatSequence,
      },
    }),
  );
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    void sendHeartbeat();
  }, HEARTBEAT_INTERVAL_MS);
}

function closeSocket() {
  stopHeartbeat();
  // existing close logic...
}

nextSocket.addEventListener("open", () => {
  // existing queue flush...
  heartbeatSequence = 0;
  startHeartbeat();
});

nextSocket.addEventListener("close", () => {
  stopHeartbeat();
  if (socket === nextSocket) {
    socket = null;
  }
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @screenmate/extension test -- test/host-room-runtime.test.ts`

Expected: PASS with the new heartbeat assertions green.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/entrypoints/background/host-room-runtime.ts apps/extension/test/host-room-runtime.test.ts
git commit -m "feat(extension): send host heartbeats"
```

### Task 6: Refresh Host TURN Before Late Viewer Negotiation

**Files:**
- Modify: `apps/extension/entrypoints/background/host-room-snapshot.ts`
- Modify: `apps/extension/entrypoints/background/host-room-runtime.ts`
- Modify: `apps/extension/entrypoints/background.ts`
- Modify: `apps/extension/entrypoints/content.ts`
- Modify: `apps/extension/entrypoints/content/source-attachment.ts`
- Modify: `apps/extension/lib/room-api.ts`
- Modify: `apps/extension/test/background.test.ts`
- Modify: `apps/extension/test/source-attachment.test.ts`
- Modify: `apps/extension/test/host-room-runtime.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/extension/test/source-attachment.test.ts
it("updates the active attachment ice servers without tearing down the stream", async () => {
  document.body.innerHTML = `<video id="host" src="https://example.com/host.mp4"></video>`;
  const video = document.getElementById("host") as HTMLVideoElement;
  setVideoRect(video, 640, 360);
  const track = createMockTrack() as unknown as MediaStreamTrack;

  Object.defineProperty(video, "captureStream", {
    configurable: true,
    value: vi.fn(() => ({ getTracks: () => [track] })),
  });

  MockRTCPeerConnection.instances = [];
  const runtime = createSourceAttachmentRuntime({
    now: () => 100,
    onSignal: vi.fn(),
    onSourceDetached: vi.fn(),
    RTCPeerConnectionImpl: MockRTCPeerConnection as never,
  });

  await runtime.attachSource({
    roomId: "room_123",
    sessionId: "host_1",
    videoId: getVideoHandle(video),
    viewerSessionIds: [],
    iceServers: [{ urls: ["turn:old.example:3478?transport=udp"], username: "old", credential: "old" }],
  });

  runtime.updateIceServers([
    { urls: ["turn:new.example:3478?transport=udp"], username: "new", credential: "new" },
  ]);

  await runtime.handleSignal({
    messageType: "viewer-joined",
    sessionId: "viewer_1",
    payload: { viewerSessionId: "viewer_1" },
  });

  expect(MockRTCPeerConnection.instances.at(-1)?.config).toEqual({
    iceServers: [
      { urls: ["turn:new.example:3478?transport=udp"], username: "new", credential: "new" },
    ],
  });
  expect(track.stop).not.toHaveBeenCalled();
});
```

```ts
// apps/extension/test/background.test.ts
it("refreshes host ice before forwarding a late viewer-joined signal", async () => {
  const runtime = {
    getSnapshot: vi.fn().mockReturnValue({
      roomLifecycle: "open",
      sourceState: "attached",
      roomId: "room_123",
      viewerCount: 0,
      activeTabId: 42,
      activeFrameId: 0,
    }),
    shouldRefreshHostIce: vi.fn().mockReturnValue(true),
    refreshHostIce: vi.fn().mockResolvedValue({
      iceServers: [{ urls: ["turn:new.example:3478?transport=udp"], username: "new", credential: "new" }],
      turnCredentialExpiresAt: 2_000,
    }),
    getAttachSession: vi.fn().mockReturnValue({
      roomId: "room_123",
      sessionId: "host_1",
      viewerSessionIds: [],
      iceServers: [{ urls: ["turn:old.example:3478?transport=udp"], username: "old", credential: "old" }],
    }),
  } as never;
  const sendTabMessage = vi.fn().mockResolvedValue({ ok: true });
  const handler = createHostMessageHandler(createHandlerDependencies({
    runtime,
    sendTabMessage,
  }));

  await handler({
    type: "screenmate:signal-inbound",
    frameId: 0,
    envelope: {
      roomId: "room_123",
      sessionId: "viewer_1",
      role: "viewer",
      messageType: "viewer-joined",
      timestamp: 10,
      payload: { viewerSessionId: "viewer_1" },
    },
  });

  expect(runtime.refreshHostIce).toHaveBeenCalledTimes(1);
  expect(sendTabMessage).toHaveBeenCalledWith(
    42,
    {
      type: "screenmate:update-ice-servers",
      iceServers: [{ urls: ["turn:new.example:3478?transport=udp"], username: "new", credential: "new" }],
    },
    { frameId: 0 },
  );
});
```

- [ ] **Step 2: Run the extension tests to verify they fail**

Run: `pnpm --filter @screenmate/extension test -- test/source-attachment.test.ts test/background.test.ts test/host-room-runtime.test.ts`

Expected: FAIL because there is no `updateIceServers` content API, no stored `turnCredentialExpiresAt`, and no host ICE refresh behavior.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/extension/entrypoints/background/host-room-snapshot.ts
export type PersistedHostRoomSession = {
  roomId: string;
  hostSessionId: string;
  hostToken: string;
  signalingUrl: string;
  iceServers: RTCIceServer[];
  turnCredentialExpiresAt: number | null;
  activeTabId: number;
  activeFrameId: number;
  viewerSessionIds: string[];
  viewerCount: number;
  sourceFingerprint: SourceFingerprint | null;
  recoverByTimestamp: number | null;
};
```

```ts
// apps/extension/entrypoints/background/host-room-runtime.ts
import { refreshHostIce } from "../../lib/room-api";

const TURN_REFRESH_SKEW_MS = 60_000;

function shouldRefreshHostIce() {
  return Boolean(
    session?.turnCredentialExpiresAt &&
    session.turnCredentialExpiresAt <= now() + TURN_REFRESH_SKEW_MS,
  );
}

async function refreshHostIceLease() {
  if (!session) {
    return null;
  }

  const refreshed = await refreshHostIce(
    fetch,
    apiBaseUrl,
    session.roomId,
    session.hostToken,
  );
  session = {
    ...session,
    iceServers: refreshed.iceServers,
    turnCredentialExpiresAt: refreshed.turnCredentialExpiresAt,
  };
  await persist();
  return refreshed;
}

return {
  // existing methods...
  shouldRefreshHostIce,
  async refreshHostIce() {
    return refreshHostIceLease();
  },
  updateIceServers(iceServers: RTCIceServer[], turnCredentialExpiresAt: number | null) {
    if (!session) {
      return null;
    }
    session = { ...session, iceServers, turnCredentialExpiresAt };
    return persist();
  },
};
```

```ts
// apps/extension/entrypoints/content.ts
export type ContentControlMessage =
  | { type: "screenmate:update-ice-servers"; iceServers: RTCIceServer[] }
  | /* existing message variants */;

if (message.type === "screenmate:update-ice-servers" && sourceAttachmentRuntime) {
  queueMicrotask(() => {
    sourceAttachmentRuntime.updateIceServers(message.iceServers);
    sendResponse({ ok: true });
  });
  return true;
}
```

```ts
// apps/extension/entrypoints/content/source-attachment.ts
function updateIceServers(iceServers: RTCIceServer[]) {
  if (!attachment) {
    return false;
  }

  attachment = {
    ...attachment,
    iceServers: normalizeIceServers(iceServers) as RTCIceServer[],
  };
  return true;
}

return {
  attachSource,
  beginViewerNegotiation,
  handleSignal,
  updateIceServers,
  destroy,
};
```

```ts
// apps/extension/entrypoints/background.ts
if (message.type === "screenmate:signal-inbound") {
  if (
    message.envelope.messageType === "viewer-joined" &&
    dependencies.runtime.shouldRefreshHostIce?.()
  ) {
    const refreshed = await dependencies.runtime.refreshHostIce?.();
    if (refreshed) {
      await dependencies.sendTabMessage(
        tabId,
        {
          type: "screenmate:update-ice-servers",
          iceServers: refreshed.iceServers,
        },
        { frameId: message.frameId },
      );
    }
  }

  await dependencies.sendTabMessage(
    tabId,
    {
      type: "screenmate:signal-inbound",
      envelope: message.envelope as SignalEnvelope,
    },
    { frameId: message.frameId },
  );
  return { ok: true };
}
```

- [ ] **Step 4: Run the extension tests to verify they pass**

Run: `pnpm --filter @screenmate/extension test -- test/source-attachment.test.ts test/background.test.ts test/host-room-runtime.test.ts`

Expected: PASS with late-viewer refresh coverage green and no source teardown during ICE updates.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/entrypoints/background/host-room-snapshot.ts apps/extension/entrypoints/background/host-room-runtime.ts apps/extension/entrypoints/background.ts apps/extension/entrypoints/content.ts apps/extension/entrypoints/content/source-attachment.ts apps/extension/lib/room-api.ts apps/extension/test/background.test.ts apps/extension/test/source-attachment.test.ts apps/extension/test/host-room-runtime.test.ts
git commit -m "feat(extension): refresh host turn ice for late viewers"
```

### Task 7: Full Verification Pass

**Files:**
- Modify: `README.md` if verification uncovers missing instructions
- Modify: `docs/testing/manual-room-streaming-checklist.md` if verification uncovers missing test steps

- [ ] **Step 1: Run focused package tests**

```bash
pnpm --filter @screenmate/cloudflare test -- test/turn-credentials.test.ts test/room-routes.test.ts test/room-object.test.ts
pnpm --filter @screenmate/extension test -- test/host-room-runtime.test.ts test/background.test.ts test/source-attachment.test.ts
pnpm --filter @screenmate/webrtc-core test -- test/ice-config.test.ts
```

Expected: all suites PASS.

- [ ] **Step 2: Run typechecks**

```bash
pnpm --filter @screenmate/cloudflare typecheck
pnpm --filter @screenmate/extension typecheck
```

Expected: both commands PASS with no TypeScript errors.

- [ ] **Step 3: Run local TURN and manual flow**

```bash
docker compose -f docker-compose.turn.yml up -d
TURN_AUTH_SECRET=screenmate-local-turn-secret \
TURN_REALM=screenmate.local \
TURN_URLS="turn:127.0.0.1:3478?transport=udp,turn:127.0.0.1:3478?transport=tcp,turns:127.0.0.1:5349?transport=tcp" \
pnpm --filter @screenmate/cloudflare dev
```

Expected:
- `coturn` container is healthy
- `/rooms` responses include three ICE entries
- host extension can start a room and attach a source
- when direct connectivity is blocked, `chrome://webrtc-internals` shows a selected `relay` candidate pair

- [ ] **Step 4: Commit**

```bash
git add README.md docs/testing/manual-room-streaming-checklist.md
git commit -m "test: verify turn fallback workflow"
```

## Self-Review

### Spec Coverage

- TURN fallback with `coturn` primary provider: covered by Tasks 1-3.
- Fixed STUN list (`miwifi` + `Cloudflare`): covered by Tasks 1-2.
- Short-lived TURN credentials: covered by Tasks 1-2.
- No anonymous TURN issuance: covered by Task 2 host-authenticated refresh route.
- Local Docker TURN parity: covered by Task 3.
- Host-only room renewal with hard max lifetime: covered by Tasks 2 and 4.
- Heartbeat-driven renewal: covered by Tasks 4-5.
- Host late-viewer TURN refresh: covered by Task 6.
- Observability and manual verification: covered by Task 7.

### Placeholder Scan

- No `TODO`, `TBD`, or “implement later” placeholders remain.
- Every code-changing step includes concrete code blocks.
- Every verification step includes an exact command and expected result.

### Type Consistency

- Route payload fields are consistently named `turnCredentialExpiresAt`.
- Host runtime uses `refreshHostIce` and `shouldRefreshHostIce` consistently across runtime and background message handler tasks.
- Content runtime method name is consistently `updateIceServers`.
