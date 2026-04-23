# ScreenMate Function Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stage-one popup and viewer mock modules with real password, roster, identity, metrics, chat, screen-capture, and uploaded-file behavior without rewriting the migrated presenter layer.

**Architecture:** Keep the stage-one presenters stable and replace behavior at the scene-adapter seam. Use existing room HTTP routes and signaling WebSocket paths where possible: add room access endpoints for password control, extend signaling for viewer profile/metrics/chat, teach the background runtime to aggregate real popup room data, and generalize source attachment so screen and uploaded-file sources can negotiate the same way page-video sources do.

**Tech Stack:** TypeScript, Cloudflare Workers + Durable Objects, React 19, WXT MV3 browser extension APIs, Vitest, Zod, WebSocket signaling, WebRTC stats and media capture APIs

---

## Scope Boundary

This plan starts only after the stage-one UI migration has landed and its tests are green. It assumes the following files already exist from stage one:

- `apps/extension/entrypoints/popup/scene-model.ts`
- `apps/extension/entrypoints/popup/mock-state.ts`
- `apps/extension/entrypoints/popup/scene-adapter.ts`
- `apps/extension/entrypoints/popup/presenter.tsx`
- `apps/viewer-web/src/viewer-scene-model.ts`
- `apps/viewer-web/src/viewer-mock-state.ts`
- `apps/viewer-web/src/viewer-scene-adapter.ts`
- `apps/viewer-web/src/components/ViewerShell.tsx`

## File Structure

- Create: `apps/server/src/lib/room-password.ts`
  - Hash and verify optional room passwords for host-controlled access settings.
- Modify: `apps/server/src/index.ts`
  - Add a host-only room access route and accept viewer password payloads during join.
- Modify: `apps/server/src/do/room-object.ts`
  - Persist password configuration, expose `requiresPassword`, and validate join attempts.
- Modify: `apps/server/test/room-routes.test.ts`
  - Cover password save and password-gated join flow.
- Modify: `apps/viewer-web/src/lib/api.ts`
  - Send optional password and surface password-specific errors.
- Modify: `apps/viewer-web/src/components/JoinForm.tsx`
  - Add a real password input and submit it to `joinRoom`.
- Modify: `apps/extension/lib/room-api.ts`
  - Add a host access-settings request helper.
- Modify: `apps/extension/entrypoints/popup/scene-adapter.ts`
  - Replace mock password state with real access-state data after the API lands.
- Modify: `packages/shared/src/signaling.ts`
  - Add `viewer-profile`, `viewer-metrics`, and `chat-message` envelopes.
- Modify: `packages/shared/test/signaling.test.ts`
  - Cover the new signaling payloads.
- Modify: `apps/viewer-web/src/lib/session-state.ts`
  - Track real viewer profile, metrics, and chat messages.
- Modify: `apps/viewer-web/src/viewer-session.ts`
  - Send viewer profile, collect peer metrics, and send/receive chat envelopes.
- Modify: `apps/extension/entrypoints/background/host-room-runtime.ts`
  - Store viewer profiles, metrics, and chat history for the popup.
- Modify: `apps/extension/entrypoints/background/host-room-snapshot.ts`
  - Expose real viewer roster and room access fields in the runtime snapshot shape.
- Modify: `apps/extension/entrypoints/background.ts`
  - Route popup chat and access-setting messages to the runtime and API helpers.
- Modify: `apps/extension/entrypoints/popup/App.tsx`
  - Replace stage-one mock password and chat handlers with real runtime-backed handlers.
- Modify: `apps/extension/entrypoints/content/source-attachment.ts`
  - Generalize attachment from “page video only” to “any named media stream source”.
- Create: `apps/extension/entrypoints/content/screen-capture.ts`
  - Resolve a tab-capture stream ID into a live `MediaStream`.
- Create: `apps/extension/entrypoints/content/uploaded-video-source.ts`
  - Rehydrate an uploaded file into a hidden `<video>` element and capture its stream.
- Modify: `apps/extension/entrypoints/background.ts`
  - Add popup/runtime messages for real screen and upload attachment flows.
- Modify: `apps/extension/test/background.test.ts`
  - Cover password save, roster updates, chat flow, and source-mode message routing.
- Modify: `apps/viewer-web/test/viewer-session.test.ts`
  - Cover profile, metrics, and chat signaling behavior.
- Modify: `apps/extension/test/source-attachment.test.ts`
  - Cover generic media-source attach, tab-capture stream attach, and uploaded-file attach.

## Task 1: Add Real Password-Protected Rooms And Replace Popup Password Mocking

**Files:**
- Create: `apps/server/src/lib/room-password.ts`
- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/src/do/room-object.ts`
- Modify: `apps/server/test/room-routes.test.ts`
- Modify: `apps/viewer-web/src/lib/api.ts`
- Modify: `apps/viewer-web/src/components/JoinForm.tsx`
- Modify: `apps/extension/lib/room-api.ts`
- Modify: `apps/extension/entrypoints/popup/App.tsx`
- Modify: `apps/extension/entrypoints/popup/scene-adapter.ts`

- [ ] **Step 1: Write the failing password flow tests**

Add this route test to `apps/server/test/room-routes.test.ts`:

```ts
it("requires the saved room password before issuing a viewer token", async () => {
  const roomNamespace = createRoomNamespace(async (roomId, request) => {
    const pathname = new URL(request.url).pathname;

    if (pathname === "/internal/initialize") {
      return Response.json({ roomId, state: "hosting", hostConnected: false, viewerCount: 0 });
    }

    if (pathname === "/internal/access" && request.method === "PUT") {
      const body = await request.json();
      expect(body).toEqual({ passwordHash: expect.any(String) });
      return Response.json({ roomId, requiresPassword: true });
    }

    if (pathname === "/internal/join" && request.method === "POST") {
      const body = await request.json();
      return body.password === "letmein"
        ? Response.json({ roomId, state: "hosting", hostConnected: true, viewerCount: 1, requiresPassword: true })
        : Response.json({ error: "ROOM_PASSWORD_INVALID" }, 403);
    }

    return Response.json({ error: "unexpected-path" }, 500);
  });

  const createResponse = await app.request(
    "/rooms",
    { method: "POST" },
    { ROOM_OBJECT: roomNamespace, ROOM_TOKEN_SECRET: TEST_SECRET, SCREENMATE_NOW: TEST_NOW } as never,
  );
  const { roomId, hostToken } = await createResponse.json() as { roomId: string; hostToken: string };

  const accessResponse = await app.request(
    `/rooms/${roomId}/access`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${hostToken}`, "content-type": "application/json" },
      body: JSON.stringify({ password: "letmein" }),
    },
    { ROOM_OBJECT: roomNamespace, ROOM_TOKEN_SECRET: TEST_SECRET, SCREENMATE_NOW: TEST_NOW } as never,
  );

  expect(accessResponse.status).toBe(200);

  const denied = await app.request(
    `/rooms/${roomId}/join`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "wrong" }),
    },
    { ROOM_OBJECT: roomNamespace, ROOM_TOKEN_SECRET: TEST_SECRET, SCREENMATE_NOW: TEST_NOW } as never,
  );

  expect(denied.status).toBe(403);

  const allowed = await app.request(
    `/rooms/${roomId}/join`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "letmein" }),
    },
    { ROOM_OBJECT: roomNamespace, ROOM_TOKEN_SECRET: TEST_SECRET, SCREENMATE_NOW: TEST_NOW } as never,
  );

  expect(allowed.status).toBe(200);
});
```

Add this viewer API test to `apps/viewer-web/test/app-route.test.tsx` by extending the mocked fetch branch:

```ts
if (url.endsWith("/rooms/room_demo/join") && init?.method === "POST") {
  expect(init.body).toBe(JSON.stringify({ password: "letmein" }));
  return Response.json({
    roomId: "room_demo",
    sessionId: "viewer_1",
    viewerToken: "viewer-token",
    wsUrl: "ws://signal.example/rooms/room_demo/ws",
    iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }],
  });
}
```

- [ ] **Step 2: Run the failing server and viewer tests**

Run:

```bash
pnpm --filter @screenmate/cloudflare test -- test/room-routes.test.ts
pnpm --filter @screenmate/viewer-web test -- test/app-route.test.tsx
```

Expected:

- server test FAILS because `/rooms/:roomId/access` does not exist and join ignores request bodies
- viewer test FAILS because `joinRoom` does not send a password payload

- [ ] **Step 3: Write the minimal password-protected room implementation**

Create `apps/server/src/lib/room-password.ts`:

```ts
export async function hashRoomPassword(password: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(password),
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyRoomPassword(
  password: string,
  expectedHash: string | null,
): Promise<boolean> {
  if (!expectedHash) {
    return true;
  }

  return (await hashRoomPassword(password)) === expectedHash;
}
```

Update `apps/server/src/index.ts` with a host-only access route and password-aware join:

```ts
import { hashRoomPassword } from "./lib/room-password.js";

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

  const body = await c.req.json() as { password?: string };
  const passwordHash =
    body.password && body.password.trim()
      ? await hashRoomPassword(body.password.trim())
      : null;

  const roomObject = getRoomObject(c.env, roomId);
  return roomObject.fetch(
    buildInternalRequest("/internal/access", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passwordHash }),
    }),
  );
});

app.post("/rooms/:roomId/join", async (c) => {
  const roomId = c.req.param("roomId");
  const body = await c.req.json().catch(() => ({})) as { password?: string };
  const roomObject = getRoomObject(c.env, roomId);
  const joinValidation = await roomObject.fetch(
    buildInternalRequest("/internal/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: body.password ?? "" }),
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
```

Update `apps/server/src/do/room-object.ts` to store and validate access state:

```ts
type PersistedRoomRecord = RoomInitialization & {
  closedAt: number | null;
  closedReason: CloseReason | null;
  passwordHash: string | null;
};

async setAccess(passwordHash: string | null) {
  this.passwordHash = passwordHash;
  await this.persist();
  return {
    roomId: this.roomId,
    requiresPassword: passwordHash !== null,
  };
}

async validateViewerJoin(password = ""): Promise<JoinValidation> {
  if (!(await verifyRoomPassword(password, this.passwordHash))) {
    return {
      ok: false,
      status: 403,
      body: { error: "ROOM_PASSWORD_INVALID" },
    };
  }

  return this.validateViewerJoinUnlocked();
}

private validateViewerJoinUnlocked(): JoinValidation {
  if (this.isExpired()) {
    void this.closeRoom("expired");
    return {
      ok: false,
      status: 410,
      body: {
        error: errorCodes.ROOM_EXPIRED,
        ...this.getStateSnapshot(),
      },
    };
  }

  if (this.isClosed()) {
    return {
      ok: false,
      status: 409,
      body: {
        error: errorCodes.ROOM_NOT_FOUND,
        ...this.getStateSnapshot(),
      },
    };
  }

  return { ok: true, snapshot: this.getStateSnapshot() };
}
```

Update `apps/viewer-web/src/lib/api.ts`:

```ts
export async function joinRoom(
  baseUrl: string,
  roomId: string,
  password = "",
  fetchFn: typeof fetch = fetch,
): Promise<JoinRoomResponse> {
  const response = await fetchFn(new URL(`/rooms/${roomId}/join`, baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });

  if (!response.ok) {
    throw await toRoomApiError(response, "ROOM_JOIN_FAILED");
  }

  return response.json();
}

function toErrorMessage(code: string, details?: Record<string, unknown>): string {
  if (code === "ROOM_PASSWORD_INVALID") {
    return "The room password is incorrect.";
  }

  return "We couldn’t join that room.";
}
```

Update `apps/viewer-web/src/components/JoinForm.tsx`:

```tsx
export function JoinForm({
  isBusy,
  onJoin,
}: {
  isBusy: boolean;
  onJoin: (roomCode: string, password: string) => void;
}) {
  const [roomCode, setRoomCode] = useState("");
  const [password, setPassword] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onJoin(roomCode.trim(), password);
  }

  return (
    <form className="grid gap-4" onSubmit={handleSubmit}>
      <div className="grid gap-2">
        <Label htmlFor="roomCode">Room code</Label>
        <Input
          id="roomCode"
          value={roomCode}
          onChange={(event) => setRoomCode(event.target.value)}
          placeholder="room_ab12cd34"
          autoComplete="off"
          disabled={isBusy}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="roomPassword">Password</Label>
        <Input
          id="roomPassword"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Optional room password"
          disabled={isBusy}
        />
      </div>
    </form>
  );
}
```

Update `apps/extension/lib/room-api.ts`:

```ts
export async function updateRoomAccess(
  fetchImpl: typeof fetch,
  apiBaseUrl: string,
  roomId: string,
  hostToken: string,
  password: string,
) {
  const response = await fetchImpl(`${apiBaseUrl}/rooms/${roomId}/access`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${hostToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ password }),
  });

  if (!response.ok) {
    throw new Error(`Failed to update room access (${response.status})`);
  }

  return response.json() as Promise<{ roomId: string; requiresPassword: boolean }>;
}
```

- [ ] **Step 4: Run the password flow tests and typechecks**

Run:

```bash
pnpm --filter @screenmate/cloudflare test -- test/room-routes.test.ts
pnpm --filter @screenmate/viewer-web test -- test/app-route.test.tsx
pnpm --filter @screenmate/cloudflare typecheck
pnpm --filter @screenmate/viewer-web typecheck
```

Expected: both route suites pass and both package typechecks exit with code `0`.

- [ ] **Step 5: Commit the real password flow**

Run:

```bash
git add apps/server/src/lib/room-password.ts apps/server/src/index.ts apps/server/src/do/room-object.ts apps/server/test/room-routes.test.ts apps/viewer-web/src/lib/api.ts apps/viewer-web/src/components/JoinForm.tsx apps/extension/lib/room-api.ts
git commit -m "feat(room): add password-protected join flow"
```

## Task 2: Replace Mock Identity And Viewer Detail Rows With Real Profiles And Metrics

**Files:**
- Modify: `packages/shared/src/signaling.ts`
- Modify: `packages/shared/test/signaling.test.ts`
- Modify: `apps/viewer-web/src/lib/session-state.ts`
- Modify: `apps/viewer-web/src/viewer-session.ts`
- Modify: `apps/extension/entrypoints/background/host-room-snapshot.ts`
- Modify: `apps/extension/entrypoints/background/host-room-runtime.ts`
- Modify: `apps/extension/entrypoints/background.ts`
- Modify: `apps/extension/entrypoints/popup/scene-adapter.ts`
- Modify: `apps/viewer-web/src/viewer-scene-adapter.ts`
- Modify: `apps/viewer-web/test/viewer-session.test.ts`
- Modify: `apps/extension/test/background.test.ts`

- [ ] **Step 1: Write the failing signaling and runtime tests**

Add this shared signaling test to `packages/shared/test/signaling.test.ts`:

```ts
it("accepts viewer-profile and viewer-metrics envelopes", () => {
  expect(
    signalEnvelopeSchema.safeParse({
      roomId: "room_demo",
      sessionId: "viewer_1",
      role: "viewer",
      messageType: "viewer-profile",
      timestamp: 10,
      payload: {
        displayName: "User_4092",
      },
    }).success,
  ).toBe(true);

  expect(
    signalEnvelopeSchema.safeParse({
      roomId: "room_demo",
      sessionId: "viewer_1",
      role: "viewer",
      messageType: "viewer-metrics",
      timestamp: 11,
      payload: {
        connectionType: "relay",
        roundTripTimeMs: 142,
      },
    }).success,
  ).toBe(true);
});
```

Add this viewer-session test to `apps/viewer-web/test/viewer-session.test.ts`:

```ts
it("sends viewer profile and metrics after the socket opens", async () => {
  const socket = new FakeWebSocket();
  const peer = new FakePeerConnection();
  const session = new ViewerSession({
    apiBaseUrl: "https://api.example",
    fetchFn: async () =>
      Response.json({
        roomId: "room_demo",
        sessionId: "viewer_1",
        viewerToken: "viewer-token",
        wsUrl: "ws://signal.example/rooms/room_demo/ws",
        iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }],
      }),
    createWebSocket: () => socket as never,
    createPeerConnection: () => peer as never,
    now: () => 42,
  });

  await session.join("room_demo");
  socket.emitOpen();

  expect(socket.sentMessages.some((message) => {
    const envelope = JSON.parse(message);
    return envelope.messageType === "viewer-profile";
  })).toBe(true);
});
```

Add this background aggregation test to `apps/extension/test/background.test.ts`:

```ts
it("stores viewer profile and metrics for popup roster rendering", async () => {
  const runtime = {
    applyViewerProfile: vi.fn(),
    applyViewerMetrics: vi.fn(),
    getSnapshot: vi.fn().mockReturnValue(createHostRoomSnapshot()),
  };
  const forwardInboundSignal = createForwardInboundSignalHandler({
    runtime: runtime as never,
    sendTabMessage: vi.fn(),
  });

  forwardInboundSignal({
    roomId: "room_demo",
    sessionId: "viewer_1",
    role: "viewer",
    messageType: "viewer-profile",
    timestamp: 10,
    payload: { displayName: "User_4092" },
  } as never);
  forwardInboundSignal({
    roomId: "room_demo",
    sessionId: "viewer_1",
    role: "viewer",
    messageType: "viewer-metrics",
    timestamp: 11,
    payload: { connectionType: "relay", roundTripTimeMs: 142 },
  } as never);

  expect(runtime.applyViewerProfile).toHaveBeenCalledWith("viewer_1", "User_4092");
  expect(runtime.applyViewerMetrics).toHaveBeenCalledWith("viewer_1", {
    connectionType: "relay",
    roundTripTimeMs: 142,
  });
});
```

- [ ] **Step 2: Run the failing shared, viewer, and extension tests**

Run:

```bash
pnpm --filter @screenmate/shared test -- test/signaling.test.ts
pnpm --filter @screenmate/viewer-web test -- test/viewer-session.test.ts
pnpm --filter @screenmate/extension test -- test/background.test.ts
```

Expected: all three suites FAIL because the new signaling message types and runtime handlers do not exist yet.

- [ ] **Step 3: Write the minimal profile-and-metrics implementation**

Update `packages/shared/src/signaling.ts`:

```ts
const viewerProfilePayloadSchema = z.object({
  displayName: z.string().min(1),
});

const viewerMetricsPayloadSchema = z.object({
  connectionType: z.enum(["direct", "relay"]),
  roundTripTimeMs: z.number().nonnegative(),
});

export const signalEnvelopeSchema = z.discriminatedUnion("messageType", [
  // keep the existing message types,
  z.object({
    ...envelopeBaseSchema,
    role: z.literal("viewer"),
    messageType: z.literal("viewer-profile"),
    payload: viewerProfilePayloadSchema,
  }),
  z.object({
    ...envelopeBaseSchema,
    role: z.literal("viewer"),
    messageType: z.literal("viewer-metrics"),
    payload: viewerMetricsPayloadSchema,
  }),
]);
```

Update `apps/viewer-web/src/lib/session-state.ts`:

```ts
export type ViewerMetrics = {
  connectionType: "direct" | "relay" | null;
  roundTripTimeMs: number | null;
};

export type ViewerChatMessage = {
  id: string;
  sender: string;
  text: string;
  time: string;
};

export type ViewerSessionState = {
  // existing fields
  displayName: string;
  metrics: ViewerMetrics;
  chatMessages: ViewerChatMessage[];
};

export const initialViewerSessionState: ViewerSessionState = {
  // existing fields
  displayName: `User_${Math.floor(Math.random() * 10000)}`,
  metrics: {
    connectionType: null,
    roundTripTimeMs: null,
  },
  chatMessages: [],
};
```

Update `apps/viewer-web/src/viewer-session.ts`:

```ts
private sendViewerProfile() {
  this.sendSignal({
    role: "viewer",
    messageType: "viewer-profile",
    payload: {
      displayName: this.snapshot.displayName,
    },
  });
}

private sendViewerMetrics() {
  if (!this.peerConnection) {
    return;
  }

  void this.peerConnection.getStats().then((report) => {
    const candidatePair = Array.from(report.values()).find(
      (value: RTCStats) => value.type === "candidate-pair" && (value as RTCStats & { state?: string }).state === "succeeded",
    ) as RTCStats & {
      currentRoundTripTime?: number;
      localCandidateType?: string;
    } | undefined;

    this.sendSignal({
      role: "viewer",
      messageType: "viewer-metrics",
      payload: {
        connectionType: candidatePair?.localCandidateType === "relay" ? "relay" : "direct",
        roundTripTimeMs: Math.round((candidatePair?.currentRoundTripTime ?? 0) * 1000),
      },
    });
  });
}

private handleSocketOpen() {
  this.sendViewerProfile();
  this.sendViewerMetrics();
}
```

Update `apps/extension/entrypoints/background/host-room-runtime.ts`:

```ts
type ViewerPresenceDetails = {
  displayName: string;
  connectionType: "direct" | "relay" | null;
  roundTripTimeMs: number | null;
};

private readonly viewerDetails = new Map<string, ViewerPresenceDetails>();

applyViewerProfile(sessionId: string, displayName: string) {
  const current = this.viewerDetails.get(sessionId);
  this.viewerDetails.set(sessionId, {
    displayName,
    connectionType: current?.connectionType ?? null,
    roundTripTimeMs: current?.roundTripTimeMs ?? null,
  });
}

applyViewerMetrics(
  sessionId: string,
  metrics: { connectionType: "direct" | "relay"; roundTripTimeMs: number },
) {
  const current = this.viewerDetails.get(sessionId);
  this.viewerDetails.set(sessionId, {
    displayName: current?.displayName ?? sessionId,
    connectionType: metrics.connectionType,
    roundTripTimeMs: metrics.roundTripTimeMs,
  });
}
```

Update `apps/extension/entrypoints/background.ts` signal forwarding:

```ts
if (envelope.messageType === "viewer-profile") {
  dependencies.runtime.applyViewerProfile(
    envelope.sessionId,
    envelope.payload.displayName,
  );
  return;
}

if (envelope.messageType === "viewer-metrics") {
  dependencies.runtime.applyViewerMetrics(envelope.sessionId, {
    connectionType: envelope.payload.connectionType,
    roundTripTimeMs: envelope.payload.roundTripTimeMs,
  });
  return;
}
```

- [ ] **Step 4: Run the profile-and-metrics test suites**

Run:

```bash
pnpm --filter @screenmate/shared test -- test/signaling.test.ts
pnpm --filter @screenmate/viewer-web test -- test/viewer-session.test.ts
pnpm --filter @screenmate/extension test -- test/background.test.ts
pnpm --filter @screenmate/shared typecheck
pnpm --filter @screenmate/viewer-web typecheck
pnpm --filter @screenmate/extension typecheck
```

Expected: all three targeted suites pass and all three package typechecks exit with code `0`.

- [ ] **Step 5: Commit the real roster data flow**

Run:

```bash
git add packages/shared/src/signaling.ts packages/shared/test/signaling.test.ts apps/viewer-web/src/lib/session-state.ts apps/viewer-web/src/viewer-session.ts apps/extension/entrypoints/background/host-room-runtime.ts apps/extension/entrypoints/background.ts apps/extension/test/background.test.ts apps/viewer-web/test/viewer-session.test.ts
git commit -m "feat(realtime): add viewer profile and metrics signaling"
```

## Task 3: Replace Mock Chat With Real Signaling Chat

**Files:**
- Modify: `packages/shared/src/signaling.ts`
- Modify: `packages/shared/test/signaling.test.ts`
- Modify: `apps/viewer-web/src/viewer-session.ts`
- Modify: `apps/viewer-web/src/lib/session-state.ts`
- Modify: `apps/extension/entrypoints/background/host-room-runtime.ts`
- Modify: `apps/extension/entrypoints/background.ts`
- Modify: `apps/extension/entrypoints/popup/App.tsx`
- Modify: `apps/extension/entrypoints/popup/scene-adapter.ts`
- Modify: `apps/viewer-web/src/viewer-scene-adapter.ts`
- Modify: `apps/viewer-web/test/viewer-session.test.ts`
- Modify: `apps/extension/test/background.test.ts`

- [ ] **Step 1: Write the failing chat tests**

Add this shared signaling test:

```ts
it("accepts chat-message envelopes", () => {
  expect(
    signalEnvelopeSchema.safeParse({
      roomId: "room_demo",
      sessionId: "viewer_1",
      role: "viewer",
      messageType: "chat-message",
      timestamp: 12,
      payload: {
        text: "hello there",
      },
    }).success,
  ).toBe(true);
});
```

Add this viewer-session test:

```ts
it("stores inbound host chat messages in the session snapshot", async () => {
  const socket = new FakeWebSocket();
  const peer = new FakePeerConnection();
  const session = new ViewerSession({
    apiBaseUrl: "https://api.example",
    fetchFn: async () =>
      Response.json({
        roomId: "room_demo",
        sessionId: "viewer_1",
        viewerToken: "viewer-token",
        wsUrl: "ws://signal.example/rooms/room_demo/ws",
        iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }],
      }),
    createWebSocket: () => socket as never,
    createPeerConnection: () => peer as never,
  });

  await session.join("room_demo");
  socket.emitOpen();
  socket.emitMessage(
    JSON.stringify({
      roomId: "room_demo",
      sessionId: "host_1",
      role: "host",
      messageType: "chat-message",
      timestamp: 13,
      payload: { text: "Welcome!" },
    }),
  );

  expect(session.getSnapshot().chatMessages).toEqual([
    expect.objectContaining({ sender: "host_1", text: "Welcome!" }),
  ]);
});
```

Add this background runtime test:

```ts
it("stores popup chat messages from viewer chat envelopes", async () => {
  const runtime = {
    appendChatMessage: vi.fn(),
    getSnapshot: vi.fn().mockReturnValue(createHostRoomSnapshot()),
  };
  const forwardInboundSignal = createForwardInboundSignalHandler({
    runtime: runtime as never,
    sendTabMessage: vi.fn(),
  });

  forwardInboundSignal({
    roomId: "room_demo",
    sessionId: "viewer_1",
    role: "viewer",
    messageType: "chat-message",
    timestamp: 12,
    payload: { text: "Hello host" },
  } as never);

  expect(runtime.appendChatMessage).toHaveBeenCalledWith({
    id: "viewer_1:12",
    sender: "viewer_1",
    text: "Hello host",
    time: 12,
  });
});
```

- [ ] **Step 2: Run the failing chat suites**

Run:

```bash
pnpm --filter @screenmate/shared test -- test/signaling.test.ts
pnpm --filter @screenmate/viewer-web test -- test/viewer-session.test.ts
pnpm --filter @screenmate/extension test -- test/background.test.ts
```

Expected: FAIL because `chat-message` is not a valid signaling envelope and neither runtime stores chat history.

- [ ] **Step 3: Write the minimal real chat implementation**

Update `packages/shared/src/signaling.ts`:

```ts
const chatMessagePayloadSchema = z.object({
  text: z.string().min(1).max(500),
});

export const signalEnvelopeSchema = z.discriminatedUnion("messageType", [
  // keep existing envelopes,
  z.object({
    ...envelopeBaseSchema,
    role: signalingRoleSchema,
    messageType: z.literal("chat-message"),
    payload: chatMessagePayloadSchema,
  }),
]);
```

Update `apps/viewer-web/src/viewer-session.ts`:

```ts
sendChatMessage(text: string) {
  this.sendSignal({
    role: "viewer",
    messageType: "chat-message",
    payload: { text },
  });
  this.appendChatMessage({
    id: `${this.snapshot.sessionId}:${Date.now()}`,
    sender: this.snapshot.displayName,
    text,
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  });
}

private appendChatMessage(message: ViewerChatMessage) {
  this.snapshot = {
    ...this.snapshot,
    chatMessages: [...this.snapshot.chatMessages, message],
  };
  this.notify();
}

if (envelope.messageType === "chat-message") {
  this.appendChatMessage({
    id: `${envelope.sessionId}:${envelope.timestamp}`,
    sender: envelope.sessionId,
    text: envelope.payload.text,
    time: new Date(envelope.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  });
  return;
}
```

Update `apps/extension/entrypoints/background/host-room-runtime.ts`:

```ts
private readonly chatMessages: Array<{
  id: string;
  sender: string;
  text: string;
  time: number;
}> = [];

appendChatMessage(message: {
  id: string;
  sender: string;
  text: string;
  time: number;
}) {
  this.chatMessages.push(message);
}

getChatMessages() {
  return [...this.chatMessages];
}
```

Update `apps/extension/entrypoints/background.ts`:

```ts
if (envelope.messageType === "chat-message") {
  dependencies.runtime.appendChatMessage({
    id: `${envelope.sessionId}:${envelope.timestamp}`,
    sender: envelope.sessionId,
    text: envelope.payload.text,
    time: envelope.timestamp,
  });
  return;
}
```

- [ ] **Step 4: Run the real-chat test suites**

Run:

```bash
pnpm --filter @screenmate/shared test -- test/signaling.test.ts
pnpm --filter @screenmate/viewer-web test -- test/viewer-session.test.ts
pnpm --filter @screenmate/extension test -- test/background.test.ts
```

Expected: all targeted suites pass with chat envelopes accepted and chat snapshots updated.

- [ ] **Step 5: Commit the real chat flow**

Run:

```bash
git add packages/shared/src/signaling.ts packages/shared/test/signaling.test.ts apps/viewer-web/src/viewer-session.ts apps/viewer-web/src/lib/session-state.ts apps/extension/entrypoints/background/host-room-runtime.ts apps/extension/entrypoints/background.ts apps/viewer-web/test/viewer-session.test.ts apps/extension/test/background.test.ts
git commit -m "feat(chat): add realtime room chat"
```

## Task 4: Replace Mock Screen Mode With Real Tab-Capture Attachment

**Files:**
- Modify: `apps/extension/entrypoints/content/source-attachment.ts`
- Create: `apps/extension/entrypoints/content/screen-capture.ts`
- Modify: `apps/extension/entrypoints/background.ts`
- Modify: `apps/extension/entrypoints/popup/App.tsx`
- Modify: `apps/extension/test/source-attachment.test.ts`
- Modify: `apps/extension/test/background.test.ts`

- [ ] **Step 1: Write the failing screen-attach tests**

Add this source-attachment test:

```ts
it("attaches an arbitrary screen-capture stream and offers it to joined viewers", async () => {
  const runtime = createSourceAttachmentRuntime({
    onSignal: vi.fn(),
    onSourceDetached: vi.fn(),
    RTCPeerConnectionImpl: FakePeerConnection as never,
  });

  const stream = {
    getTracks: () => [{ addEventListener: vi.fn(), stop: vi.fn() }],
  } as unknown as MediaStream;

  const result = await runtime.attachNamedStream({
    roomId: "room_demo",
    sessionId: "host_1",
    sourceLabel: "Current tab",
    stream,
    viewerSessionIds: ["viewer_1"],
    iceServers: [],
  });

  expect(result.sourceLabel).toBe("Current tab");
});
```

Add this background routing test:

```ts
it("routes popup screen attach requests into the active content frame", async () => {
  const sendTabMessage = vi.fn().mockResolvedValue({
    sourceLabel: "Current tab",
    fingerprint: {
      primaryUrl: null,
      pageUrl: "https://example.com/watch",
      elementId: null,
      label: "Current tab",
      visibleIndex: -1,
    },
  });
  const handler = createHostMessageHandler(createHandlerDependencies({ sendTabMessage }));

  await handler({
    type: "screenmate:attach-screen",
    frameId: 0,
    streamId: "tab-stream-1",
  } as never);

  expect(sendTabMessage).toHaveBeenCalledWith(
    42,
    {
      type: "screenmate:attach-screen",
      streamId: "tab-stream-1",
      roomSession: expect.any(Object),
    },
    { frameId: 0 },
  );
});
```

- [ ] **Step 2: Run the failing screen-attach suites**

Run:

```bash
pnpm --filter @screenmate/extension test -- test/source-attachment.test.ts test/background.test.ts
```

Expected: FAIL because there is no generic stream attach API and no `screenmate:attach-screen` message.

- [ ] **Step 3: Write the minimal real tab-capture implementation**

Create `apps/extension/entrypoints/content/screen-capture.ts`:

```ts
export async function captureTabStream(streamId: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      } as never,
    },
  } as never);
}
```

Update `apps/extension/entrypoints/content/source-attachment.ts`:

```ts
async function attachNamedStream(input: {
  roomId: string;
  sessionId: string;
  sourceLabel: string;
  stream: MediaStream;
  viewerSessionIds: string[];
  iceServers: RTCIceServer[];
}) {
  const nextAttachment: Attachment = {
    roomId: input.roomId,
    sessionId: input.sessionId,
    sourceLabel: input.sourceLabel,
    stream: input.stream,
    iceServers: normalizeIceServers(input.iceServers) as RTCIceServer[],
    detachNotified: false,
  };
  teardownAttachment();
  attachment = nextAttachment;

  for (const viewerSessionId of input.viewerSessionIds) {
    await beginViewerNegotiation(viewerSessionId);
  }

  return {
    sourceLabel: input.sourceLabel,
    fingerprint: {
      primaryUrl: null,
      pageUrl: window.location.href,
      elementId: null,
      label: input.sourceLabel,
      visibleIndex: -1,
    },
  };
}

return {
  attachSource,
  attachNamedStream,
  beginViewerNegotiation,
  handleSignal,
  updateIceServers,
  destroy,
};
```

Update `apps/extension/entrypoints/background.ts` message contracts:

```ts
export type HostMessage =
  | { type: "screenmate:attach-screen"; frameId: number; streamId: string }
  // keep existing message types

type TabContentMessage =
  | {
      type: "screenmate:attach-screen";
      streamId: string;
      roomSession: NonNullable<ReturnType<HostRoomRuntime["getAttachSession"]>>;
    }
  // keep existing tab messages
```

Update popup container `apps/extension/entrypoints/popup/App.tsx` to request tab capture and send the new message:

```tsx
async function handleStartScreenSource() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return;
  }

  const streamId = await browser.tabCapture.getMediaStreamId({
    targetTabId: tab.id,
  });

  await browser.runtime.sendMessage({
    type: "screenmate:attach-screen",
    frameId: snapshot.activeFrameId ?? 0,
    streamId,
  });
}
```

- [ ] **Step 4: Run the screen-attach tests and extension typecheck**

Run:

```bash
pnpm --filter @screenmate/extension test -- test/source-attachment.test.ts test/background.test.ts
pnpm --filter @screenmate/extension typecheck
```

Expected: the screen-attach routing and generic-stream attach tests pass and extension typecheck exits with code `0`.

- [ ] **Step 5: Commit the real screen source flow**

Run:

```bash
git add apps/extension/entrypoints/content/source-attachment.ts apps/extension/entrypoints/content/screen-capture.ts apps/extension/entrypoints/background.ts apps/extension/entrypoints/popup/App.tsx apps/extension/test/source-attachment.test.ts apps/extension/test/background.test.ts
git commit -m "feat(extension): add real screen source mode"
```

## Task 5: Replace Mock Upload Mode With Real Uploaded-File Attachment

**Files:**
- Create: `apps/extension/entrypoints/content/uploaded-video-source.ts`
- Modify: `apps/extension/entrypoints/content/source-attachment.ts`
- Modify: `apps/extension/entrypoints/background.ts`
- Modify: `apps/extension/entrypoints/popup/App.tsx`
- Modify: `apps/extension/test/source-attachment.test.ts`
- Modify: `apps/extension/test/background.test.ts`

- [ ] **Step 1: Write the failing uploaded-file tests**

Add this source-attachment test:

```ts
it("captures an uploaded file through a hidden video element", async () => {
  const video = document.createElement("video");
  video.captureStream = vi.fn(() => ({
    getTracks: () => [{ addEventListener: vi.fn(), stop: vi.fn() }],
  }) as never);

  const { attachUploadedVideo } = await import("../entrypoints/content/uploaded-video-source");
  const result = await attachUploadedVideo({
    bytes: new Uint8Array([1, 2, 3]),
    mimeType: "video/mp4",
    fileName: "demo.mp4",
    targetDocument: document,
  });

  expect(result.sourceLabel).toBe("demo.mp4");
});
```

Add this background routing test:

```ts
it("routes popup uploaded-file attach requests into the active content frame", async () => {
  const sendTabMessage = vi.fn().mockResolvedValue({
    sourceLabel: "demo.mp4",
    fingerprint: {
      primaryUrl: null,
      pageUrl: "https://example.com/watch",
      elementId: null,
      label: "demo.mp4",
      visibleIndex: -1,
    },
  });
  const handler = createHostMessageHandler(createHandlerDependencies({ sendTabMessage }));

  await handler({
    type: "screenmate:attach-upload",
    frameId: 0,
    bytes: [1, 2, 3],
    mimeType: "video/mp4",
    fileName: "demo.mp4",
  } as never);

  expect(sendTabMessage).toHaveBeenCalledWith(
    42,
    {
      type: "screenmate:attach-upload",
      bytes: [1, 2, 3],
      mimeType: "video/mp4",
      fileName: "demo.mp4",
      roomSession: expect.any(Object),
    },
    { frameId: 0 },
  );
});
```

- [ ] **Step 2: Run the failing upload-mode suites**

Run:

```bash
pnpm --filter @screenmate/extension test -- test/source-attachment.test.ts test/background.test.ts
```

Expected: FAIL because `uploaded-video-source.ts` and `screenmate:attach-upload` do not exist.

- [ ] **Step 3: Write the minimal uploaded-file implementation**

Create `apps/extension/entrypoints/content/uploaded-video-source.ts`:

```ts
export async function attachUploadedVideo(input: {
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
  targetDocument: Document;
}) {
  const blob = new Blob([input.bytes], { type: input.mimeType });
  const url = URL.createObjectURL(blob);
  const video = input.targetDocument.createElement("video");

  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.style.display = "none";
  input.targetDocument.body.appendChild(video);
  await video.play();

  return {
    sourceLabel: input.fileName,
    stream: video.captureStream(),
    dispose() {
      video.pause();
      video.remove();
      URL.revokeObjectURL(url);
    },
  };
}
```

Update `apps/extension/entrypoints/background.ts`:

```ts
export type HostMessage =
  | {
      type: "screenmate:attach-upload";
      frameId: number;
      bytes: number[];
      mimeType: string;
      fileName: string;
    }
  // keep existing message types

type TabContentMessage =
  | {
      type: "screenmate:attach-upload";
      bytes: number[];
      mimeType: string;
      fileName: string;
      roomSession: NonNullable<ReturnType<HostRoomRuntime["getAttachSession"]>>;
    }
  // keep existing tab messages
```

Update popup container `apps/extension/entrypoints/popup/App.tsx` to turn a selected file into a runtime message:

```tsx
async function handleUploadSelected(file: File) {
  const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
  await browser.runtime.sendMessage({
    type: "screenmate:attach-upload",
    frameId: snapshot.activeFrameId ?? 0,
    bytes,
    mimeType: file.type || "video/mp4",
    fileName: file.name,
  });
}
```

Update `apps/extension/entrypoints/content/source-attachment.ts` to reuse `attachNamedStream` for uploaded streams:

```ts
const upload = await attachUploadedVideo({
  bytes: new Uint8Array(message.bytes),
  mimeType: message.mimeType,
  fileName: message.fileName,
  targetDocument: document,
});

await runtime.attachNamedStream({
  roomId: message.roomSession.roomId,
  sessionId: message.roomSession.sessionId,
  sourceLabel: upload.sourceLabel,
  stream: upload.stream,
  viewerSessionIds: message.roomSession.viewerSessionIds,
  iceServers: message.roomSession.iceServers,
});
```

- [ ] **Step 4: Run the upload-mode tests and full extension typecheck**

Run:

```bash
pnpm --filter @screenmate/extension test -- test/source-attachment.test.ts test/background.test.ts
pnpm --filter @screenmate/extension typecheck
```

Expected: uploaded-file routing and media-source tests pass and extension typecheck exits with code `0`.

- [ ] **Step 5: Commit the real upload source flow**

Run:

```bash
git add apps/extension/entrypoints/content/uploaded-video-source.ts apps/extension/entrypoints/content/source-attachment.ts apps/extension/entrypoints/background.ts apps/extension/entrypoints/popup/App.tsx apps/extension/test/source-attachment.test.ts apps/extension/test/background.test.ts
git commit -m "feat(extension): add real upload source mode"
```
