# ScreenMate Room Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace mock viewer identity, connection details, and chat with room-scoped real activity state backed by the signaling Durable Object.

**Architecture:** Extend the shared signaling schema with room activity envelopes, then make `RoomObject` store and broadcast viewer roster and chat history. Viewer web and extension runtime consume the same activity feed and route chat/profile/metrics through the existing WebSocket, leaving media negotiation behavior intact.

**Tech Stack:** TypeScript, Zod, Hono, Cloudflare Workers Durable Objects, WXT MV3, React 19, Zustand, Vitest, WebSocket signaling, WebRTC stats

---

## Scope Boundary

This plan implements the approved room activity slice from `docs/superpowers/specs/2026-04-25-screenmate-room-activity-design.md`.

Included:

- Real viewer display names with random default and editable updates.
- Real room roster with online state, connection type, and optional ping.
- Real two-way chat between viewer web and extension popup.
- Durable Object storage for current room roster metadata and the latest 100 chat messages.

Excluded:

- Password-gated rooms.
- Real screen-share source attachment.
- Real uploaded-file source attachment.
- Content-page floating chat as a real chat client.
- Long-term chat storage outside the room Durable Object.

## File Structure

- Modify: `packages/shared/src/signaling.ts`
  - Add room activity envelope schemas and exported type aliases.
- Modify: `packages/shared/test/signaling.test.ts`
  - Cover valid and invalid activity envelopes.
- Modify: `apps/server/src/do/room-object.ts`
  - Fix socket replacement close races, add persisted room activity state, validation, canonical chat creation, roster/history broadcasts.
- Modify: `apps/server/test/room-object.test.ts`
  - Cover profile, metrics, chat, history replay, and offline roster behavior.
- Modify: `apps/viewer-web/src/lib/peer-client.ts`
  - Expose a small metrics sampler around `RTCPeerConnection.getStats()`.
- Modify: `apps/viewer-web/src/lib/socket-client.ts`
  - Return send success, avoid sending on closed sockets, and redact token-bearing WebSocket URLs in logs.
- Modify: `apps/viewer-web/src/lib/session-state.ts`
  - Add viewer display name, roster, chat, and local metrics state.
- Modify: `apps/viewer-web/src/viewer-session.ts`
  - Send profile, metrics, and chat envelopes; consume roster/history/chat.
- Modify: `apps/viewer-web/src/viewer-scene-model.ts`
  - Keep the existing viewer shell contract but source sidebar fields from real state.
- Modify: `apps/viewer-web/src/viewer-scene-adapter.ts`
  - Map real room activity to sidebar messages, viewer count, connection labels, and username.
- Modify: `apps/viewer-web/src/App.tsx`
  - Keep random initial name, wire rename and chat send through `ViewerSession`.
- Modify: `apps/viewer-web/src/components/ViewerShell.tsx`
  - Add editable display-name input that calls the session rename handler.
- Modify: `apps/viewer-web/test/viewer-session.test.ts`
  - Cover profile send, chat send, roster/history receive, and metrics.
- Modify: `apps/viewer-web/test/peer-client.test.ts`
  - Cover direct, relay, unknown, and RTT-missing metrics sampling.
- Modify: `apps/viewer-web/test/viewer-scene-adapter.test.ts`
  - Cover real activity replacing mock sidebar values.
- Modify: `apps/extension/entrypoints/background/host-room-snapshot.ts`
  - Add roster and chat fields to persisted session and snapshot.
- Modify: `apps/extension/entrypoints/background/host-room-runtime.ts`
  - Store incoming roster/history/chat and send host chat messages.
- Modify: `apps/extension/entrypoints/background.ts`
  - Add popup message routing for host chat.
- Modify: `apps/extension/entrypoints/popup/scene-adapter.ts`
  - Prefer real snapshot roster/chat over mock state.
- Modify: `apps/extension/entrypoints/popup/scene-model.ts`
  - Carry viewer online/offline presence into popup roster rows.
- Modify: `apps/extension/entrypoints/popup/App.tsx`
  - Route popup chat sends through background when a room is active.
- Modify: `apps/extension/entrypoints/popup/useHostControls.ts`
  - Preserve activity fields when normalizing snapshots and refresh open popups after activity updates.
- Modify: `apps/extension/test/background/host-room-runtime.test.ts`
  - Cover storing roster/history/chat and sending host chat.
- Modify: `apps/extension/test/background/background.test.ts`
  - Cover popup chat message routing.
- Modify: `apps/extension/test/popup/scene-adapter.test.ts`
  - Cover real roster/chat overriding mock rows.

## Shared Types

Use these shared concepts consistently across tasks:

```ts
type RoomConnectionType = "direct" | "relay" | "unknown";

type ViewerRosterEntry = {
  viewerSessionId: string;
  displayName: string;
  online: boolean;
  connectionType: RoomConnectionType;
  pingMs: number | null;
  joinedAt: number;
  profileUpdatedAt: number | null;
  metricsUpdatedAt: number | null;
};

type RoomChatMessage = {
  messageId: string;
  senderSessionId: string;
  senderRole: "host" | "viewer";
  senderName: string;
  text: string;
  sentAt: number;
};
```

Use the exact string labels `direct`, `relay`, and `unknown` in protocol payloads. UI adapters can translate them to `P2P`, `Relay`, or `--`.

Use `chat-message` only for client chat requests and `chat-message-created` only for server-authored canonical chat broadcasts. Do not put optional canonical sender fields on `chat-message`; that hides malformed server events.

---

## Task 1: Add Shared Room Activity Signaling Schemas

**Files:**

- Modify: `packages/shared/src/signaling.ts`
- Modify: `packages/shared/test/signaling.test.ts`

- [ ] **Step 1: Write failing shared schema tests**

Add these tests to `packages/shared/test/signaling.test.ts` inside `describe("signalEnvelopeSchema", ...)`:

```ts
  it("accepts room activity envelopes", () => {
    expect(
      signalEnvelopeSchema.safeParse({
        roomId: "room_123",
        sessionId: "viewer_1",
        role: "viewer",
        messageType: "viewer-profile",
        timestamp: 1,
        payload: {
          viewerSessionId: "viewer_1",
          displayName: "Mina",
        },
      }).success,
    ).toBe(true);

    expect(
      signalEnvelopeSchema.safeParse({
        roomId: "room_123",
        sessionId: "viewer_1",
        role: "viewer",
        messageType: "viewer-metrics",
        timestamp: 2,
        payload: {
          viewerSessionId: "viewer_1",
          connectionType: "relay",
          pingMs: 142,
        },
      }).success,
    ).toBe(true);

    expect(
      signalEnvelopeSchema.safeParse({
        roomId: "room_123",
        sessionId: "viewer_1",
        role: "viewer",
        messageType: "chat-message",
        timestamp: 3,
        payload: {
          text: "hello room",
        },
      }).success,
    ).toBe(true);

    expect(
      signalEnvelopeSchema.safeParse({
        roomId: "room_123",
        sessionId: "host_1",
        role: "host",
        messageType: "viewer-roster",
        timestamp: 4,
        payload: {
          viewers: [
            {
              viewerSessionId: "viewer_1",
              displayName: "Mina",
              online: true,
              connectionType: "direct",
              pingMs: 24,
              joinedAt: 1,
              profileUpdatedAt: 2,
              metricsUpdatedAt: 3,
            },
          ],
        },
      }).success,
    ).toBe(true);

    expect(
      signalEnvelopeSchema.safeParse({
        roomId: "room_123",
        sessionId: "host_1",
        role: "host",
        messageType: "chat-history",
        timestamp: 5,
        payload: {
          messages: [
            {
              messageId: "msg_1",
              senderSessionId: "viewer_1",
              senderRole: "viewer",
              senderName: "Mina",
              text: "hello room",
              sentAt: 3,
            },
          ],
        },
      }).success,
    ).toBe(true);

    expect(
      signalEnvelopeSchema.safeParse({
        roomId: "room_123",
        sessionId: "host_1",
        role: "host",
        messageType: "chat-message-created",
        timestamp: 6,
        payload: {
          messageId: "msg_1",
          senderSessionId: "viewer_1",
          senderRole: "viewer",
          senderName: "Mina",
          text: "hello room",
          sentAt: 3,
        },
      }).success,
    ).toBe(true);
  });

  it("rejects invalid room activity payloads", () => {
    expect(
      signalEnvelopeSchema.safeParse({
        roomId: "room_123",
        sessionId: "viewer_1",
        role: "viewer",
        messageType: "viewer-profile",
        timestamp: 1,
        payload: {
          viewerSessionId: "",
          displayName: "",
        },
      }).success,
    ).toBe(false);

    expect(
      signalEnvelopeSchema.safeParse({
        roomId: "room_123",
        sessionId: "viewer_1",
        role: "viewer",
        messageType: "viewer-metrics",
        timestamp: 2,
        payload: {
          viewerSessionId: "viewer_1",
          connectionType: "satellite",
          pingMs: -1,
        },
      }).success,
    ).toBe(false);

    expect(
      signalEnvelopeSchema.safeParse({
        roomId: "room_123",
        sessionId: "host_1",
        role: "host",
        messageType: "chat-message",
        timestamp: 3,
        payload: {
          text: "x".repeat(501),
        },
      }).success,
    ).toBe(false);

    expect(
      signalEnvelopeSchema.safeParse({
        roomId: "room_123",
        sessionId: "host_1",
        role: "host",
        messageType: "chat-message-created",
        timestamp: 4,
        payload: {
          messageId: "msg_1",
          text: "missing sender fields",
        },
      }).success,
    ).toBe(false);
  });
```

- [ ] **Step 2: Run the failing shared tests**

Run:

```bash
pnpm --filter @screenmate/shared test -- test/signaling.test.ts
```

Expected: FAIL because `viewer-profile`, `viewer-metrics`, `chat-message`, `chat-message-created`, `viewer-roster`, and `chat-history` are not in `signalEnvelopeSchema`.

- [ ] **Step 3: Implement shared activity schemas**

Update `packages/shared/src/signaling.ts` with these schemas near the existing payload schemas:

```ts
export const roomConnectionTypeSchema = z.enum(["direct", "relay", "unknown"]);

export const viewerRosterEntrySchema = z.object({
  viewerSessionId: z.string().min(1),
  displayName: z.string().trim().min(1).max(80),
  online: z.boolean(),
  connectionType: roomConnectionTypeSchema,
  pingMs: z.number().int().nonnegative().nullable(),
  joinedAt: z.number().int().nonnegative(),
  profileUpdatedAt: z.number().int().nonnegative().nullable(),
  metricsUpdatedAt: z.number().int().nonnegative().nullable(),
});

export const roomChatMessageSchema = z.object({
  messageId: z.string().min(1),
  senderSessionId: z.string().min(1),
  senderRole: signalingRoleSchema,
  senderName: z.string().trim().min(1).max(80),
  text: z.string().trim().min(1).max(500),
  sentAt: z.number().int().nonnegative(),
});

const viewerProfilePayloadSchema = z.object({
  viewerSessionId: z.string().min(1),
  displayName: z.string().trim().min(1).max(80),
});

const viewerMetricsPayloadSchema = z.object({
  viewerSessionId: z.string().min(1),
  connectionType: roomConnectionTypeSchema,
  pingMs: z.number().int().nonnegative().nullable().optional(),
});

const chatMessagePayloadSchema = z.object({
  clientMessageId: z.string().min(1).max(120).optional(),
  text: z.string().trim().min(1).max(500),
});

const chatMessageCreatedPayloadSchema = roomChatMessageSchema;

const viewerRosterPayloadSchema = z.object({
  viewers: z.array(viewerRosterEntrySchema),
});

const chatHistoryPayloadSchema = z.object({
  messages: z.array(roomChatMessageSchema).max(100),
});
```

Add these variants to the `z.discriminatedUnion("messageType", [...])` list:

```ts
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
  z.object({
    ...envelopeBaseSchema,
    role: signalingRoleSchema,
    messageType: z.literal("chat-message"),
    payload: chatMessagePayloadSchema,
  }),
  z.object({
    ...envelopeBaseSchema,
    role: z.literal("host"),
    messageType: z.literal("chat-message-created"),
    payload: chatMessageCreatedPayloadSchema,
  }),
  z.object({
    ...envelopeBaseSchema,
    role: z.literal("host"),
    messageType: z.literal("viewer-roster"),
    payload: viewerRosterPayloadSchema,
  }),
  z.object({
    ...envelopeBaseSchema,
    role: z.literal("host"),
    messageType: z.literal("chat-history"),
    payload: chatHistoryPayloadSchema,
  }),
```

Export type aliases at the end of the file:

```ts
export type RoomConnectionType = z.infer<typeof roomConnectionTypeSchema>;
export type ViewerRosterEntry = z.infer<typeof viewerRosterEntrySchema>;
export type RoomChatMessage = z.infer<typeof roomChatMessageSchema>;
export type SignalEnvelope = z.infer<typeof signalEnvelopeSchema>;
```

- [ ] **Step 4: Run shared tests and typecheck**

Run:

```bash
pnpm --filter @screenmate/shared test -- test/signaling.test.ts
pnpm --filter @screenmate/shared typecheck
```

Expected: both commands PASS.

- [ ] **Step 5: Commit shared schema changes**

Run:

```bash
git add packages/shared/src/signaling.ts packages/shared/test/signaling.test.ts
git commit -m "feat(shared): add room activity signaling"
```

Expected: commit succeeds.

---

## Task 2: Store And Broadcast Room Activity In The Durable Object

**Files:**

- Modify: `apps/server/src/do/room-object.ts`
- Modify: `apps/server/test/room-object.test.ts`

- [ ] **Step 1: Write failing socket replacement tests**

Add these tests to `apps/server/test/room-object.test.ts` before the room activity tests:

```ts
  it("ignores stale viewer close events after the same session reconnects", async () => {
    const { state } = createDurableObjectState();
    const roomObject = new RoomObject(state, {} as never);
    await initializeRoomObject(roomObject);
    const roomState = getRoomStateInstance(roomObject);
    const firstViewer = createSocketPair();
    const secondViewer = createSocketPair();
    const host = createSocketPair();

    roomState.connectSession({
      roomId: "room_demo",
      role: "host",
      sessionId: "host_1",
      socket: host.server,
    });
    roomState.connectSession({
      roomId: "room_demo",
      role: "viewer",
      sessionId: "viewer_1",
      socket: firstViewer.server,
    });
    roomState.connectSession({
      roomId: "room_demo",
      role: "viewer",
      sessionId: "viewer_1",
      socket: secondViewer.server,
    });

    firstViewer.server.close(1012, "viewer-replaced");

    expect(roomState.getStateSnapshot().viewerCount).toBe(1);
    expect(
      host.client.messages.filter(
        (message) =>
          (message as { messageType?: string }).messageType === "viewer-left",
      ),
    ).toHaveLength(0);
  });

  it("ignores stale host close events after the host reconnects", async () => {
    const { state } = createDurableObjectState();
    const roomObject = new RoomObject(state, {} as never);
    await initializeRoomObject(roomObject);
    const roomState = getRoomStateInstance(roomObject);
    const firstHost = createSocketPair();
    const secondHost = createSocketPair();

    roomState.connectSession({
      roomId: "room_demo",
      role: "host",
      sessionId: "host_1",
      socket: firstHost.server,
    });
    roomState.connectSession({
      roomId: "room_demo",
      role: "host",
      sessionId: "host_1",
      socket: secondHost.server,
    });

    firstHost.server.close(1012, "host-replaced");

    expect(roomState.getStateSnapshot().state).not.toBe("closed");
    expect(roomState.getStateSnapshot().hostConnected).toBe(true);
  });
```

- [ ] **Step 2: Run the failing socket replacement tests**

Run:

```bash
pnpm --filter @screenmate/cloudflare test -- test/room-object.test.ts
```

Expected: FAIL because `disconnectSession(sessionId, role)` clears by session id, so a stale close event can clear the replacement connection.

- [ ] **Step 3: Fix socket replacement close handling**

Change `disconnectSession` in `apps/server/src/do/room-object.ts` to take the connection object:

```ts
  disconnectSession(connection: RoomConnection) {
    const { role, sessionId } = connection;

    if (role === "host") {
      if (this.hostConnection !== connection) {
        return;
      }

      this.hostConnection = null;
      void this.closeRoom("host-left");
      return;
    }

    if (this.viewers.get(sessionId) !== connection) {
      return;
    }

    this.viewers.delete(sessionId);
    this.broadcast(this.viewerPresenceEnvelope("viewer-left", sessionId));
    this.broadcast(this.roomStateEnvelope());
  }
```

Update the WebSocket close listener in `RoomObject.handleWebSocket()` so it passes the original connection object:

```ts
    server.addEventListener("close", () => {
      roomState.disconnectSession(connection);
    });
```

Keep any direct unit-test calls aligned with the new signature.

- [ ] **Step 4: Run the socket replacement tests**

Run:

```bash
pnpm --filter @screenmate/cloudflare test -- test/room-object.test.ts
```

Expected: PASS for the new replacement tests and existing room lifecycle tests.

- [ ] **Step 5: Write failing RoomObject activity tests**

Add this helper below `createSocketPair()` in `apps/server/test/room-object.test.ts`:

```ts
async function initializeRoomObject(roomObject: RoomObject) {
  await roomObject.fetch(
    new Request("https://room.internal/internal/initialize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        roomId: "room_demo",
        hostSessionId: "host_1",
        createdAt: 0,
        expiresAt: 3_600_000,
        maxExpiresAt: 43_200_000,
      }),
    }),
  );
}

function connectTestSocket(
  roomState: RoomState,
  input: {
    role: "host" | "viewer";
    sessionId: string;
    client: TestSocket;
  },
) {
  const server = createSocketPair().server;
  server.setPeer(input.client);
  input.client.setPeer(server);
  const connection = {
    roomId: "room_demo",
    role: input.role,
    sessionId: input.sessionId,
    socket: server,
  };
  roomState.connectSession(connection);
  return connection;
}

function getRoomStateInstance(roomObject: RoomObject) {
  return (roomObject as unknown as { roomState: RoomState }).roomState;
}

async function sendEnvelope(
  roomState: RoomState,
  input: {
    role: "host" | "viewer";
    sessionId: string;
    connection: {
      roomId: string;
      role: "host" | "viewer";
      sessionId: string;
      socket: TestSocket;
    };
    messageType: string;
    payload: Record<string, unknown>;
    timestamp?: number;
  },
) {
  await roomState.handleSocketMessage(
    input.connection,
    JSON.stringify({
      roomId: "room_demo",
      sessionId: input.sessionId,
      role: input.role,
      messageType: input.messageType,
      timestamp: input.timestamp ?? 100,
      payload: input.payload,
    }),
  );
}
```

Add these tests inside `describe("RoomObject", ...)`:

```ts
  it("stores viewer profile and metrics and broadcasts roster snapshots", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      const { state } = createDurableObjectState();
      const roomObject = new RoomObject(state, {} as never);
      await initializeRoomObject(roomObject);
      const roomState = getRoomStateInstance(roomObject);
      const host = createSocketPair().client;
      const viewer = createSocketPair().client;

      connectTestSocket(roomState, {
        role: "host",
        sessionId: "host_1",
        client: host,
      });
      const viewerConnection = connectTestSocket(roomState, {
        role: "viewer",
        sessionId: "viewer_1",
        client: viewer,
      });

      await sendEnvelope(roomState, {
        role: "viewer",
        sessionId: "viewer_1",
        connection: viewerConnection,
        messageType: "viewer-profile",
        payload: {
          viewerSessionId: "viewer_1",
          displayName: "Mina",
        },
      });
      await sendEnvelope(roomState, {
        role: "viewer",
        sessionId: "viewer_1",
        connection: viewerConnection,
        messageType: "viewer-metrics",
        payload: {
          viewerSessionId: "viewer_1",
          connectionType: "relay",
          pingMs: 142,
        },
      });

      const rosters = host.messages.filter(
        (message) =>
          (message as { messageType?: string }).messageType === "viewer-roster",
      );
      expect(rosters.at(-1)).toMatchObject({
        messageType: "viewer-roster",
        payload: {
          viewers: [
            {
              viewerSessionId: "viewer_1",
              displayName: "Mina",
              online: true,
              connectionType: "relay",
              pingMs: 142,
            },
          ],
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("canonicalizes chat messages and replays chat history to new connections", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(2_000);
      const { state } = createDurableObjectState();
      const roomObject = new RoomObject(state, {} as never);
      await initializeRoomObject(roomObject);
      const roomState = getRoomStateInstance(roomObject);
      const host = createSocketPair().client;
      const viewer = createSocketPair().client;

      connectTestSocket(roomState, {
        role: "host",
        sessionId: "host_1",
        client: host,
      });
      const viewerConnection = connectTestSocket(roomState, {
        role: "viewer",
        sessionId: "viewer_1",
        client: viewer,
      });
      await sendEnvelope(roomState, {
        role: "viewer",
        sessionId: "viewer_1",
        connection: viewerConnection,
        messageType: "viewer-profile",
        payload: {
          viewerSessionId: "viewer_1",
          displayName: "Mina",
        },
      });
      await sendEnvelope(roomState, {
        role: "viewer",
        sessionId: "viewer_1",
        connection: viewerConnection,
        messageType: "chat-message",
        payload: {
          text: "  hello host  ",
        },
      });

      expect(host.messages.at(-1)).toMatchObject({
        messageType: "chat-message-created",
        payload: {
          senderSessionId: "viewer_1",
          senderRole: "viewer",
          senderName: "Mina",
          text: "hello host",
          sentAt: 2_000,
        },
      });

      const secondViewer = createSocketPair().client;
      connectTestSocket(roomState, {
        role: "viewer",
        sessionId: "viewer_2",
        client: secondViewer,
      });

      expect(
        secondViewer.messages.find(
          (message) =>
            (message as { messageType?: string }).messageType === "chat-history",
        ),
      ).toMatchObject({
        messageType: "chat-history",
        payload: {
          messages: [
            {
              senderSessionId: "viewer_1",
              senderRole: "viewer",
              senderName: "Mina",
              text: "hello host",
            },
          ],
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks disconnected viewers offline while keeping their profile", async () => {
    const { state } = createDurableObjectState();
    const roomObject = new RoomObject(state, {} as never);
    await initializeRoomObject(roomObject);
    const roomState = getRoomStateInstance(roomObject);
    const host = createSocketPair().client;
    const viewer = createSocketPair().client;

    connectTestSocket(roomState, {
      role: "host",
      sessionId: "host_1",
      client: host,
    });
    const viewerConnection = connectTestSocket(roomState, {
      role: "viewer",
      sessionId: "viewer_1",
      client: viewer,
    });
    await sendEnvelope(roomState, {
      role: "viewer",
      sessionId: "viewer_1",
      connection: viewerConnection,
      messageType: "viewer-profile",
      payload: {
        viewerSessionId: "viewer_1",
        displayName: "Mina",
      },
    });

    roomState.disconnectSession(viewerConnection);

    expect(host.messages.at(-1)).toMatchObject({
      messageType: "viewer-roster",
      payload: {
        viewers: [
          {
            viewerSessionId: "viewer_1",
            displayName: "Mina",
            online: false,
          },
        ],
      },
    });
  });

  it("replays persisted room activity after Durable Object reload", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(3_000);
      const { state } = createDurableObjectState();
      const roomObject = new RoomObject(state, {} as never);
      await initializeRoomObject(roomObject);
      const roomState = getRoomStateInstance(roomObject);
      const viewer = createSocketPair().client;
      const viewerConnection = connectTestSocket(roomState, {
        role: "viewer",
        sessionId: "viewer_1",
        client: viewer,
      });

      await sendEnvelope(roomState, {
        role: "viewer",
        sessionId: "viewer_1",
        connection: viewerConnection,
        messageType: "viewer-profile",
        payload: {
          viewerSessionId: "viewer_1",
          displayName: "Mina",
        },
      });
      await sendEnvelope(roomState, {
        role: "viewer",
        sessionId: "viewer_1",
        connection: viewerConnection,
        messageType: "chat-message",
        payload: { text: "persist me" },
      });

      const freshRoomObject = new RoomObject(state, {} as never);
      await freshRoomObject.fetch(
        new Request("https://room.internal/internal/state", { method: "GET" }),
      );
      const freshRoomState = getRoomStateInstance(freshRoomObject);
      const host = createSocketPair().client;
      connectTestSocket(freshRoomState, {
        role: "host",
        sessionId: "host_1",
        client: host,
      });

      expect(
        host.messages.find(
          (message) =>
            (message as { messageType?: string }).messageType === "viewer-roster",
        ),
      ).toMatchObject({
        payload: {
          viewers: [
            expect.objectContaining({
              viewerSessionId: "viewer_1",
              displayName: "Mina",
            }),
          ],
        },
      });
      expect(
        host.messages.find(
          (message) =>
            (message as { messageType?: string }).messageType === "chat-history",
        ),
      ).toMatchObject({
        payload: {
          messages: [expect.objectContaining({ text: "persist me" })],
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects viewer activity for a different viewer session", async () => {
    const { state } = createDurableObjectState();
    const roomObject = new RoomObject(state, {} as never);
    await initializeRoomObject(roomObject);
    const roomState = getRoomStateInstance(roomObject);
    const viewer = createSocketPair().client;
    const viewerConnection = connectTestSocket(roomState, {
      role: "viewer",
      sessionId: "viewer_1",
      client: viewer,
    });

    await sendEnvelope(roomState, {
      role: "viewer",
      sessionId: "viewer_1",
      connection: viewerConnection,
      messageType: "viewer-profile",
      payload: {
        viewerSessionId: "viewer_2",
        displayName: "Mina",
      },
    });

    expect(viewer.closeReason).toBe("session-mismatch");
  });

  it("rejects server-authored activity envelopes from clients", async () => {
    const { state } = createDurableObjectState();
    const roomObject = new RoomObject(state, {} as never);
    await initializeRoomObject(roomObject);
    const roomState = getRoomStateInstance(roomObject);
    const viewer = createSocketPair().client;
    const viewerConnection = connectTestSocket(roomState, {
      role: "viewer",
      sessionId: "viewer_1",
      client: viewer,
    });

    await sendEnvelope(roomState, {
      role: "viewer",
      sessionId: "viewer_1",
      connection: viewerConnection,
      messageType: "chat-message-created",
      payload: {
        messageId: "msg_1",
        senderSessionId: "viewer_1",
        senderRole: "viewer",
        senderName: "Mina",
        text: "spoofed",
        sentAt: 1,
      },
    });

    expect(viewer.closeReason).toBe("message-type-not-allowed");
  });

  it("ignores empty chat without broadcasting or persisting", async () => {
    const { state } = createDurableObjectState();
    const roomObject = new RoomObject(state, {} as never);
    await initializeRoomObject(roomObject);
    const roomState = getRoomStateInstance(roomObject);
    const host = createSocketPair().client;
    const hostConnection = connectTestSocket(roomState, {
      role: "host",
      sessionId: "host_1",
      client: host,
    });

    await sendEnvelope(roomState, {
      role: "host",
      sessionId: "host_1",
      connection: hostConnection,
      messageType: "chat-message",
      payload: { text: "   " },
    });

    expect(
      host.messages.some(
        (message) =>
          (message as { messageType?: string }).messageType ===
          "chat-message-created",
      ),
    ).toBe(false);
  });

  it("normalizes malformed persisted activity before sending snapshots", async () => {
    const { state } = createDurableObjectState();
    const roomObject = new RoomObject(state, {} as never);
    await initializeRoomObject(roomObject);
    await state.storage.put("room-activity", {
      viewerProfiles: [{ viewerSessionId: "viewer_1", displayName: "Mina" }],
      viewerMetrics: [{ viewerSessionId: "viewer_1", connectionType: "relay" }],
      chatMessages: [{ text: "missing canonical fields" }],
    });

    const freshRoomObject = new RoomObject(state, {} as never);
    await freshRoomObject.fetch(
      new Request("https://room.internal/internal/state", { method: "GET" }),
    );
    const freshRoomState = getRoomStateInstance(freshRoomObject);
    const host = createSocketPair().client;

    expect(() =>
      connectTestSocket(freshRoomState, {
        role: "host",
        sessionId: "host_1",
        client: host,
      }),
    ).not.toThrow();
  });

  it("caps chat history replay to the latest 100 messages", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(4_000);
      const { state } = createDurableObjectState();
      const roomObject = new RoomObject(state, {} as never);
      await initializeRoomObject(roomObject);
      const roomState = getRoomStateInstance(roomObject);
      const host = createSocketPair().client;
      const hostConnection = connectTestSocket(roomState, {
        role: "host",
        sessionId: "host_1",
        client: host,
      });

      for (let i = 0; i < 101; i += 1) {
        await sendEnvelope(roomState, {
          role: "host",
          sessionId: "host_1",
          connection: hostConnection,
          messageType: "chat-message",
          payload: { text: `message ${i}` },
        });
      }

      const viewer = createSocketPair().client;
      connectTestSocket(roomState, {
        role: "viewer",
        sessionId: "viewer_1",
        client: viewer,
      });
      const history = viewer.messages.find(
        (message) =>
          (message as { messageType?: string }).messageType === "chat-history",
      ) as { payload: { messages: Array<{ text: string; messageId: string }> } };

      expect(history.payload.messages).toHaveLength(100);
      expect(history.payload.messages[0]!.text).toBe("message 1");
      expect(new Set(history.payload.messages.map((message) => message.messageId)).size).toBe(100);
    } finally {
      vi.useRealTimers();
    }
  });
```

- [ ] **Step 6: Run the failing RoomObject tests**

Run:

```bash
pnpm --filter @screenmate/cloudflare test -- test/room-object.test.ts
```

Expected: FAIL because activity envelopes are not handled and no roster/history envelopes exist.

- [ ] **Step 7: Add room activity state to `RoomState`**

Modify `apps/server/src/do/room-object.ts` imports:

```ts
import {
  errorCodes,
  roomChatMessageSchema,
  signalEnvelopeSchema,
  type RoomChatMessage,
  type RoomSourceState,
  type ViewerRosterEntry,
} from "@screenmate/shared";
```

Add these types near the existing type definitions:

```ts
type RoomConnectionType = ViewerRosterEntry["connectionType"];

type PersistedRoomActivity = {
  viewerProfiles: Array<{
    viewerSessionId: string;
    displayName: string;
    joinedAt: number;
    profileUpdatedAt: number | null;
  }>;
  viewerMetrics: Array<{
    viewerSessionId: string;
    connectionType: RoomConnectionType;
    pingMs: number | null;
    metricsUpdatedAt: number;
  }>;
  chatMessages: RoomChatMessage[];
};

type ViewerProfileRecord = {
  viewerSessionId: string;
  displayName: string;
  joinedAt: number;
  profileUpdatedAt: number | null;
};

type ViewerMetricsRecord = {
  viewerSessionId: string;
  connectionType: RoomConnectionType;
  pingMs: number | null;
  metricsUpdatedAt: number;
};
```

Add a storage key:

```ts
const ROOM_ACTIVITY_KEY = "room-activity";
const CHAT_HISTORY_LIMIT = 100;
const MAX_RETAINED_VIEWERS = 50;
const MIN_METRICS_INTERVAL_MS = 3_000;
const MIN_PROFILE_UPDATE_INTERVAL_MS = 1_000;
const MIN_CHAT_INTERVAL_MS = 500;
```

Use these as small abuse budgets. Over-rate metrics should be dropped without closing the socket; over-rate chat/profile updates can be ignored or closed only when the payload itself is malformed.

Add activity fields to `RoomState`:

```ts
  private readonly viewerProfiles = new Map<string, ViewerProfileRecord>();
  private readonly viewerMetrics = new Map<string, ViewerMetricsRecord>();
  private chatMessages: RoomChatMessage[] = [];
  private activityPersistQueue = Promise.resolve();
```

Change the `RoomState` constructor options to include activity persistence:

```ts
      activity?: PersistedRoomActivity | null;
      onPersistActivity?: (activity: PersistedRoomActivity) => void | Promise<void>;
```

Inside the constructor body, hydrate persisted activity:

```ts
    for (const profile of this.options.activity?.viewerProfiles ?? []) {
      this.viewerProfiles.set(profile.viewerSessionId, profile);
    }
    for (const metrics of this.options.activity?.viewerMetrics ?? []) {
      this.viewerMetrics.set(metrics.viewerSessionId, metrics);
    }
    this.chatMessages = [...(this.options.activity?.chatMessages ?? [])].slice(
      -CHAT_HISTORY_LIMIT,
    );
```

- [ ] **Step 8: Broadcast snapshots on connect and disconnect**

In `connectSession`, after sending `roomStateEnvelope()` to host and viewer, also send activity snapshots:

```ts
      this.send(connection, this.viewerRosterEnvelope());
      this.send(connection, this.chatHistoryEnvelope());
```

For viewer connections, call `ensureViewerProfile(connection.sessionId)` before broadcasting presence:

```ts
    this.ensureViewerProfile(connection.sessionId);
    void this.persistActivity();
```

`ensureViewerProfile()` stays synchronous. It only mutates in-memory state and returns the profile; callers that create or change activity are responsible for calling `persistActivity()`. This avoids hidden async writes inside a method that is also used when building canonical chat messages.

After viewer connect and viewer disconnect, broadcast roster:

```ts
    this.broadcast(this.viewerRosterEnvelope());
```

Add these methods to `RoomState`:

```ts
  private ensureViewerProfile(viewerSessionId: string) {
    if (this.viewerProfiles.has(viewerSessionId)) {
      return this.viewerProfiles.get(viewerSessionId)!;
    }

    const now = this.now();
    const profile = {
      viewerSessionId,
      displayName: defaultViewerName(viewerSessionId),
      joinedAt: now,
      profileUpdatedAt: null,
    };
    this.viewerProfiles.set(viewerSessionId, profile);
    return profile;
  }

  private getViewerRoster(): ViewerRosterEntry[] {
    return [...this.viewerProfiles.values()].map((profile) => {
      const metrics = this.viewerMetrics.get(profile.viewerSessionId);
      return {
        viewerSessionId: profile.viewerSessionId,
        displayName: profile.displayName,
        online: this.viewers.has(profile.viewerSessionId),
        connectionType: metrics?.connectionType ?? "unknown",
        pingMs: metrics?.pingMs ?? null,
        joinedAt: profile.joinedAt,
        profileUpdatedAt: profile.profileUpdatedAt,
        metricsUpdatedAt: metrics?.metricsUpdatedAt ?? null,
      };
    });
  }

  private viewerRosterEnvelope(): SignalEnvelope {
    return signalEnvelopeSchema.parse({
      roomId: this.roomId,
      sessionId: this.hostSessionId,
      role: "host",
      messageType: "viewer-roster",
      timestamp: this.now(),
      payload: { viewers: this.getViewerRoster() },
    });
  }

  private chatHistoryEnvelope(): SignalEnvelope {
    return signalEnvelopeSchema.parse({
      roomId: this.roomId,
      sessionId: this.hostSessionId,
      role: "host",
      messageType: "chat-history",
      timestamp: this.now(),
      payload: { messages: this.chatMessages },
    });
  }

  private getPersistedActivity(): PersistedRoomActivity {
    return {
      viewerProfiles: [...this.viewerProfiles.values()],
      viewerMetrics: [...this.viewerMetrics.values()],
      chatMessages: this.chatMessages,
    };
  }

  private persistActivity() {
    this.activityPersistQueue = this.activityPersistQueue
      .catch(() => undefined)
      .then(() => this.options.onPersistActivity?.(this.getPersistedActivity()));
    return this.activityPersistQueue;
  }
```

Add this helper outside the class:

```ts
function defaultViewerName(viewerSessionId: string) {
  return `Viewer ${viewerSessionId.slice(-4)}`;
}
```

- [ ] **Step 9: Handle profile, metrics, and chat messages**

Add these cases to `handleSocketMessage`:

```ts
      case "viewer-profile":
        if (
          connection.role !== "viewer" ||
          envelope.payload.viewerSessionId !== connection.sessionId
        ) {
          connection.socket.close(1008, "session-mismatch");
          return;
        }
        await this.updateViewerProfile(
          connection.sessionId,
          envelope.payload.displayName,
        );
        break;
      case "viewer-metrics":
        if (
          connection.role !== "viewer" ||
          envelope.payload.viewerSessionId !== connection.sessionId
        ) {
          connection.socket.close(1008, "session-mismatch");
          return;
        }
        await this.updateViewerMetrics(connection.sessionId, {
          connectionType: envelope.payload.connectionType,
          pingMs: envelope.payload.pingMs ?? null,
        });
        break;
      case "chat-message":
        await this.appendChatMessage(connection, envelope.payload.text);
        break;
      case "viewer-roster":
      case "chat-history":
      case "chat-message-created":
        connection.socket.close(1008, "message-type-not-allowed");
        break;
```

Add these methods to `RoomState`:

```ts
  private async updateViewerProfile(viewerSessionId: string, displayName: string) {
    const current = this.ensureViewerProfile(viewerSessionId);
    this.viewerProfiles.set(viewerSessionId, {
      ...current,
      displayName: displayName.trim(),
      profileUpdatedAt: this.now(),
    });
    await this.persistActivity();
    this.broadcast(this.viewerRosterEnvelope());
  }

  private async updateViewerMetrics(
    viewerSessionId: string,
    metrics: {
      connectionType: RoomConnectionType;
      pingMs: number | null;
    },
  ) {
    this.ensureViewerProfile(viewerSessionId);
    this.viewerMetrics.set(viewerSessionId, {
      viewerSessionId,
      connectionType: metrics.connectionType,
      pingMs: metrics.pingMs,
      metricsUpdatedAt: this.now(),
    });
    await this.persistActivity();
    this.broadcast(this.viewerRosterEnvelope());
  }

  private async appendChatMessage(connection: RoomConnection, text: string) {
    const normalizedText = text.trim();
    if (!normalizedText) {
      return;
    }

    const message: RoomChatMessage = {
      messageId: crypto.randomUUID(),
      senderSessionId: connection.sessionId,
      senderRole: connection.role,
      senderName:
        connection.role === "host"
          ? "Host"
          : this.ensureViewerProfile(connection.sessionId).displayName,
      text: normalizedText,
      sentAt: this.now(),
    };

    this.chatMessages = [...this.chatMessages, message].slice(-CHAT_HISTORY_LIMIT);
    await this.persistActivity();
    this.broadcast(
      signalEnvelopeSchema.parse({
        roomId: this.roomId,
        sessionId: this.hostSessionId,
        role: "host",
        messageType: "chat-message-created",
        timestamp: message.sentAt,
        payload: message,
      }),
    );
  }
```

Because these methods are async, change `handleSocketMessage()` to return `Promise<void>` and `await` the activity mutations. In `RoomObject.handleWebSocket()`, call it from the message listener with `void roomState.handleSocketMessage(...).catch(() => connection.socket.close(1011, "message-handler-failed"));`.

- [ ] **Step 10: Persist activity in `RoomObject`**

Add a property to `RoomObject`:

```ts
  private activity: PersistedRoomActivity | null = null;
```

During `/internal/initialize`, initialize activity storage:

```ts
      this.activity = {
        viewerProfiles: [],
        viewerMetrics: [],
        chatMessages: [],
      };
      await this.state.storage.put(ROOM_ACTIVITY_KEY, this.activity);
```

In `ensureRoomState`, load and normalize activity beside the room record:

```ts
      this.activity = normalizePersistedActivity(
        await this.state.storage.get<unknown>(ROOM_ACTIVITY_KEY),
      );
```

Add this helper near the other module helpers:

```ts
function normalizePersistedActivity(value: unknown): PersistedRoomActivity {
  if (!value || typeof value !== "object") {
    return { viewerProfiles: [], viewerMetrics: [], chatMessages: [] };
  }

  const record = value as Partial<PersistedRoomActivity>;
  return {
    viewerProfiles: Array.isArray(record.viewerProfiles)
      ? record.viewerProfiles.flatMap((profile) => {
          if (!profile || typeof profile !== "object") {
            return [];
          }
          const candidate = profile as Partial<ViewerProfileRecord>;
          const viewerSessionId =
            typeof candidate.viewerSessionId === "string"
              ? candidate.viewerSessionId.trim()
              : "";
          const displayName =
            typeof candidate.displayName === "string"
              ? candidate.displayName.trim()
              : "";
          if (!viewerSessionId || !displayName) {
            return [];
          }
          return [
            {
              viewerSessionId,
              displayName: displayName.slice(0, 80),
              joinedAt:
                typeof candidate.joinedAt === "number" && candidate.joinedAt >= 0
                  ? Math.trunc(candidate.joinedAt)
                  : 0,
              profileUpdatedAt:
                typeof candidate.profileUpdatedAt === "number" &&
                candidate.profileUpdatedAt >= 0
                  ? Math.trunc(candidate.profileUpdatedAt)
                  : null,
            },
          ];
        })
      : [],
    viewerMetrics: Array.isArray(record.viewerMetrics)
      ? record.viewerMetrics.flatMap((metrics) => {
          if (!metrics || typeof metrics !== "object") {
            return [];
          }
          const candidate = metrics as Partial<ViewerMetricsRecord>;
          const viewerSessionId =
            typeof candidate.viewerSessionId === "string"
              ? candidate.viewerSessionId.trim()
              : "";
          if (
            !viewerSessionId ||
            (candidate.connectionType !== "direct" &&
              candidate.connectionType !== "relay" &&
              candidate.connectionType !== "unknown") ||
            typeof candidate.metricsUpdatedAt !== "number" ||
            candidate.metricsUpdatedAt < 0
          ) {
            return [];
          }
          return [
            {
              viewerSessionId,
              connectionType: candidate.connectionType,
              pingMs:
                typeof candidate.pingMs === "number" && candidate.pingMs >= 0
                  ? Math.trunc(candidate.pingMs)
                  : null,
              metricsUpdatedAt: Math.trunc(candidate.metricsUpdatedAt),
            },
          ];
        })
      : [],
    chatMessages: Array.isArray(record.chatMessages)
      ? record.chatMessages
          .filter((message) => roomChatMessageSchema.safeParse(message).success)
          .slice(-CHAT_HISTORY_LIMIT)
      : [],
  };
}
```

Import `roomChatMessageSchema` from `@screenmate/shared` for this helper.

In `createRoomState`, pass persistence callbacks:

```ts
      activity: this.activity,
      onPersistActivity: async (nextActivity) => {
        this.activity = nextActivity;
        await this.state.storage.put(ROOM_ACTIVITY_KEY, nextActivity);
      },
```

When the room closes for `host-left`, `closed`, or `expired`, remove activity storage as part of the same close persistence path:

```ts
      this.activity = null;
      await this.state.storage.delete(ROOM_ACTIVITY_KEY);
```

Do not rely on Durable Object eviction as the cleanup mechanism. The feature promises room-scoped retention, so activity data must be deleted or tombstoned when the room lifecycle ends.

- [ ] **Step 11: Run server and shared tests**

Run:

```bash
pnpm --filter @screenmate/cloudflare test -- test/room-object.test.ts
pnpm --filter @screenmate/shared test -- test/signaling.test.ts
pnpm --filter @screenmate/cloudflare typecheck
pnpm --filter @screenmate/shared typecheck
```

Expected: all commands PASS.

- [ ] **Step 12: Commit server activity storage**

Run:

```bash
git add apps/server/src/do/room-object.ts apps/server/test/room-object.test.ts packages/shared/src/signaling.ts packages/shared/test/signaling.test.ts
git commit -m "feat(server): store room activity state"
```

Expected: commit succeeds.

---

## Task 3: Wire Viewer Profiles, Chat, Roster, And Metrics

**Files:**

- Modify: `apps/viewer-web/src/lib/peer-client.ts`
- Modify: `apps/viewer-web/src/lib/socket-client.ts`
- Modify: `apps/viewer-web/src/lib/session-state.ts`
- Modify: `apps/viewer-web/src/viewer-session.ts`
- Modify: `apps/viewer-web/src/viewer-scene-model.ts`
- Modify: `apps/viewer-web/src/viewer-scene-adapter.ts`
- Modify: `apps/viewer-web/src/App.tsx`
- Modify: `apps/viewer-web/test/viewer-session.test.ts`
- Modify: `apps/viewer-web/test/peer-client.test.ts`
- Modify: `apps/viewer-web/test/viewer-scene-adapter.test.ts`

- [ ] **Step 1: Write failing viewer session tests**

In `apps/viewer-web/test/viewer-session.test.ts`, add `getStats()` to `FakePeerConnection`:

```ts
  async getStats() {
    return new Map<string, Record<string, unknown>>([
      [
        "pair_1",
        {
          id: "pair_1",
          type: "candidate-pair",
          selected: true,
          state: "succeeded",
          localCandidateId: "local_1",
          currentRoundTripTime: 0.024,
        },
      ],
      [
        "local_1",
        {
          id: "local_1",
          type: "local-candidate",
          candidateType: "relay",
        },
      ],
    ]);
  }
```

Add these tests:

```ts
  it("sends a viewer profile when the signaling socket opens", async () => {
    const socket = new FakeWebSocket();
    const session = new ViewerSession({
      apiBaseUrl: "https://api.example",
      fetchFn: async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        if (url.endsWith("/rooms/room_demo") && !init?.method) {
          return Response.json({
            roomId: "room_demo",
            state: "hosting",
            sourceState: "missing",
            hostConnected: true,
            hostSessionId: "host_1",
            viewerCount: 0,
          });
        }
        return Response.json({
          roomId: "room_demo",
          sessionId: "viewer_1",
          viewerToken: "viewer-token",
          wsUrl: "ws://signal.example/rooms/room_demo/ws",
          iceServers: [],
        });
      },
      createWebSocket: () => socket as never,
      createPeerConnection: () => new FakePeerConnection() as never,
      now: () => 42,
      initialDisplayName: "Mina",
    });

    await session.join("room_demo");
    socket.emitOpen();

    expect(socket.sentMessages.map((message) => JSON.parse(message))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          roomId: "room_demo",
          sessionId: "viewer_1",
          role: "viewer",
          messageType: "viewer-profile",
          payload: {
            viewerSessionId: "viewer_1",
            displayName: "Mina",
          },
        }),
      ]),
    );
  });

  it("stores roster, chat history, and incoming chat messages", async () => {
    const socket = new FakeWebSocket();
    const session = new ViewerSession({
      apiBaseUrl: "https://api.example",
      fetchFn: async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        if (url.endsWith("/rooms/room_demo") && !init?.method) {
          return Response.json({
            roomId: "room_demo",
            state: "hosting",
            sourceState: "missing",
            hostConnected: true,
            hostSessionId: "host_1",
            viewerCount: 0,
          });
        }
        return Response.json({
          roomId: "room_demo",
          sessionId: "viewer_1",
          viewerToken: "viewer-token",
          wsUrl: "ws://signal.example/rooms/room_demo/ws",
          iceServers: [],
        });
      },
      createWebSocket: () => socket as never,
      createPeerConnection: () => new FakePeerConnection() as never,
      initialDisplayName: "Mina",
    });

    await session.join("room_demo");
    socket.emitOpen();
    socket.emitMessage(
      JSON.stringify({
        roomId: "room_demo",
        sessionId: "host_1",
        role: "host",
        messageType: "viewer-roster",
        timestamp: 10,
        payload: {
          viewers: [
            {
              viewerSessionId: "viewer_1",
              displayName: "Mina",
              online: true,
              connectionType: "relay",
              pingMs: 24,
              joinedAt: 1,
              profileUpdatedAt: 2,
              metricsUpdatedAt: 3,
            },
          ],
        },
      }),
    );
    socket.emitMessage(
      JSON.stringify({
        roomId: "room_demo",
        sessionId: "host_1",
        role: "host",
        messageType: "chat-history",
        timestamp: 11,
        payload: {
          messages: [
            {
              messageId: "msg_1",
              senderSessionId: "host_1",
              senderRole: "host",
              senderName: "Host",
              text: "Welcome",
              sentAt: 10,
            },
          ],
        },
      }),
    );
    socket.emitMessage(
      JSON.stringify({
        roomId: "room_demo",
        sessionId: "host_1",
        role: "host",
        messageType: "chat-message-created",
        timestamp: 12,
        payload: {
          messageId: "msg_2",
          senderSessionId: "viewer_2",
          senderRole: "viewer",
          senderName: "Noa",
          text: "Hi",
          sentAt: 12,
        },
      }),
    );

    expect(session.getSnapshot()).toMatchObject({
      viewerRoster: [
        {
          viewerSessionId: "viewer_1",
          displayName: "Mina",
          connectionType: "relay",
          pingMs: 24,
        },
      ],
      chatMessages: [
        { messageId: "msg_1", text: "Welcome" },
        { messageId: "msg_2", text: "Hi" },
      ],
    });
  });

  it("sends viewer chat and display name updates", async () => {
    const socket = new FakeWebSocket();
    const session = new ViewerSession({
      apiBaseUrl: "https://api.example",
      fetchFn: async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        if (url.endsWith("/rooms/room_demo") && !init?.method) {
          return Response.json({
            roomId: "room_demo",
            state: "hosting",
            sourceState: "missing",
            hostConnected: true,
            hostSessionId: "host_1",
            viewerCount: 0,
          });
        }
        return Response.json({
          roomId: "room_demo",
          sessionId: "viewer_1",
          viewerToken: "viewer-token",
          wsUrl: "ws://signal.example/rooms/room_demo/ws",
          iceServers: [],
        });
      },
      createWebSocket: () => socket as never,
      createPeerConnection: () => new FakePeerConnection() as never,
      initialDisplayName: "Mina",
    });

    await session.join("room_demo");
    socket.emitOpen();
    session.updateDisplayName("Noa");
    session.sendChatMessage("hello host");

    expect(socket.sentMessages.map((message) => JSON.parse(message))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          messageType: "viewer-profile",
          payload: {
            viewerSessionId: "viewer_1",
            displayName: "Noa",
          },
        }),
        expect.objectContaining({
          messageType: "chat-message",
          payload: {
            text: "hello host",
          },
        }),
      ]),
    );
  });
```

- [ ] **Step 2: Run failing viewer tests**

Run:

```bash
pnpm --filter @screenmate/viewer-web test -- test/viewer-session.test.ts
```

Expected: FAIL because `ViewerSession` does not accept `initialDisplayName`, does not expose `updateDisplayName` or `sendChatMessage`, and does not store activity state.

- [ ] **Step 3: Add viewer activity state types**

Update `apps/viewer-web/src/lib/session-state.ts`:

```ts
import type {
  RoomChatMessage,
  RoomSourceState,
  RoomState,
  ViewerRosterEntry,
} from "@screenmate/shared";
```

Add fields to `ViewerSessionState`:

```ts
  displayName: string;
  viewerRoster: ViewerRosterEntry[];
  chatMessages: RoomChatMessage[];
  localConnectionType: ViewerRosterEntry["connectionType"];
  localPingMs: number | null;
```

Update `initialViewerSessionState`:

```ts
  displayName: "",
  viewerRoster: [],
  chatMessages: [],
  localConnectionType: "unknown",
  localPingMs: null,
```

- [ ] **Step 4: Expose viewer metrics sampling**

In `apps/viewer-web/src/lib/peer-client.ts`, add this exported type and helper near the diagnostics helpers:

```ts
export type ViewerPeerMetrics = {
  connectionType: "direct" | "relay" | "unknown";
  pingMs: number | null;
};

export async function collectViewerPeerMetrics(
  peerConnection: PeerConnectionLike,
): Promise<ViewerPeerMetrics> {
  const stats = await peerConnection.getStats();
  const reports = [...stats.values()].filter(
    (report): report is Record<string, unknown> =>
      typeof report === "object" && report !== null,
  );
  const selectedPair = reports.find((report) => {
    return (
      report.type === "candidate-pair" &&
      (report.selected === true || report.state === "succeeded")
    );
  });

  if (!selectedPair) {
    return { connectionType: "unknown", pingMs: null };
  }

  const localCandidateId =
    typeof selectedPair.localCandidateId === "string"
      ? selectedPair.localCandidateId
      : null;
  const localCandidate = reports.find(
    (report) => report.id === localCandidateId,
  );
  const candidateType =
    typeof localCandidate?.candidateType === "string"
      ? localCandidate.candidateType
      : null;
  const rttSeconds =
    typeof selectedPair.currentRoundTripTime === "number"
      ? selectedPair.currentRoundTripTime
      : null;

  return {
    connectionType:
      candidateType === "relay"
        ? "relay"
        : candidateType
          ? "direct"
          : "unknown",
    pingMs: rttSeconds === null ? null : Math.round(rttSeconds * 1_000),
  };
}
```

Add `collectMetrics()` to the object returned by `createViewerPeerConnection`:

```ts
    collectMetrics() {
      return collectViewerPeerMetrics(peerConnection);
    },
```

Add focused tests in `apps/viewer-web/test/peer-client.test.ts` for:

- `relay` when the selected local candidate is relay.
- `direct` when the selected local candidate is non-relay.
- `unknown` when no selected candidate pair exists.
- `pingMs: null` when `currentRoundTripTime` is unavailable.
- rejected `getStats()` does not bubble into a session-ending failure when sampled from `ViewerSession`.
- the metrics timer is cleared in `ViewerSession.teardown()`.

- [ ] **Step 5: Wire profile, chat, roster, and metrics in `ViewerSession`**

Update `ViewerSessionOptions` in `apps/viewer-web/src/viewer-session.ts`:

```ts
  initialDisplayName: string;
  metricsIntervalMs?: number;
```

Add class fields:

```ts
  private metricsTimer: ReturnType<typeof setInterval> | null = null;
```

Initialize display name in `join()`:

```ts
      displayName: this.options.initialDisplayName,
```

The viewer app owns the locale-aware random name and must pass it into `ViewerSession`. The server fallback name is only a temporary safe value for a viewer that has connected before its profile arrives.

After `createSocketClient` `onOpen`, send profile:

```ts
          this.sendViewerProfile();
          this.startMetricsTimer();
```

Add public methods:

```ts
  updateDisplayName(displayName: string) {
    const nextDisplayName = displayName.trim();
    if (!nextDisplayName) {
      return;
    }

    this.update({ displayName: nextDisplayName });
    this.sendViewerProfile();
  }

  sendChatMessage(text: string) {
    const normalizedText = text.trim();
    if (!normalizedText || !this.joinResponse || !this.socketClient) {
      return false;
    }

    return this.socketClient.send(
      signalEnvelopeSchema.parse({
        roomId: this.joinResponse.roomId,
        sessionId: this.joinResponse.sessionId,
        role: "viewer",
        messageType: "chat-message",
        timestamp: this.options.now?.() ?? Date.now(),
        payload: { text: normalizedText },
      }),
    );
  }
```

Import `signalEnvelopeSchema` from `@screenmate/shared`.

Update `createSocketClient.send()` in `apps/viewer-web/src/lib/socket-client.ts` to return `boolean` and check `socket.readyState === WebSocket.OPEN` before sending. Failed sends must return `false` so chat inputs can preserve the draft.

Also add a small `redactUrlToken()` helper in the socket client and use it for all WebSocket URL logs. Logs must not include `token` query parameters or chat text.

Add helpers:

```ts
  private sendViewerProfile() {
    if (!this.joinResponse || !this.snapshot.displayName.trim()) {
      return;
    }

    this.socketClient?.send(
      signalEnvelopeSchema.parse({
        roomId: this.joinResponse.roomId,
        sessionId: this.joinResponse.sessionId,
        role: "viewer",
        messageType: "viewer-profile",
        timestamp: this.options.now?.() ?? Date.now(),
        payload: {
          viewerSessionId: this.joinResponse.sessionId,
          displayName: this.snapshot.displayName.trim(),
        },
      }),
    );
  }

  private startMetricsTimer() {
    this.stopMetricsTimer();
    const intervalMs = this.options.metricsIntervalMs ?? 5_000;
    this.metricsTimer = setInterval(() => {
      void this.sendViewerMetrics();
    }, intervalMs);
    void this.sendViewerMetrics();
  }

  private stopMetricsTimer() {
    if (!this.metricsTimer) {
      return;
    }
    clearInterval(this.metricsTimer);
    this.metricsTimer = null;
  }

  private async sendViewerMetrics() {
    if (!this.joinResponse || !this.peerClient) {
      return;
    }

    const metrics = await this.peerClient.collectMetrics?.().catch(() => null);
    if (!metrics) {
      return;
    }

    this.update({
      localConnectionType: metrics.connectionType,
      localPingMs: metrics.pingMs,
    });
    this.socketClient?.send(
      signalEnvelopeSchema.parse({
        roomId: this.joinResponse.roomId,
        sessionId: this.joinResponse.sessionId,
        role: "viewer",
        messageType: "viewer-metrics",
        timestamp: this.options.now?.() ?? Date.now(),
        payload: {
          viewerSessionId: this.joinResponse.sessionId,
          connectionType: metrics.connectionType,
          pingMs: metrics.pingMs,
        },
      }),
    );
  }
```

Handle new messages in `handleSignal`:

```ts
      case "viewer-roster":
        this.update({ viewerRoster: message.payload.viewers });
        break;
      case "chat-history":
        this.update({ chatMessages: message.payload.messages });
        break;
      case "chat-message-created":
        if (
          message.payload.messageId &&
          message.payload.senderSessionId &&
          message.payload.senderRole &&
          message.payload.senderName &&
          typeof message.payload.sentAt === "number"
        ) {
          this.update({
            chatMessages: [
              ...this.snapshot.chatMessages.filter(
                (chatMessage) =>
                  chatMessage.messageId !== message.payload.messageId,
              ),
              {
                messageId: message.payload.messageId,
                senderSessionId: message.payload.senderSessionId,
                senderRole: message.payload.senderRole,
                senderName: message.payload.senderName,
                text: message.payload.text,
                sentAt: message.payload.sentAt,
              },
            ],
          });
        }
        break;
```

Call `this.stopMetricsTimer()` inside `teardown()`.

Update existing viewer-session tests that assume `socket.sentMessages[0]` is the WebRTC `answer`. After this task, profile and metrics may be sent first. Use parsed message arrays:

```ts
const sentMessages = socket.sentMessages.map((message) => JSON.parse(message));
expect(sentMessages).toEqual(
  expect.arrayContaining([
    expect.objectContaining({
      messageType: "answer",
      payload: expect.objectContaining({ sdp: "viewer-answer" }),
    }),
  ]),
);
```

- [ ] **Step 6: Wire App display name and chat**

In `apps/viewer-web/src/App.tsx`, initialize the random name once:

```ts
  const [displayName, setDisplayName] = useState(() =>
    buildRandomViewerUsername(locale),
  );
```

Create `ViewerSession` with that name:

```ts
      new ViewerSession({
        apiBaseUrl: getViewerApiBaseUrl(),
        initialDisplayName: displayName,
      }),
```

Add `onDisplayNameChange` to `ViewerShell` props:

```ts
  onDisplayNameChange: (displayName: string) => void;
```

Replace the sidebar identity row text with a compact controlled input. Keep a local draft value and resync it when `scene.sidebar.username` changes so server roster updates and randomize actions are reflected:

```tsx
const [displayNameDraft, setDisplayNameDraft] = useState(scene.sidebar.username);

useEffect(() => {
  setDisplayNameDraft(scene.sidebar.username);
}, [scene.sidebar.username]);

<input
  aria-label={copy.nameLabel}
  value={displayNameDraft}
  onChange={(event) => setDisplayNameDraft(event.currentTarget.value)}
  onBlur={(event) => onDisplayNameChange(event.currentTarget.value)}
  onKeyDown={(event) => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    }
  }}
  className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs"
/>
```

Keep the randomize button as a quick rename shortcut. In `App.tsx`, pass:

```tsx
      onDisplayNameChange={(nextName) => {
        setDisplayName(nextName);
        viewerSession.updateDisplayName(nextName);
      }}
```

Replace `onRandomizeUsername`:

```ts
      onRandomizeUsername={() => {
        const nextName = buildRandomViewerUsername(locale);
        setDisplayName(nextName);
        viewerSession.updateDisplayName(nextName);
      }}
```

Replace `onSendMessage`:

```ts
      onSendMessage={(text) => viewerSession.sendChatMessage(text)}
```

When building the scene, pass session display name through `session`, not mock. Keep `mock` only where tests still require a pre-join fallback.

- [ ] **Step 7: Update viewer scene adapter tests and implementation**

Add this test to `apps/viewer-web/test/viewer-scene-adapter.test.ts`:

```ts
it("uses real room activity when joined", () => {
  const scene = buildViewerSceneModel({
    locale: "en",
    session: {
      ...initialViewerSessionState,
      roomId: "room_demo",
      sessionId: "viewer_1",
      status: "connected",
      displayName: "Mina",
      localConnectionType: "relay",
      localPingMs: 24,
      viewerRoster: [
        {
          viewerSessionId: "viewer_1",
          displayName: "Mina",
          online: true,
          connectionType: "relay",
          pingMs: 24,
          joinedAt: 1,
          profileUpdatedAt: 2,
          metricsUpdatedAt: 3,
        },
      ],
      chatMessages: [
        {
          messageId: "msg_1",
          senderSessionId: "host_1",
          senderRole: "host",
          senderName: "Host",
          text: "Welcome",
          sentAt: 10,
        },
      ],
    },
    mock: createViewerMockState("en"),
  });

  expect(scene.sidebar.username).toBe("Mina");
  expect(scene.sidebar.viewerCount).toBe(1);
  expect(scene.connection.typeLabel).toBe("Relay");
  expect(scene.connection.pingLabel).toBe("24ms");
  expect(scene.sidebar.messages).toEqual([
    expect.objectContaining({
      id: "msg_1",
      sender: "Host",
      text: "Welcome",
    }),
  ]);
});
```

Replace the existing `joined`, connection, and sidebar derivation in `buildViewerSceneModel()` with this room-aware version. Mock messages are used only before joining; an active room with empty chat history renders no messages.

```ts
  const joined = input.session.status !== "idle";
  const useRealActivity = input.session.roomId !== null && input.session.status !== "idle";
  const activityMessages =
    useRealActivity
      ? input.session.chatMessages.map((message) => ({
          id: message.messageId,
          senderKind:
            message.senderSessionId === input.session.sessionId
              ? "self"
              : message.senderRole === "host"
                ? "host"
                : "named",
          sender:
            message.senderSessionId === input.session.sessionId
              ? copy.senderYou
              : message.senderRole === "host"
                ? copy.senderHost
                : message.senderName,
          text: message.text,
          time: formatViewerTime(message.sentAt, input.locale),
        }))
      : input.mock.messages.map((message) => ({
          id: message.id,
          senderKind: message.senderKind,
          sender:
            message.senderKind === "host"
              ? copy.senderHost
              : message.senderKind === "system"
                ? copy.senderSystem
                : message.senderKind === "self"
                  ? copy.senderYou
                  : message.senderName ?? "",
          text:
            message.textKey === "hostStartedRoom"
              ? copy.hostStartedRoom
              : message.text ?? "",
          time: formatViewerTime(message.timestamp, input.locale),
        }));
```

Use real values:

```ts
    connection: {
      typeLabel: formatConnectionType(input.session.localConnectionType, copy),
      pingLabel:
        input.session.localPingMs === null ? "--" : `${input.session.localPingMs}ms`,
    },
    sidebar: {
      viewerCount:
        useRealActivity
          ? Math.max(
              input.session.viewerRoster.filter((viewer) => viewer.online).length,
              1,
            )
          : input.mock.viewerCount,
      username: input.session.displayName || input.mock.username,
      messages: activityMessages,
    },
```

Add helper:

```ts
function formatConnectionType(
  connectionType: ViewerSessionState["localConnectionType"],
  copy: ReturnType<typeof getViewerDictionary>,
) {
  if (connectionType === "relay") {
    return "Relay";
  }

  if (connectionType === "direct") {
    return copy.connectionTypeDirectP2P;
  }

  return "--";
}
```

- [ ] **Step 8: Run viewer tests and typecheck**

Run:

```bash
pnpm --filter @screenmate/viewer-web test -- test/viewer-session.test.ts test/peer-client.test.ts test/viewer-scene-adapter.test.ts
pnpm --filter @screenmate/viewer-web typecheck
```

Expected: both commands PASS.

- [ ] **Step 9: Commit viewer activity wiring**

Run:

```bash
git add apps/viewer-web/src apps/viewer-web/test
git commit -m "feat(viewer): wire room activity"
```

Expected: commit succeeds.

---

## Task 4: Wire Extension Host Runtime And Popup Chat

**Files:**

- Modify: `apps/extension/entrypoints/background/host-room-snapshot.ts`
- Modify: `apps/extension/entrypoints/background/host-room-runtime.ts`
- Modify: `apps/extension/entrypoints/background.ts`
- Modify: `apps/extension/entrypoints/popup/scene-adapter.ts`
- Modify: `apps/extension/entrypoints/popup/scene-model.ts`
- Modify: `apps/extension/entrypoints/popup/App.tsx`
- Modify: `apps/extension/test/background/host-room-runtime.test.ts`
- Modify: `apps/extension/test/background/background.test.ts`
- Modify: `apps/extension/test/popup/scene-adapter.test.ts`

- [ ] **Step 1: Write failing host runtime tests**

Add imports to `apps/extension/test/background/host-room-runtime.test.ts` if needed:

```ts
import type { RoomChatMessage, ViewerRosterEntry } from "@screenmate/shared";
```

Add this helper near the top:

```ts
function emitSocketMessage(socket: MockHostSocket, message: Record<string, unknown>) {
  socket.emit("message", {
    data: JSON.stringify(message),
  } as MessageEvent);
}
```

Add these tests:

```ts
  it("stores roster and chat activity from signaling messages", async () => {
    const storage = {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn(),
      remove: vi.fn(),
    };
    const sockets: MockHostSocket[] = [];
    const runtime = createHostRoomRuntime({
      storage,
      WebSocketImpl: class {
        constructor(_url: string) {
          const socket = new MockHostSocket();
          sockets.push(socket);
          return socket;
        }
      } as never,
    });

    await runtime.startRoom({
      roomId: "room_123",
      hostSessionId: "host_1",
      hostToken: "host-token",
      signalingUrl: "/rooms/room_123/ws",
      iceServers: [],
      activeTabId: 42,
      activeFrameId: 0,
      viewerSessionIds: [],
      viewerCount: 0,
      sourceFingerprint: null,
      recoverByTimestamp: null,
      viewerRoster: [],
      chatMessages: [],
    });
    const connected = runtime.connectSignaling(vi.fn());
    sockets[0]!.readyState = 1;
    sockets[0]!.emit("open");
    await connected;

    emitSocketMessage(sockets[0]!, {
      roomId: "room_123",
      sessionId: "host_1",
      role: "host",
      messageType: "viewer-roster",
      timestamp: 10,
      payload: {
        viewers: [
          {
            viewerSessionId: "viewer_1",
            displayName: "Mina",
            online: true,
            connectionType: "relay",
            pingMs: 142,
            joinedAt: 1,
            profileUpdatedAt: 2,
            metricsUpdatedAt: 3,
          },
        ] satisfies ViewerRosterEntry[],
      },
    });
    emitSocketMessage(sockets[0]!, {
      roomId: "room_123",
      sessionId: "host_1",
      role: "host",
      messageType: "chat-history",
      timestamp: 11,
      payload: {
        messages: [
          {
            messageId: "msg_1",
            senderSessionId: "viewer_1",
            senderRole: "viewer",
            senderName: "Mina",
            text: "hello",
            sentAt: 10,
          },
        ] satisfies RoomChatMessage[],
      },
    });

    expect(runtime.getSnapshot()).toMatchObject({
      viewerCount: 1,
      viewerRoster: [
        {
          viewerSessionId: "viewer_1",
          displayName: "Mina",
          online: true,
          connectionType: "relay",
          pingMs: 142,
        },
      ],
      chatMessages: [
        {
          messageId: "msg_1",
          senderName: "Mina",
          text: "hello",
        },
      ],
    });
  });

  it("sends host chat messages over the active signaling socket", async () => {
    const storage = {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn(),
      remove: vi.fn(),
    };
    const sockets: MockHostSocket[] = [];
    const runtime = createHostRoomRuntime({
      storage,
      now: () => 100,
      WebSocketImpl: class {
        constructor(_url: string) {
          const socket = new MockHostSocket();
          sockets.push(socket);
          return socket;
        }
      } as never,
    });

    await runtime.startRoom({
      roomId: "room_123",
      hostSessionId: "host_1",
      hostToken: "host-token",
      signalingUrl: "/rooms/room_123/ws",
      iceServers: [],
      activeTabId: 42,
      activeFrameId: 0,
      viewerSessionIds: [],
      viewerCount: 0,
      sourceFingerprint: null,
      recoverByTimestamp: null,
      viewerRoster: [],
      chatMessages: [],
    });
    const connected = runtime.connectSignaling(vi.fn());
    sockets[0]!.readyState = 1;
    sockets[0]!.emit("open");
    await connected;

    expect(runtime.sendHostChatMessage("hello viewers")).toBe(true);
    expect(JSON.parse(sockets[0]!.send.mock.calls.at(-1)![0])).toMatchObject({
      roomId: "room_123",
      sessionId: "host_1",
      role: "host",
      messageType: "chat-message",
      payload: {
        text: "hello viewers",
      },
    });
  });
```

- [ ] **Step 2: Run failing extension runtime tests**

Run:

```bash
pnpm --filter @screenmate/extension test -- test/background/host-room-runtime.test.ts
```

Expected: FAIL because snapshots do not include activity and runtime has no `sendHostChatMessage()`.

- [ ] **Step 3: Add activity fields to host snapshot types**

Update `apps/extension/entrypoints/background/host-room-snapshot.ts`:

```ts
import type { RoomChatMessage, ViewerRosterEntry } from "@screenmate/shared";
```

Add to `PersistedHostRoomSession`:

```ts
  viewerRoster: ViewerRosterEntry[];
  chatMessages: RoomChatMessage[];
```

Add to `HostRoomSnapshot`:

```ts
  viewerRoster: ViewerRosterEntry[];
  chatMessages: RoomChatMessage[];
```

Update `createHostRoomSnapshot()` defaults:

```ts
    viewerRoster: [],
    chatMessages: [],
```

Update `openRoom()`:

```ts
        viewerRoster: session.viewerRoster ?? [],
        chatMessages: session.chatMessages ?? [],
```

Add store methods:

```ts
    setActivity(activity: {
      viewerRoster: ViewerRosterEntry[];
      viewerCount: number;
      chatMessages?: RoomChatMessage[];
    }) {
      snapshot = {
        ...snapshot,
        viewerRoster: activity.viewerRoster,
        viewerCount: activity.viewerCount,
        chatMessages: activity.chatMessages ?? snapshot.chatMessages,
      };
      return snapshot;
    },
    setChatMessages(chatMessages: RoomChatMessage[]) {
      snapshot = {
        ...snapshot,
        chatMessages,
      };
      return snapshot;
    },
```

For this plan, set `viewerCount` to online viewers only by mapping `ViewerRosterEntry.online`. Do not derive room count from `ViewerConnectionRow.isGood`; that field is connection quality, not presence.

- [ ] **Step 4: Map roster/history in host runtime**

Update imports in `host-room-runtime.ts`:

```ts
import {
  signalEnvelopeSchema,
  type RoomChatMessage,
  type RoomSourceState,
  type RoomState,
  type ViewerRosterEntry,
} from "@screenmate/shared";
```

Add an optional callback to `createHostRoomRuntime()` options:

```ts
  onSnapshotUpdated?: () => void;
```

Call it after activity changes are stored:

```ts
            store.setActivity({
              viewerRoster,
              viewerCount: envelope.payload.viewers.filter((viewer) => viewer.online).length,
              chatMessages,
            });
            await persist();
            options.onSnapshotUpdated?.();
            return;
```

Do the same after `chat-history` and `chat-message-created` update `store.setChatMessages(...)`.

When the production background creates the runtime, pass:

```ts
onSnapshotUpdated() {
  void browser.runtime.sendMessage({ type: "screenmate:room-snapshot-updated" });
}
```

Add a small helper for the one derived value the runtime owns:

```ts
function countOnlineViewers(viewers: ViewerRosterEntry[]) {
  return viewers.filter((viewer) => viewer.online).length;
}
```

Do not import popup scene-model types or persist formatted UI labels in the background runtime. Keep `viewerRoster` and `chatMessages` protocol-shaped, and map them to `ViewerConnectionRow` / `ExtensionChatMessage` inside `popup/scene-adapter.ts`.

Add runtime state:

```ts
  let viewerRoster: ViewerRosterEntry[] = [];
  let chatMessages: RoomChatMessage[] = [];
```

In `persist()`, include activity fields:

```ts
      await options.storage.set({
        [STORAGE_KEY]: {
          ...session,
          viewerRoster,
          chatMessages,
        },
      });
```

In `startRoom()`, initialize activity:

```ts
      viewerRoster = input.viewerRoster ?? [];
      chatMessages = input.chatMessages ?? [];
```

In socket `message` handler before media messages:

```ts
          if (envelope.messageType === "viewer-roster") {
            viewerRoster = envelope.payload.viewers;
            session = {
              ...session,
              viewerRoster,
              viewerCount: countOnlineViewers(viewerRoster),
            };
            store.setActivity({
              viewerRoster,
              viewerCount: countOnlineViewers(viewerRoster),
              chatMessages,
            });
            await persist();
            options.onSnapshotUpdated?.();
            return;
          }

          if (envelope.messageType === "chat-history") {
            chatMessages = envelope.payload.messages;
            session = { ...session, chatMessages };
            store.setChatMessages(chatMessages);
            await persist();
            options.onSnapshotUpdated?.();
            return;
          }

          if (envelope.messageType === "chat-message-created") {
            chatMessages = [
              ...chatMessages.filter(
                (message) => message.messageId !== envelope.payload.messageId,
              ),
              envelope.payload,
            ];
            session = { ...session, chatMessages };
            store.setChatMessages(chatMessages);
            await persist();
            options.onSnapshotUpdated?.();
            return;
          }
```

Add method in returned runtime object:

```ts
    sendHostChatMessage(text: string) {
      const normalizedText = text.trim();
      if (!session || !normalizedText) {
        return false;
      }

      return sendSignal(
        signalEnvelopeSchema.parse({
          roomId: session.roomId,
          sessionId: session.hostSessionId,
          role: "host",
          messageType: "chat-message",
          timestamp: now(),
          payload: { text: normalizedText },
        }),
      );
    },
```

Update `restoreFromStorage()` to restore activity arrays from stored session:

```ts
      viewerRoster = stored.viewerRoster ?? [];
      chatMessages = stored.chatMessages ?? [];
```

- [ ] **Step 5: Route host chat through background**

In `apps/extension/entrypoints/background.ts`, add to `HostMessage`:

```ts
  | { type: "screenmate:send-chat-message"; text: string }
```

Handle it in `createHostMessageHandler()` near room session handling:

```ts
    if (message.type === "screenmate:send-chat-message") {
      const ok = dependencies.runtime.sendHostChatMessage(message.text);
      return {
        ok,
        snapshot: dependencies.runtime.getSnapshot(),
        error: ok ? null : "room-chat-send-failed",
      };
    }
```

Add validation in `isHostMessage()`:

```ts
    case "screenmate:send-chat-message":
      return typeof message.text === "string" && message.text.trim().length > 0;
```

Add this background test to `apps/extension/test/background/background.test.ts`:

```ts
  it("routes popup chat messages through the host runtime", async () => {
    const runtime = {
      close: vi.fn(),
      connectSignaling: vi.fn(),
      getAttachSession: vi.fn().mockReturnValue(null),
      sendHostChatMessage: vi.fn().mockReturnValue(true),
      getSnapshot: vi.fn().mockReturnValue(createHostRoomSnapshot({ roomId: "room_123" })),
      getSourceFingerprint: vi.fn().mockReturnValue(null),
      markMissing: vi.fn(),
      markRecovering: vi.fn(),
      sendSignal: vi.fn().mockReturnValue(true),
      setAttachedSource: vi.fn(),
      startRoom: vi.fn(),
    };
    const handler = createHostMessageHandler(createHandlerDependencies({
      runtime,
    }));

    await expect(handler({
      type: "screenmate:send-chat-message",
      text: "hello viewers",
    })).resolves.toMatchObject({ ok: true });

    expect(runtime.sendHostChatMessage).toHaveBeenCalledWith("hello viewers");
  });

  it("returns a failure result when host chat cannot be sent", async () => {
    const runtime = {
      close: vi.fn(),
      connectSignaling: vi.fn(),
      getAttachSession: vi.fn().mockReturnValue(null),
      sendHostChatMessage: vi.fn().mockReturnValue(false),
      getSnapshot: vi.fn().mockReturnValue(createHostRoomSnapshot({ roomId: "room_123" })),
      getSourceFingerprint: vi.fn().mockReturnValue(null),
      markMissing: vi.fn(),
      markRecovering: vi.fn(),
      sendSignal: vi.fn().mockReturnValue(false),
      setAttachedSource: vi.fn(),
      startRoom: vi.fn(),
    };
    const handler = createHostMessageHandler(createHandlerDependencies({
      runtime,
    }));

    await expect(handler({
      type: "screenmate:send-chat-message",
      text: "hello viewers",
    })).resolves.toMatchObject({
      ok: false,
      error: "room-chat-send-failed",
    });
  });
```

- [ ] **Step 6: Replace popup mock roster/chat when real data exists**

Add to `apps/extension/test/popup/scene-adapter.test.ts`:

```ts
  it("prefers real snapshot roster and chat over mock activity", () => {
    const scene = buildExtensionSceneModel({
      snapshot: createHostRoomSnapshot({
        roomId: "room_123",
        viewerCount: 1,
        viewerRoster: [
          {
            viewerSessionId: "viewer_1",
            displayName: "Mina",
            online: true,
            connectionType: "relay",
            pingMs: 142,
            joinedAt: 1,
            profileUpdatedAt: 2,
            metricsUpdatedAt: 3,
          },
        ],
        chatMessages: [
          {
            messageId: "msg_1",
            senderSessionId: "viewer_1",
            senderRole: "viewer",
            senderName: "Mina",
            text: "hello",
            sentAt: 10,
          },
        ],
      }),
      sniffTabs: [],
      videos: [],
      selectedVideoId: null,
      isBusy: false,
      busyAction: null,
      viewerRoomUrl: "https://viewer.example/rooms/room_123",
      mock: createExtensionMockState(),
    });

    expect(scene.roomTab.viewerDetails).toEqual([
      expect.objectContaining({ id: "viewer_1", name: "Mina" }),
    ]);
    expect(scene.chatTab.messages).toEqual([
      expect.objectContaining({ id: "msg_1", text: "hello" }),
    ]);
  });
```

Update `popup/scene-adapter.ts`:

```ts
      const hasActiveRealRoom =
        input.snapshot.roomId !== null &&
        input.snapshot.roomLifecycle !== "idle" &&
        input.snapshot.roomLifecycle !== "closed";
```

Extend `ViewerConnectionRow` in `popup/scene-model.ts` with a presence field:

```ts
  online: boolean;
```

Update mock rows to use `online: true`. Offline retained rows should stay visible with `connType: "Offline"` and `ping: "--"`.

Use `hasActiveRealRoom` for activity fallback:

```ts
      viewerDetails:
        hasActiveRealRoom
          ? input.snapshot.viewerRoster.map(toViewerConnectionRow)
          : input.mock.viewerDetails,
```

```ts
      messages:
        hasActiveRealRoom
          ? input.snapshot.chatMessages.map(toExtensionChatMessage)
          : input.mock.messages,
```

Add popup-only mapping helpers:

```ts
function toViewerConnectionRow(viewer: ViewerRosterEntry): ViewerConnectionRow {
  return {
    id: viewer.viewerSessionId,
    name: viewer.displayName,
    connType: viewer.online
      ? viewer.connectionType === "relay"
        ? "Relay"
        : viewer.connectionType === "direct"
          ? "P2P"
          : "--"
      : "Offline",
    ping: viewer.online && viewer.pingMs !== null ? `${viewer.pingMs}ms` : "--",
    isGood: viewer.online && (viewer.pingMs === null || viewer.pingMs < 120),
    online: viewer.online,
  };
}

function toExtensionChatMessage(message: RoomChatMessage): ExtensionChatMessage {
  return {
    id: message.messageId,
    sender: message.senderRole === "host" ? "Host" : message.senderName,
    text: message.text,
  };
}
```

Update `apps/extension/entrypoints/popup/useHostControls.ts` so `normalizeSnapshot()` preserves real activity fields:

```ts
    viewerRoster: Array.isArray(snapshot.viewerRoster)
      ? snapshot.viewerRoster.filter(isViewerRosterEntry)
      : [],
    chatMessages: Array.isArray(snapshot.chatMessages)
      ? snapshot.chatMessages.filter(isRoomChatMessage)
      : [],
```

Add small type guards near the existing normalization helpers:

```ts
function isViewerRosterEntry(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.viewerSessionId === "string" &&
    typeof value.displayName === "string" &&
    typeof value.online === "boolean" &&
    (value.connectionType === "direct" ||
      value.connectionType === "relay" ||
      value.connectionType === "unknown") &&
    (typeof value.pingMs === "number" || value.pingMs === null) &&
    typeof value.joinedAt === "number" &&
    (typeof value.profileUpdatedAt === "number" ||
      value.profileUpdatedAt === null) &&
    (typeof value.metricsUpdatedAt === "number" ||
      value.metricsUpdatedAt === null)
  );
}

function isRoomChatMessage(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.messageId === "string" &&
    typeof value.senderSessionId === "string" &&
    (value.senderRole === "host" || value.senderRole === "viewer") &&
    typeof value.senderName === "string" &&
    typeof value.text === "string" &&
    typeof value.sentAt === "number"
  );
}
```

Update the popup runtime message listener in `useHostControls()` to refresh when the background announces room activity changes:

```ts
      if (message.type === "screenmate:room-snapshot-updated") {
        void syncSnapshot();
      }
```

In `popup/App.tsx`, replace `onSendChat={appendLocalMessage}`:

```ts
        onSendChat={async (text) => {
          if (snapshot.roomId && snapshot.roomLifecycle !== "closed") {
            const result = await browser.runtime.sendMessage({
              type: "screenmate:send-chat-message",
              text,
            });
            return Boolean(result?.ok);
          }

          appendLocalMessage(text);
          return true;
        }}
```

Update `ExtensionPopupPresenter` / `ChatPane` `onSend` type to `((text: string) => boolean | Promise<boolean>)` and only reset the input when the result is truthy. Use the same pattern in `ViewerShell` for `onSendMessage` so failed sends do not silently erase drafts.

- [ ] **Step 7: Update start room call sites for new persisted fields**

Every `runtime.startRoom({ ... })` object in code and tests must include:

```ts
        viewerRoster: [],
        chatMessages: [],
```

Run this search and update each result:

```bash
rg -n "startRoom\\(\\{" apps/extension
```

Expected files include `apps/extension/entrypoints/background.ts` and extension tests.

- [ ] **Step 8: Run extension tests and typecheck**

Run:

```bash
pnpm --filter @screenmate/extension test -- test/background/host-room-runtime.test.ts test/background/background.test.ts test/popup/scene-adapter.test.ts
pnpm --filter @screenmate/extension typecheck
```

Expected: both commands PASS.

- [ ] **Step 9: Commit extension activity wiring**

Run:

```bash
git add apps/extension/entrypoints/background apps/extension/entrypoints/background.ts apps/extension/entrypoints/popup apps/extension/test
git commit -m "feat(extension): wire room activity"
```

Expected: commit succeeds.

---

## Task 5: Full Verification And Mock-State Cleanup

**Files:**

- Modify: `apps/viewer-web/src/viewer-mock-state.ts`
- Modify: `apps/extension/entrypoints/popup/mock-state.ts`
- Modify: `docs/testing/manual-room-streaming-checklist.md`

- [ ] **Step 1: Remove joined-room fake social state from viewer mock state**

Update `apps/viewer-web/src/viewer-mock-state.ts` so mock state only describes pre-join defaults:

```ts
export type ViewerMockState = {
  username: string;
  viewerCount: number;
  messages: ViewerMockChatMessage[];
};
```

Remove `pingMs` and `connectionType` from `createViewerMockState()`.

Run:

```bash
rg -n "mock\\.pingMs|mock\\.connectionType" apps/viewer-web/src apps/viewer-web/test
```

Expected: no output.

- [ ] **Step 2: Keep extension mock state only as no-room fallback**

Leave `viewerDetails` and `messages` in `apps/extension/entrypoints/popup/mock-state.ts` for no-room demos and tests, but add a code comment above those fields:

```ts
  // Used only before real room activity arrives.
  messages: ExtensionChatMessage[];
  viewerDetails: ViewerConnectionRow[];
```

This comment is useful because those fields intentionally remain as fallback state.

- [ ] **Step 3: Verify manual checklist**

Ensure `docs/testing/manual-room-streaming-checklist.md` includes room activity smoke checks:

```md
- [ ] In the popup `Chat` tab, confirm host and viewer messages appear on both sides after sending.
- [ ] Join Viewer A and Viewer B, edit both random names, and confirm the popup viewer table updates.
- [ ] Refresh the host popup and one viewer, then confirm the current roster and recent chat history are restored.
- [ ] Disconnect one viewer and confirm an offline row remains visible without counting as an online viewer.
- [ ] Try sending while the host signaling socket is unavailable and confirm the draft is preserved or a clear failure is shown.
```

- [ ] **Step 4: Run targeted tests**

Run:

```bash
pnpm --filter @screenmate/shared test
pnpm --filter @screenmate/cloudflare test
pnpm --filter @screenmate/viewer-web test
pnpm --filter @screenmate/extension test
```

Expected: all workspace test suites PASS.

- [ ] **Step 5: Run full repo verification**

Run:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Expected:

- `pnpm typecheck` PASS
- `pnpm test` PASS
- `pnpm build` PASS

- [ ] **Step 6: Commit cleanup and docs**

Run:

```bash
git add apps/viewer-web/src/viewer-mock-state.ts apps/extension/entrypoints/popup/mock-state.ts docs/testing/manual-room-streaming-checklist.md
git commit -m "chore: document room activity verification"
```

Expected: commit succeeds.

---

## Implementation Notes

- Keep activity broadcasts separate from media negotiation messages. Existing `viewer-joined` and `viewer-left` messages must continue to reach the host content runtime for peer setup and cleanup.
- Do not make the presenter components aware of mock versus real provenance. The scene adapters and runtime snapshots own that distinction.
- Use `signalEnvelopeSchema.parse()` before sending any locally created WebSocket envelope.
- Prefer replacing local activity snapshots from `viewer-roster` and `chat-history` rather than merging them with stale client state.
- Keep chat message ids canonical from the Durable Object. Clients should not display optimistic messages in this first pass.
- The Durable Object should be the only place that assigns canonical sender fields for chat.
- Deploy shared/server protocol support before viewer-web or extension clients that send room activity envelopes. Old servers close sockets on unknown message types, so mixed rollout requires either server-first deployment or an explicit activity capability flag before clients send `viewer-profile`, `viewer-metrics`, or `chat-message`.
- Do not log token-bearing WebSocket URLs or chat text. Use redacted URLs and privacy-safe metadata only.
- Keep permissive CORS only for dev/test. Production deployment notes should include the allowed-origin configuration before room activity chat is exposed.

## Self-Review

- Spec coverage: The plan covers shared schemas, Durable Object persistence and broadcasts, viewer profile/chat/metrics, extension popup replacement of mock roster/chat, and manual verification.
- Scope check: Passwords, screen share, upload source, content-page chat, external storage, and UI redesign are explicitly excluded.
- Type consistency: Shared names are consistent across tasks: `ViewerRosterEntry`, `RoomChatMessage`, `RoomConnectionType`, `viewer-roster`, `chat-history`, `viewer-profile`, `viewer-metrics`, `chat-message`, and `chat-message-created`.
