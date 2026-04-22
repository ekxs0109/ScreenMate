# Room/Source Decoupling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple the ScreenMate room lifecycle from the page video lifecycle so refreshes and `<video>` replacement do not close the room, viewers stay joined, and the host can reattach any new video to the existing room.

**Architecture:** Extend shared signaling with source-state awareness, introduce a storage-backed background `HostRoomRuntime` as the room authority, and replace the content-side `host-controller` with a disposable `SourceAttachmentRuntime` that owns page-bound capture and peer transport. The popup becomes a control surface for background room snapshots, and the viewer keeps the room open through `recovering` and `missing` source states.

**Tech Stack:** TypeScript, WXT MV3 extension runtime, React, Vitest, Zod, WebSocket signaling, WebRTC

---

## File Map

- `packages/shared/src/room.ts`
  Shared room lifecycle and room source-state enums used by the extension, viewer, and Cloudflare signaling payloads.
- `packages/shared/src/signaling.ts`
  Shared Zod schema for signaling envelopes, including the richer `room-state` payload.
- `packages/shared/src/index.ts`
  Shared barrel export for the new room/source-state types.
- `packages/shared/test/signaling.test.ts`
  Contract tests for the new `room-state` payload shape.
- `apps/extension/entrypoints/background/host-room-snapshot.ts`
  New background-side host snapshot types, source fingerprint helpers, and pure state transitions.
- `apps/extension/entrypoints/background/host-room-runtime.ts`
  New background authority for room lifecycle, storage-backed resume, signaling state, and recovery timers.
- `apps/extension/entrypoints/background.ts`
  Runtime message router that delegates room/session work to `HostRoomRuntime`.
- `apps/extension/entrypoints/content/source-attachment.ts`
  New content-side attachment runtime for capture, peer negotiation, source detach detection, and outbound signaling.
- `apps/extension/entrypoints/content.ts`
  Content bootstrap that advertises `content-ready`, exposes attach/detach handlers, and tears down cleanly on invalidation.
- `apps/extension/entrypoints/content/video-detector.ts`
  Extend video scans with deterministic source fingerprints while keeping DOM-local ephemeral `videoId` values.
- `apps/extension/entrypoints/popup/view-model.ts`
  New pure helper that maps room/source states to popup labels and button text.
- `apps/extension/entrypoints/popup/useHostControls.ts`
  Reads `screenmate:get-room-session`, runs `start-room`/`attach-source`/`stop-room`, and keeps selection stable across rescans.
- `apps/extension/entrypoints/popup/App.tsx`
  Renders room lifecycle and source-state explicitly instead of relying on the old `status` string.
- `apps/extension/wxt.config.ts`
  Adds `storage` permission for `chrome.storage.session`.
- `apps/extension/test/host-room-snapshot.test.ts`
  New pure-state tests for background room/source transitions.
- `apps/extension/test/host-room-runtime.test.ts`
  New runtime tests for storage-backed recovery logic.
- `apps/extension/test/source-attachment.test.ts`
  New content attachment tests for source detach and signaling behavior.
- `apps/extension/test/background.test.ts`
  Update message-router tests for the new room/session protocol.
- `apps/extension/test/video-detector.test.ts`
  Extend scan tests to assert source fingerprint generation.
- `apps/extension/test/popup-view-model.test.ts`
  New popup-state regression tests without adding new UI test libraries.
- `apps/extension/test/popup-logging.test.ts`
  Keep logging behavior aligned with the new room/session terminology.
- `apps/viewer-web/src/lib/api.ts`
  Extend room-state responses with `sourceState`.
- `apps/viewer-web/src/lib/session-state.ts`
  Add viewer `sourceState`.
- `apps/viewer-web/src/viewer-session.ts`
  Keep viewers in the room during source recovery and accept reoffers after reattachment.
- `apps/viewer-web/src/components/ViewerPlayer.tsx`
  Render `recovering`, `missing`, and `closed` distinctly.
- `apps/viewer-web/test/viewer-session.test.ts`
  Add recovery-state and reoffer tests.
- `apps/viewer-web/test/viewer-player.test.tsx`
  New UI-level assertions for recovery and missing states.
- `docs/testing/manual-room-streaming-checklist.md`
  Add refresh/recover/reattach manual verification coverage.
- Delete after migration:
  `apps/extension/entrypoints/content/host-controller.ts`
  `apps/extension/entrypoints/content/host-session.ts`
  `apps/extension/test/host-controller.test.ts`
  `apps/extension/test/host-session.test.ts`

## Task 1: Extend Shared Room/Source Signaling Contracts

**Files:**
- Modify: `packages/shared/src/room.ts`
- Modify: `packages/shared/src/signaling.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/signaling.test.ts`

- [ ] **Step 1: Write the failing shared-contract test**

Add this test block to `packages/shared/test/signaling.test.ts`:

```ts
it("requires sourceState and viewerCount in room-state envelopes", () => {
  const result = signalEnvelopeSchema.safeParse({
    roomId: "room_123",
    sessionId: "host_1",
    role: "host",
    messageType: "room-state",
    timestamp: 11,
    payload: {
      state: "degraded",
      sourceState: "recovering",
      viewerCount: 2,
    },
  });

  expect(result.success).toBe(true);
});

it("exports the approved room source states", () => {
  expect(roomSourceStateSchema.parse("attached")).toBe("attached");
  expect(roomSourceStateSchema.parse("recovering")).toBe("recovering");
  expect(roomSourceStateSchema.parse("missing")).toBe("missing");
});
```

- [ ] **Step 2: Run the shared tests to verify they fail**

Run:

```bash
pnpm --filter @screenmate/shared test -- test/signaling.test.ts
```

Expected: FAIL because `roomSourceStateSchema` does not exist yet and `room-state` payloads do not accept `sourceState` or `viewerCount`.

- [ ] **Step 3: Write the minimal shared implementation**

Update `packages/shared/src/room.ts` to export the new schema and types:

```ts
import { z } from "zod";

export const roomStateSchema = z.enum([
  "idle",
  "hosting",
  "streaming",
  "degraded",
  "closed",
]);

export const roomSourceStateSchema = z.enum([
  "attached",
  "recovering",
  "missing",
]);

export type RoomState = z.infer<typeof roomStateSchema>;
export type RoomSourceState = z.infer<typeof roomSourceStateSchema>;
```

Update the `room-state` payload in `packages/shared/src/signaling.ts`:

```ts
import { roomSourceStateSchema, roomStateSchema } from "./room.js";

const roomStatePayloadSchema = z.object({
  state: roomStateSchema,
  sourceState: roomSourceStateSchema,
  viewerCount: z.number().int().nonnegative(),
});
```

Export the new schema from `packages/shared/src/index.ts`:

```ts
export * from "./room.js";
export * from "./signaling.js";
export * from "./token.js";
export * from "./errors.js";
```

- [ ] **Step 4: Run the shared test and typecheck commands**

Run:

```bash
pnpm --filter @screenmate/shared test -- test/signaling.test.ts
pnpm --filter @screenmate/shared typecheck
```

Expected:

- `PASS packages/shared/test/signaling.test.ts`
- `tsc --noEmit` exits with code `0`

- [ ] **Step 5: Commit the shared contract change**

Run:

```bash
git add packages/shared/src/room.ts packages/shared/src/signaling.ts packages/shared/src/index.ts packages/shared/test/signaling.test.ts
git commit -m "feat(shared): add room source state signaling"
```

## Task 2: Add a Storage-Backed Background Room Snapshot Runtime

**Files:**
- Create: `apps/extension/entrypoints/background/host-room-snapshot.ts`
- Create: `apps/extension/entrypoints/background/host-room-runtime.ts`
- Modify: `apps/extension/wxt.config.ts`
- Test: `apps/extension/test/host-room-snapshot.test.ts`
- Test: `apps/extension/test/host-room-runtime.test.ts`

- [ ] **Step 1: Write the failing background snapshot/runtime tests**

Create `apps/extension/test/host-room-snapshot.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createHostRoomSnapshot,
  createHostRoomStore,
} from "../entrypoints/background/host-room-snapshot";

describe("createHostRoomStore", () => {
  it("keeps the room open while source recovery is in progress", () => {
    const store = createHostRoomStore(() => 1_000);

    store.openRoom({
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
    });
    store.markRecovering("Page refreshed.");

    expect(store.getSnapshot()).toEqual(
      createHostRoomSnapshot({
        roomLifecycle: "degraded",
        sourceState: "recovering",
        roomId: "room_123",
        activeTabId: 42,
        activeFrameId: 0,
        viewerCount: 0,
        message: "Page refreshed.",
        recoverByTimestamp: 16_000,
      }),
    );
  });
});
```

Create `apps/extension/test/host-room-runtime.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createHostRoomRuntime } from "../entrypoints/background/host-room-runtime";

describe("createHostRoomRuntime", () => {
  it("restores an expired recovery session as source missing", async () => {
    const storage = {
      get: vi.fn().mockResolvedValue({
        screenmateHostRoomSession: {
          roomId: "room_123",
          hostSessionId: "host_1",
          hostToken: "host-token",
          signalingUrl: "/rooms/room_123/ws",
          iceServers: [],
          activeTabId: 42,
          activeFrameId: 0,
          viewerSessionIds: ["viewer_1"],
          viewerCount: 1,
          sourceFingerprint: null,
          recoverByTimestamp: 900,
        },
      }),
      set: vi.fn(),
      remove: vi.fn(),
    };

    const runtime = createHostRoomRuntime({
      storage,
      now: () => 1_000,
    });

    await runtime.restoreFromStorage();

    expect(runtime.getSnapshot()).toMatchObject({
      roomLifecycle: "open",
      sourceState: "missing",
      roomId: "room_123",
      viewerCount: 1,
    });
  });
});
```

- [ ] **Step 2: Run the extension tests to verify they fail**

Run:

```bash
pnpm --filter @screenmate/extension test -- test/host-room-snapshot.test.ts test/host-room-runtime.test.ts
```

Expected: FAIL because the background snapshot/runtime modules do not exist yet.

- [ ] **Step 3: Write the snapshot store, runtime, and storage permission**

Create `apps/extension/entrypoints/background/host-room-snapshot.ts`:

```ts
export type HostRoomLifecycle = "idle" | "opening" | "open" | "degraded" | "closed";
export type HostSourceState =
  | "unattached"
  | "attaching"
  | "attached"
  | "recovering"
  | "missing";

export type SourceFingerprint = {
  tabId: number;
  frameId: number;
  primaryUrl: string | null;
  elementId: string | null;
  label: string;
  visibleIndex: number;
};

export type PersistedHostRoomSession = {
  roomId: string;
  hostSessionId: string;
  hostToken: string;
  signalingUrl: string;
  iceServers: RTCIceServer[];
  activeTabId: number;
  activeFrameId: number;
  viewerSessionIds: string[];
  viewerCount: number;
  sourceFingerprint: SourceFingerprint | null;
  recoverByTimestamp: number | null;
};

export type HostRoomSnapshot = {
  roomLifecycle: HostRoomLifecycle;
  sourceState: HostSourceState;
  roomId: string | null;
  viewerCount: number;
  sourceLabel: string | null;
  activeTabId: number | null;
  activeFrameId: number | null;
  recoverByTimestamp: number | null;
  message: string | null;
};

export function createHostRoomSnapshot(
  overrides: Partial<HostRoomSnapshot> = {},
): HostRoomSnapshot {
  return {
    roomLifecycle: "idle",
    sourceState: "unattached",
    roomId: null,
    viewerCount: 0,
    sourceLabel: null,
    activeTabId: null,
    activeFrameId: null,
    recoverByTimestamp: null,
    message: null,
    ...overrides,
  };
}

export function createHostRoomStore(now: () => number, recoverWindowMs = 15_000) {
  let snapshot = createHostRoomSnapshot();

  return {
    getSnapshot: () => snapshot,
    openRoom(session: PersistedHostRoomSession) {
      snapshot = createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "unattached",
        roomId: session.roomId,
        viewerCount: session.viewerCount,
        activeTabId: session.activeTabId,
        activeFrameId: session.activeFrameId,
      });
      return snapshot;
    },
    setAttached(sourceLabel: string) {
      snapshot = {
        ...snapshot,
        roomLifecycle: "open",
        sourceState: "attached",
        sourceLabel,
        message: null,
        recoverByTimestamp: null,
      };
      return snapshot;
    },
    markRecovering(message: string) {
      snapshot = {
        ...snapshot,
        roomLifecycle: "degraded",
        sourceState: "recovering",
        message,
        recoverByTimestamp: now() + recoverWindowMs,
      };
      return snapshot;
    },
    markMissing(message: string) {
      snapshot = {
        ...snapshot,
        roomLifecycle: "open",
        sourceState: "missing",
        message,
        recoverByTimestamp: null,
      };
      return snapshot;
    },
    setViewerCount(viewerCount: number) {
      snapshot = {
        ...snapshot,
        viewerCount: Math.max(0, viewerCount),
      };
      return snapshot;
    },
    close(message: string) {
      snapshot = {
        ...snapshot,
        roomLifecycle: "closed",
        sourceState: "missing",
        message,
        recoverByTimestamp: null,
      };
      return snapshot;
    },
  };
}
```

Create `apps/extension/entrypoints/background/host-room-runtime.ts`:

```ts
import {
  createHostRoomStore,
  type PersistedHostRoomSession,
  type HostRoomSnapshot,
  type SourceFingerprint,
} from "./host-room-snapshot";

const STORAGE_KEY = "screenmateHostRoomSession";

type SessionStorageLike = {
  get: (key: string) => Promise<Record<string, PersistedHostRoomSession | undefined>>;
  set: (value: Record<string, PersistedHostRoomSession>) => Promise<void>;
  remove: (key: string) => Promise<void>;
};

export function createHostRoomRuntime(options: {
  storage: SessionStorageLike;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const store = createHostRoomStore(now);
  let session: PersistedHostRoomSession | null = null;

  async function persist() {
    if (session) {
      await options.storage.set({ [STORAGE_KEY]: session });
      return;
    }

    await options.storage.remove(STORAGE_KEY);
  }

  return {
    getSnapshot(): HostRoomSnapshot {
      return store.getSnapshot();
    },
    async startRoom(input: PersistedHostRoomSession) {
      session = input;
      store.openRoom(input);
      await persist();
      return store.getSnapshot();
    },
    getAttachSession() {
      if (!session) {
        return null;
      }

      return {
        roomId: session.roomId,
        sessionId: session.hostSessionId,
        viewerSessionIds: session.viewerSessionIds,
        iceServers: session.iceServers,
      };
    },
    getSourceFingerprint() {
      return session?.sourceFingerprint ?? null;
    },
    async setViewerCount(viewerCount: number) {
      if (session) {
        session = { ...session, viewerCount };
        store.setViewerCount(viewerCount);
        await persist();
      }
      return store.getSnapshot();
    },
    async setViewerSessions(viewerSessionIds: string[]) {
      if (session) {
        session = {
          ...session,
          viewerSessionIds,
          viewerCount: viewerSessionIds.length,
        };
        store.setViewerCount(viewerSessionIds.length);
        await persist();
      }
      return store.getSnapshot();
    },
    async setAttachedSource(sourceLabel: string, fingerprint: SourceFingerprint) {
      if (session) {
        session = { ...session, sourceFingerprint: fingerprint, recoverByTimestamp: null };
      }
      store.setAttached(sourceLabel);
      await persist();
      return store.getSnapshot();
    },
    async markRecovering(message: string) {
      const next = store.markRecovering(message);
      if (session) {
        session = { ...session, recoverByTimestamp: next.recoverByTimestamp };
      }
      await persist();
      return next;
    },
    async markMissing(message: string) {
      if (session) {
        session = { ...session, recoverByTimestamp: null };
      }
      const next = store.markMissing(message);
      await persist();
      return next;
    },
    async close(message: string) {
      session = null;
      const next = store.close(message);
      await persist();
      return next;
    },
    async restoreFromStorage() {
      const stored = (await options.storage.get(STORAGE_KEY))[STORAGE_KEY];
      if (!stored) {
        return store.getSnapshot();
      }

      session = stored;
      store.openRoom(stored);
      if (stored.recoverByTimestamp && stored.recoverByTimestamp > now()) {
        store.markRecovering("Recovering video source after background restart.");
      } else {
        store.markMissing("No video attached.");
      }
      return store.getSnapshot();
    },
  };
}
```

Add the storage permission in `apps/extension/wxt.config.ts`:

```ts
manifest: {
  permissions: ["activeTab", "tabs", "webNavigation", "storage"],
  host_permissions: ["http://*/*", "https://*/*"],
},
```

- [ ] **Step 4: Run the targeted extension tests and typecheck**

Run:

```bash
pnpm --filter @screenmate/extension test -- test/host-room-snapshot.test.ts test/host-room-runtime.test.ts
pnpm --filter @screenmate/extension typecheck
```

Expected:

- `PASS apps/extension/test/host-room-snapshot.test.ts`
- `PASS apps/extension/test/host-room-runtime.test.ts`
- `tsc --noEmit` exits with code `0`

- [ ] **Step 5: Commit the background runtime foundation**

Run:

```bash
git add apps/extension/entrypoints/background/host-room-snapshot.ts apps/extension/entrypoints/background/host-room-runtime.ts apps/extension/wxt.config.ts apps/extension/test/host-room-snapshot.test.ts apps/extension/test/host-room-runtime.test.ts
git commit -m "feat(extension): add host room runtime store"
```

## Task 3: Add Source Fingerprints and a Disposable Content Attachment Runtime

**Files:**
- Modify: `apps/extension/entrypoints/content/video-detector.ts`
- Create: `apps/extension/entrypoints/content/source-attachment.ts`
- Test: `apps/extension/test/video-detector.test.ts`
- Test: `apps/extension/test/source-attachment.test.ts`

- [ ] **Step 1: Write the failing fingerprint and attachment tests**

Append this test to `apps/extension/test/video-detector.test.ts`:

```ts
it("returns a recovery fingerprint for each visible video candidate", () => {
  document.body.innerHTML = `<video id="hero" src="https://example.com/hero.mp4"></video>`;
  const video = document.getElementById("hero") as HTMLVideoElement;
  setVideoRect(video, 640, 360);

  const [candidate] = listVisibleVideoCandidates();

  expect(candidate).toMatchObject({
    id: expect.stringMatching(/^screenmate-video-/),
    label: "https://example.com/hero.mp4",
    fingerprint: {
      primaryUrl: "https://example.com/hero.mp4",
      elementId: "hero",
      label: "https://example.com/hero.mp4",
      visibleIndex: 0,
    },
  });
});
```

Create `apps/extension/test/source-attachment.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createSourceAttachmentRuntime } from "../entrypoints/content/source-attachment";
import { getVideoHandle } from "../entrypoints/content/video-detector";

describe("createSourceAttachmentRuntime", () => {
  it("marks the source detached when the captured track ends", async () => {
    document.body.innerHTML = `<video id="host" src="https://example.com/host.mp4"></video>`;
    const video = document.getElementById("host") as HTMLVideoElement;
    const track = {
      kind: "video",
      stop: vi.fn(),
      addEventListener: vi.fn((type: string, listener: () => void) => {
        if (type === "ended") {
          listener();
        }
      }),
    } as unknown as MediaStreamTrack;

    Object.defineProperty(video, "captureStream", {
      configurable: true,
      value: vi.fn(() => ({ getTracks: () => [track] })),
    });

    const onSourceDetached = vi.fn();
    const runtime = createSourceAttachmentRuntime({
      now: () => 10,
      onSignal: vi.fn(),
      onSourceDetached,
      RTCPeerConnectionImpl: class {
        addEventListener() {}
        addTrack() {}
        async createOffer() {
          return { sdp: "offer-sdp" };
        }
        async setLocalDescription() {}
        async setRemoteDescription() {}
        async addIceCandidate() {}
        close() {}
      } as never,
    });

    await runtime.attachSource({
      roomId: "room_123",
      sessionId: "host_1",
      videoId: getVideoHandle(video),
      viewerSessionIds: [],
      iceServers: [],
    });

    expect(onSourceDetached).toHaveBeenCalledWith({
      reason: "track-ended",
      roomId: "room_123",
    });
  });
});
```

- [ ] **Step 2: Run the content tests to verify they fail**

Run:

```bash
pnpm --filter @screenmate/extension test -- test/video-detector.test.ts test/source-attachment.test.ts
```

Expected: FAIL because `listVisibleVideoCandidates` and `createSourceAttachmentRuntime` do not exist yet.

- [ ] **Step 3: Implement fingerprinted scans and the attachment runtime**

Update `apps/extension/entrypoints/content/video-detector.ts` to expose candidates with fingerprints:

```ts
export type VideoCandidate = {
  id: string;
  label: string;
  fingerprint: {
    primaryUrl: string | null;
    elementId: string | null;
    label: string;
    visibleIndex: number;
  };
};

export function listVisibleVideoCandidates(): VideoCandidate[] {
  return collectPageVideos().map((video, index) => {
    const label = formatVideoLabel(video, index);

    return {
      id: getVideoHandle(video),
      label,
      fingerprint: {
        primaryUrl: video.currentSrc || video.src || video.getAttribute("poster"),
        elementId: video.id || null,
        label,
        visibleIndex: index,
      },
    };
  });
}
```

Create `apps/extension/entrypoints/content/source-attachment.ts`:

```ts
import { normalizeIceServers } from "@screenmate/webrtc-core";
import { errorCodes } from "@screenmate/shared";
import { createPeerRegistry } from "./peer-manager";
import { captureVideoStream } from "./video-capture";
import { findVisibleVideoByHandle } from "./video-detector";

type HostPeerConnection = Pick<
  RTCPeerConnection,
  | "addEventListener"
  | "addTrack"
  | "createOffer"
  | "setLocalDescription"
  | "setRemoteDescription"
  | "addIceCandidate"
  | "close"
>;

export function createSourceAttachmentRuntime(options: {
  onSignal: (envelope: Record<string, unknown>) => void;
  onSourceDetached: (event: { roomId: string; reason: "track-ended" | "content-invalidated" | "manual-detach" }) => void;
  RTCPeerConnectionImpl?: new (config?: RTCConfiguration) => HostPeerConnection;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const RTCPeerConnectionImpl =
    options.RTCPeerConnectionImpl ?? globalThis.RTCPeerConnection;
  const peers = createPeerRegistry<HostPeerConnection>();
  let attachment: {
    roomId: string;
    sessionId: string;
    sourceLabel: string;
    stream: MediaStream;
    iceServers: RTCIceServer[];
  } | null = null;

  async function attachSource(input: {
    roomId: string;
    sessionId: string;
    videoId: string;
    viewerSessionIds: string[];
    iceServers: RTCIceServer[];
  }) {
    const video = findVisibleVideoByHandle(input.videoId);
    if (!video) {
      throw new Error(errorCodes.NO_VIDEO_FOUND);
    }

    const stream = captureVideoStream(video);
    for (const track of stream.getTracks()) {
      track.addEventListener("ended", () => {
        options.onSourceDetached({
          roomId: input.roomId,
          reason: "track-ended",
        });
      });
    }

    attachment = {
      roomId: input.roomId,
      sessionId: input.sessionId,
      sourceLabel: video.currentSrc || video.src || "Visible video",
      stream,
      iceServers: normalizeIceServers(input.iceServers) as RTCIceServer[],
    };

    for (const viewerSessionId of input.viewerSessionIds) {
      await beginViewerNegotiation(viewerSessionId);
    }

    return {
      sourceLabel: attachment.sourceLabel,
      fingerprint: {
        primaryUrl: video.currentSrc || video.src || video.getAttribute("poster"),
        elementId: video.id || null,
        label: attachment.sourceLabel,
        visibleIndex: listVisibleVideoCandidates().findIndex(
          (candidate) => candidate.id === input.videoId,
        ),
      },
    };
  }

  async function beginViewerNegotiation(viewerSessionId: string) {
    if (!attachment || peers.get(viewerSessionId)) {
      return;
    }

    const connection = new RTCPeerConnectionImpl({
      iceServers: attachment.iceServers,
    });
    peers.begin(viewerSessionId, connection);

    for (const track of attachment.stream.getTracks()) {
      connection.addTrack(track, attachment.stream);
    }

    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    options.onSignal({
      roomId: attachment.roomId,
      sessionId: attachment.sessionId,
      role: "host",
      messageType: "offer",
      timestamp: now(),
      payload: {
        targetSessionId: viewerSessionId,
        sdp: offer.sdp ?? "",
      },
    });
  }

  async function handleSignal(envelope: {
    messageType: string;
    sessionId: string;
    payload: {
      viewerSessionId?: string;
      sdp?: string;
      candidate?: string;
      sdpMid?: string | null;
      sdpMLineIndex?: number | null;
    };
  }) {
    if (envelope.messageType === "viewer-joined" && envelope.payload.viewerSessionId) {
      await beginViewerNegotiation(envelope.payload.viewerSessionId);
      return;
    }

    const peer = peers.get(envelope.sessionId);
    if (!peer) {
      return;
    }

    if (envelope.messageType === "answer" && envelope.payload.sdp) {
      await peer.connection.setRemoteDescription({
        type: "answer",
        sdp: envelope.payload.sdp,
      });
      peers.connected(envelope.sessionId);
      return;
    }

    if (envelope.messageType === "ice-candidate" && envelope.payload.candidate) {
      await peer.connection.addIceCandidate({
        candidate: envelope.payload.candidate,
        sdpMid: envelope.payload.sdpMid ?? null,
        sdpMLineIndex: envelope.payload.sdpMLineIndex ?? null,
      });
    }
  }

  function destroy(reason: "content-invalidated" | "manual-detach" = "content-invalidated") {
    peers.closeAll();
    for (const track of attachment?.stream.getTracks() ?? []) {
      track.stop();
    }
    if (attachment) {
      options.onSourceDetached({
        roomId: attachment.roomId,
        reason,
      });
    }
    attachment = null;
  }

  return {
    attachSource,
    beginViewerNegotiation,
    handleSignal,
    destroy,
  };
}
```

- [ ] **Step 4: Run the content tests and extension typecheck**

Run:

```bash
pnpm --filter @screenmate/extension test -- test/video-detector.test.ts test/source-attachment.test.ts
pnpm --filter @screenmate/extension typecheck
```

Expected:

- `PASS apps/extension/test/video-detector.test.ts`
- `PASS apps/extension/test/source-attachment.test.ts`
- `tsc --noEmit` exits with code `0`

- [ ] **Step 5: Commit the content attachment foundation**

Run:

```bash
git add apps/extension/entrypoints/content/video-detector.ts apps/extension/entrypoints/content/source-attachment.ts apps/extension/test/video-detector.test.ts apps/extension/test/source-attachment.test.ts
git commit -m "feat(extension): add source attachment runtime"
```

## Task 4: Wire the Background Room Runtime to the Content Attachment Runtime

**Files:**
- Modify: `apps/extension/entrypoints/background/host-room-runtime.ts`
- Modify: `apps/extension/entrypoints/background.ts`
- Modify: `apps/extension/entrypoints/content.ts`
- Modify: `apps/extension/test/background.test.ts`
- Delete: `apps/extension/entrypoints/content/host-controller.ts`
- Delete: `apps/extension/entrypoints/content/host-session.ts`
- Delete: `apps/extension/test/host-controller.test.ts`
- Delete: `apps/extension/test/host-session.test.ts`

- [ ] **Step 1: Write the failing routing/recovery tests**

Add these assertions to `apps/extension/test/background.test.ts`:

```ts
it("returns the background room snapshot without querying content frames", async () => {
  const handler = createHostMessageHandler({
    queryActiveTabId: vi.fn().mockResolvedValue(42),
    queryFrameIds: vi.fn(),
    sendTabMessage: vi.fn(),
    runtime: {
      getSnapshot: vi.fn().mockReturnValue({
        roomLifecycle: "open",
        sourceState: "missing",
        roomId: "room_123",
        viewerCount: 2,
        sourceLabel: null,
        activeTabId: 42,
        activeFrameId: 0,
        recoverByTimestamp: null,
        message: "No video attached.",
      }),
    } as never,
  });

  const result = await handler({ type: "screenmate:get-room-session" });

  expect(result).toMatchObject({
    roomLifecycle: "open",
    sourceState: "missing",
    roomId: "room_123",
    viewerCount: 2,
  });
});

it("keeps the room open when the source detaches", async () => {
  const markRecovering = vi.fn().mockResolvedValue({
    roomLifecycle: "degraded",
    sourceState: "recovering",
    roomId: "room_123",
  });
  const handler = createHostMessageHandler({
    queryActiveTabId: vi.fn().mockResolvedValue(42),
    queryFrameIds: vi.fn().mockResolvedValue([0]),
    sendTabMessage: vi.fn(),
    runtime: {
      getSnapshot: vi.fn(),
      markRecovering,
    } as never,
  });

  await handler({
    type: "screenmate:source-detached",
    frameId: 0,
    reason: "track-ended",
  });

  expect(markRecovering).toHaveBeenCalledWith("track-ended");
});

it("auto-reattaches when content-ready reports an exact fingerprint match", async () => {
  const sendTabMessage = vi.fn().mockResolvedValue({
    sourceLabel: "https://example.com/hero.mp4",
    fingerprint: {
      primaryUrl: "https://example.com/hero.mp4",
      elementId: "hero",
      label: "https://example.com/hero.mp4",
      visibleIndex: 0,
    },
  });
  const handler = createHostMessageHandler({
    queryActiveTabId: vi.fn().mockResolvedValue(42),
    queryFrameIds: vi.fn().mockResolvedValue([0]),
    sendTabMessage,
    runtime: {
      getSnapshot: vi.fn().mockReturnValue({
        roomLifecycle: "degraded",
        sourceState: "recovering",
        roomId: "room_123",
        viewerCount: 1,
      }),
      getAttachSession: vi.fn().mockReturnValue({
        roomId: "room_123",
        sessionId: "host_1",
        viewerSessionIds: ["viewer_1"],
        iceServers: [],
      }),
      getSourceFingerprint: vi.fn().mockReturnValue({
        tabId: 42,
        frameId: 0,
        primaryUrl: "https://example.com/hero.mp4",
        elementId: "hero",
        label: "https://example.com/hero.mp4",
        visibleIndex: 0,
      }),
      setAttachedSource: vi.fn().mockResolvedValue(undefined),
    } as never,
  });

  await handler({
    type: "screenmate:content-ready",
    frameId: 0,
    videos: [
      {
        id: "screenmate-video-1",
        label: "https://example.com/hero.mp4",
        frameId: 0,
        fingerprint: {
          primaryUrl: "https://example.com/hero.mp4",
          elementId: "hero",
          label: "https://example.com/hero.mp4",
          visibleIndex: 0,
        },
      },
    ],
  });

  expect(sendTabMessage).toHaveBeenCalledWith(
    42,
    expect.objectContaining({
      type: "screenmate:attach-source",
      videoId: "screenmate-video-1",
    }),
    { frameId: 0 },
  );
});
```

- [ ] **Step 2: Run the routing test to verify it fails**

Run:

```bash
pnpm --filter @screenmate/extension test -- test/background.test.ts
```

Expected: FAIL because `screenmate:get-room-session` and `screenmate:source-detached` are not part of the message handler yet.

- [ ] **Step 3: Replace the old content host-controller path with background/content room routing**

Update the message types in `apps/extension/entrypoints/background.ts`:

```ts
export type HostMessage =
  | { type: "screenmate:get-room-session" }
  | { type: "screenmate:list-videos" }
  | { type: "screenmate:start-room"; frameId: number }
  | { type: "screenmate:attach-source"; videoId: string; frameId: number }
  | { type: "screenmate:stop-room" }
  | {
      type: "screenmate:content-ready";
      frameId: number;
      videos: TabVideoSource[];
    }
  | {
      type: "screenmate:source-detached";
      frameId: number;
      reason: "track-ended" | "content-invalidated" | "manual-detach";
    }
  | {
      type: "screenmate:signal-outbound";
      envelope: Record<string, unknown>;
    }
  | {
      type: "screenmate:signal-inbound";
      envelope: Record<string, unknown>;
      frameId: number;
    }
  | {
      type: "screenmate:preview-video";
      videoId: string;
      frameId: number;
      label: string;
      active?: boolean;
    }
  | { type: "screenmate:clear-preview" };
```

Change the background handler so the room snapshot comes from the runtime and room actions no longer query per-frame host state:

```ts
// host-room-runtime.ts
type HostSocket = Pick<
  WebSocket,
  "addEventListener" | "close" | "readyState" | "send"
>;

let socket: HostSocket | null = null;

async function applyViewerSessions(viewerSessionIds: string[]) {
  session = {
    ...session!,
    viewerSessionIds,
    viewerCount: viewerSessionIds.length,
  };
  store.setViewerCount(viewerSessionIds.length);
  await persist();
}

async function connectSignaling(onInboundSignal: (envelope: SignalEnvelope) => Promise<void>) {
  if (!session) {
    return;
  }

  socket?.close();
  socket = new WebSocketImpl(
    toScreenMateWebSocketUrl(session.signalingUrl, session.hostToken, apiBaseUrl),
  );

  socket.addEventListener("message", async (event) => {
    const envelope = signalEnvelopeSchema.parse(JSON.parse((event as MessageEvent).data));

    if (envelope.messageType === "viewer-joined") {
      const nextViewerIds = [...new Set([...session!.viewerSessionIds, envelope.payload.viewerSessionId])];
      await applyViewerSessions(nextViewerIds);
    }

    if (envelope.messageType === "viewer-left") {
      const nextViewerIds = session!.viewerSessionIds.filter(
        (viewerSessionId) => viewerSessionId !== envelope.payload.viewerSessionId,
      );
      await applyViewerSessions(nextViewerIds);
    }

    await onInboundSignal(envelope);
  });
}

async function sendSignal(envelope: SignalEnvelope) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(envelope));
}

// background.ts
if (message.type === "screenmate:get-room-session") {
  return dependencies.runtime.getSnapshot();
}

if (message.type === "screenmate:start-room") {
  const roomResponse = await internalHandler({
    type: "screenmate:create-room",
    apiBaseUrl: getScreenMateApiBaseUrl(),
  });

  if (!roomResponse || "error" in roomResponse) {
    return dependencies.runtime.markMissing(
      typeof roomResponse?.error === "string"
        ? roomResponse.error
        : "Failed to create room.",
    );
  }

  return dependencies.runtime.startRoom({
    roomId: roomResponse.roomId,
    hostSessionId: roomResponse.hostSessionId ?? "host",
    hostToken: roomResponse.hostToken,
    signalingUrl: roomResponse.signalingUrl,
    iceServers: roomResponse.iceServers ?? [],
    activeTabId: tabId,
    activeFrameId: message.frameId,
    viewerSessionIds: [],
    viewerCount: 0,
    sourceFingerprint: null,
    recoverByTimestamp: null,
  });
}

if (message.type === "screenmate:attach-source") {
  const attachSession = dependencies.runtime.getAttachSession();
  if (!attachSession) {
    return dependencies.runtime.markMissing("Start a room before attaching a source.");
  }

  const response = await sendMessageToFrame(
    dependencies,
    tabId,
    message.frameId,
    {
      type: "screenmate:attach-source",
      videoId: message.videoId,
      frameId: message.frameId,
      roomSession: attachSession,
    },
  );

  if (!Array.isArray(response) && !("ok" in response) && response.sourceLabel) {
    await dependencies.runtime.setAttachedSource(response.sourceLabel, {
      tabId,
      frameId: message.frameId,
      ...response.fingerprint,
    });
  }

  return dependencies.runtime.getSnapshot();
}

if (message.type === "screenmate:source-detached") {
  return dependencies.runtime.markRecovering(message.reason);
}

if (message.type === "screenmate:content-ready") {
  const attachSession = dependencies.runtime.getAttachSession();
  const previousFingerprint = dependencies.runtime.getSourceFingerprint();

  if (!attachSession || !previousFingerprint) {
    return dependencies.runtime.getSnapshot();
  }

  const matchingVideo = message.videos.find(
    (video) =>
      video.frameId === previousFingerprint.frameId &&
      video.fingerprint.primaryUrl !== null &&
      video.fingerprint.primaryUrl === previousFingerprint.primaryUrl,
  );

  if (!matchingVideo) {
    return dependencies.runtime.markMissing("No video attached.");
  }

  const response = await sendMessageToFrame(
    dependencies,
    tabId,
    matchingVideo.frameId,
    {
      type: "screenmate:attach-source",
      videoId: matchingVideo.id,
      frameId: matchingVideo.frameId,
      roomSession: attachSession,
    },
  );

  if (!Array.isArray(response) && !("ok" in response) && response.sourceLabel) {
    await dependencies.runtime.setAttachedSource(response.sourceLabel, {
      tabId,
      frameId: matchingVideo.frameId,
      ...response.fingerprint,
    });
  }

  return dependencies.runtime.getSnapshot();
}

if (message.type === "screenmate:signal-outbound") {
  await dependencies.runtime.sendSignal(message.envelope);
  return dependencies.runtime.getSnapshot();
}

await dependencies.runtime.connectSignaling(async (envelope) => {
  if (envelope.messageType === "answer" || envelope.messageType === "ice-candidate") {
    const activeFrameId = dependencies.runtime.getSnapshot().activeFrameId;
    if (activeFrameId !== null) {
      await dependencies.sendTabMessage(
        tabId,
        { type: "screenmate:signal-inbound", envelope, frameId: activeFrameId },
        { frameId: activeFrameId },
      );
    }
  }
});
```

Update `apps/extension/entrypoints/content.ts` to bootstrap `createSourceAttachmentRuntime`, send `content-ready` on startup, and forward attach/signal messages:

```ts
const attachmentRuntime = createSourceAttachmentRuntime({
  onSignal(envelope) {
    void browser.runtime.sendMessage({
      type: "screenmate:signal-outbound",
      envelope,
    });
  },
  onSourceDetached(event) {
    void browser.runtime.sendMessage({
      type: "screenmate:source-detached",
      frameId: window === window.top ? 0 : 1,
      reason: event.reason,
    });
  },
});

void browser.runtime.sendMessage({
  type: "screenmate:content-ready",
  frameId: 0,
  videos: listVisibleVideoCandidates().map((video) => ({
    ...video,
    frameId: 0,
  })),
});

if (message.type === "screenmate:attach-source") {
  void attachmentRuntime
    .attachSource({
      roomId: message.roomSession.roomId,
      sessionId: message.roomSession.sessionId,
      videoId: message.videoId,
      viewerSessionIds: message.roomSession.viewerSessionIds,
      iceServers: message.roomSession.iceServers,
    })
    .then(({ sourceLabel, fingerprint }) => {
      sendResponse({
        sourceLabel,
        fingerprint,
      });
    });
  return true;
}

if (message.type === "screenmate:signal-inbound") {
  void attachmentRuntime.handleSignal(message.envelope);
  sendResponse({ ok: true });
  return true;
}
```

In the real `browser.runtime.onMessage` listener, prefer `_sender.frameId ?? 0` when processing `screenmate:content-ready` and `screenmate:source-detached`. Keep the explicit `frameId` in tests so the routing stays easy to exercise without a browser sender object.

Delete the obsolete content-side room owner and tests:

```bash
rm apps/extension/entrypoints/content/host-controller.ts
rm apps/extension/entrypoints/content/host-session.ts
rm apps/extension/test/host-controller.test.ts
rm apps/extension/test/host-session.test.ts
```

- [ ] **Step 4: Run the extension routing tests and full extension test suite**

Run:

```bash
pnpm --filter @screenmate/extension test -- test/background.test.ts test/video-detector.test.ts test/source-attachment.test.ts test/video-preview.test.ts
pnpm --filter @screenmate/extension typecheck
```

Expected:

- The updated background and content tests pass.
- The removed `host-controller` / `host-session` files no longer appear in the test run.
- `tsc --noEmit` exits with code `0`

- [ ] **Step 5: Commit the background/content wiring**

Run:

```bash
git add apps/extension/entrypoints/background.ts apps/extension/entrypoints/content.ts apps/extension/test/background.test.ts apps/extension/entrypoints/content/source-attachment.ts apps/extension/entrypoints/content/video-detector.ts
git add -u apps/extension/entrypoints/content apps/extension/test
git commit -m "feat(extension): wire room recovery through background"
```

## Task 5: Update the Popup to Control Rooms and Source Attachments Separately

**Files:**
- Create: `apps/extension/entrypoints/popup/view-model.ts`
- Modify: `apps/extension/entrypoints/popup/useHostControls.ts`
- Modify: `apps/extension/entrypoints/popup/App.tsx`
- Modify: `apps/extension/entrypoints/popup/popup.css`
- Create: `apps/extension/test/popup-view-model.test.ts`
- Modify: `apps/extension/test/popup-logging.test.ts`

- [ ] **Step 1: Write the failing popup state tests**

Create `apps/extension/test/popup-view-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getPopupViewModel } from "../entrypoints/popup/view-model";

describe("getPopupViewModel", () => {
  it("shows attach copy when the room is open but source missing", () => {
    expect(
      getPopupViewModel({
        roomLifecycle: "open",
        sourceState: "missing",
        roomId: "room_123",
        viewerCount: 2,
        sourceLabel: null,
        activeTabId: 42,
        activeFrameId: 0,
        recoverByTimestamp: null,
        message: "No video attached.",
      }),
    ).toMatchObject({
      primaryActionLabel: "Attach selected video",
      statusText: "Room open · No video attached",
      canStop: true,
    });
  });
});
```

Update `apps/extension/test/popup-logging.test.ts` with a room-attach success case:

```ts
it("logs successful attach snapshots with info severity", () => {
  const logger = createLoggerDouble();
  const snapshot = {
    roomLifecycle: "open",
    sourceState: "attached",
    roomId: "room_123",
    viewerCount: 1,
    sourceLabel: "Video 2",
    activeTabId: 42,
    activeFrameId: 0,
    recoverByTimestamp: null,
    message: null,
  };

  reportRoomActionResult(logger, snapshot, snapshot);

  expect(logger.info).toHaveBeenCalledWith(
    "Room action returned a snapshot.",
    expect.objectContaining({
      roomId: "room_123",
      sourceState: "attached",
    }),
  );
});
```

- [ ] **Step 2: Run the popup tests to verify they fail**

Run:

```bash
pnpm --filter @screenmate/extension test -- test/popup-view-model.test.ts test/popup-logging.test.ts
```

Expected: FAIL because `getPopupViewModel` and `reportRoomActionResult` do not exist yet.

- [ ] **Step 3: Implement the popup view-model and room/source actions**

Create `apps/extension/entrypoints/popup/view-model.ts`:

```ts
import type { HostRoomSnapshot } from "../background/host-room-snapshot";

export function getPopupViewModel(snapshot: HostRoomSnapshot) {
  const statusText =
    snapshot.roomLifecycle === "open" && snapshot.sourceState === "missing"
      ? "Room open · No video attached"
      : snapshot.roomLifecycle === "degraded" && snapshot.sourceState === "recovering"
        ? "Recovering video source..."
        : `Room ${snapshot.roomLifecycle} · ${snapshot.sourceState}`;

  const primaryActionLabel =
    snapshot.roomId === null
      ? "Start room"
      : snapshot.sourceState === "attached"
        ? "Replace attached video"
        : snapshot.sourceState === "attaching"
          ? "Attaching..."
          : "Attach selected video";

  return {
    statusText,
    primaryActionLabel,
    canStop: snapshot.roomId !== null,
  };
}
```

Update `apps/extension/entrypoints/popup/useHostControls.ts` so the popup reads `screenmate:get-room-session` and chooses `start-room` vs `attach-source`:

```ts
const syncSnapshot = () =>
  browser.runtime
    .sendMessage({ type: "screenmate:get-room-session" })
    .then((nextSnapshot) => {
      if (!isCancelled) {
        setSnapshot(normalizeSnapshot(nextSnapshot));
      }
    });

async function startOrAttachSelectedVideo() {
  const selectedVideo = videos.find(
    (video) => getVideoSelectionKey(video) === selectedVideoKey,
  );

  if (!selectedVideo) {
    setSnapshot(
      createHostRoomSnapshot({
        message: "No video elements found on this page.",
        sourceState: "missing",
      }),
    );
    return;
  }

  if (!snapshot.roomId) {
    const roomSnapshot = normalizeSnapshot(
      await browser.runtime.sendMessage({
        type: "screenmate:start-room",
        frameId: selectedVideo.frameId,
      }),
    );
    reportRoomActionResult(popupLogger, roomSnapshot, roomSnapshot);
    setSnapshot(roomSnapshot);

    if (!roomSnapshot.roomId) {
      return;
    }
  }

  const nextSnapshot = await browser.runtime.sendMessage({
    type: "screenmate:attach-source",
    frameId: selectedVideo.frameId,
    videoId: selectedVideo.id,
  });

  const normalizedSnapshot = normalizeSnapshot(nextSnapshot);
  reportRoomActionResult(popupLogger, normalizedSnapshot, nextSnapshot);
  setSnapshot(normalizedSnapshot);
}

export function reportRoomActionResult(
  logger: PopupLogger,
  normalizedSnapshot: HostRoomSnapshot,
  rawSnapshot: unknown,
) {
  const details = {
    message: normalizedSnapshot.message,
    normalizedSnapshot,
    rawSnapshot,
    roomId: normalizedSnapshot.roomId,
    roomLifecycle: normalizedSnapshot.roomLifecycle,
    sourceState: normalizedSnapshot.sourceState,
  };

  if (normalizedSnapshot.message && normalizedSnapshot.sourceState !== "attached") {
    logger.error("Room action returned an error snapshot.", details);
    return;
  }

  logger.info("Room action returned a snapshot.", details);
}
```

Update `apps/extension/entrypoints/popup/App.tsx` to use the view-model:

```tsx
import { getPopupViewModel } from "./view-model";

const viewModel = getPopupViewModel(snapshot);

<p>{viewModel.statusText}</p>
<button
  disabled={isBusy || videos.length === 0 || !selectedVideoId}
  onClick={() => startSharing()}
>
  {isBusy ? "Working..." : viewModel.primaryActionLabel}
</button>
<button disabled={!viewModel.canStop} onClick={() => stopSharing()}>
  Stop room
</button>
```

- [ ] **Step 4: Run the popup tests and extension typecheck**

Run:

```bash
pnpm --filter @screenmate/extension test -- test/popup-view-model.test.ts test/popup-logging.test.ts test/background.test.ts
pnpm --filter @screenmate/extension typecheck
```

Expected:

- `PASS apps/extension/test/popup-view-model.test.ts`
- `PASS apps/extension/test/popup-logging.test.ts`
- `PASS apps/extension/test/background.test.ts`
- `tsc --noEmit` exits with code `0`

- [ ] **Step 5: Commit the popup room/source UX**

Run:

```bash
git add apps/extension/entrypoints/popup/view-model.ts apps/extension/entrypoints/popup/useHostControls.ts apps/extension/entrypoints/popup/App.tsx apps/extension/entrypoints/popup/popup.css apps/extension/test/popup-view-model.test.ts apps/extension/test/popup-logging.test.ts
git commit -m "feat(extension): update popup for room source states"
```

## Task 6: Keep Viewer Sessions Alive Through Source Recovery and Reattachment

**Files:**
- Modify: `apps/viewer-web/src/lib/api.ts`
- Modify: `apps/viewer-web/src/lib/session-state.ts`
- Modify: `apps/viewer-web/src/viewer-session.ts`
- Modify: `apps/viewer-web/src/components/ViewerPlayer.tsx`
- Test: `apps/viewer-web/test/viewer-session.test.ts`
- Create: `apps/viewer-web/test/viewer-player.test.tsx`

- [ ] **Step 1: Write the failing viewer recovery tests**

Append this test to `apps/viewer-web/test/viewer-session.test.ts`:

```ts
it("stays joined while the host source is recovering and reconnects on a new offer", async () => {
  const socket = new FakeWebSocket();
  const firstPeer = new FakePeerConnection();
  const secondPeer = new FakePeerConnection();
  const peers = [firstPeer, secondPeer];

  const session = new ViewerSession({
    apiBaseUrl: "https://api.example",
    fetchFn: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();

      if (url.endsWith("/rooms/room_demo") && !init?.method) {
        return Response.json({
          roomId: "room_demo",
          state: "streaming",
          sourceState: "attached",
          hostConnected: true,
          viewerCount: 1,
        });
      }

      return Response.json({
        roomId: "room_demo",
        sessionId: "viewer_1",
        viewerToken: "viewer-token",
        wsUrl: "ws://signal.example/rooms/room_demo/ws",
        iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }],
      });
    },
    createWebSocket: () => socket as never,
    createPeerConnection: () => peers.shift() as never,
  });

  await session.join("room_demo");
  socket.emitOpen();
  socket.emitMessage(
    JSON.stringify({
      roomId: "room_demo",
      sessionId: "host_1",
      role: "host",
      messageType: "room-state",
      timestamp: 12,
      payload: {
        state: "degraded",
        sourceState: "recovering",
        viewerCount: 1,
      },
    }),
  );

  expect(session.getSnapshot()).toMatchObject({
    roomState: "degraded",
    sourceState: "recovering",
    status: "waiting",
    endedReason: null,
  });

  socket.emitMessage(
    JSON.stringify({
      roomId: "room_demo",
      sessionId: "host_1",
      role: "host",
      messageType: "offer",
      timestamp: 13,
      payload: {
        targetSessionId: "viewer_1",
        sdp: "reattach-offer",
      },
    }),
  );

  await Promise.resolve();

  expect(secondPeer.remoteDescription).toEqual({
    type: "offer",
    sdp: "reattach-offer",
  });
});
```

Create `apps/viewer-web/test/viewer-player.test.tsx`:

```tsx
// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ViewerPlayer } from "../src/components/ViewerPlayer";

describe("ViewerPlayer", () => {
  it("shows a recovery message while the host source reconnects", () => {
    render(
      <ViewerPlayer
        roomId="room_demo"
        roomState="degraded"
        sourceState="recovering"
        status="waiting"
        stream={null}
      />,
    );

    expect(
      screen.getByText("Host is reconnecting the video source"),
    ).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the viewer tests to verify they fail**

Run:

```bash
pnpm --filter @screenmate/viewer-web test -- test/viewer-session.test.ts test/viewer-player.test.tsx
```

Expected: FAIL because `sourceState` is not part of the API/session/player flow yet and `ViewerPlayer` does not render the recovery copy.

- [ ] **Step 3: Implement viewer source-state awareness and reoffer recovery**

Update `apps/viewer-web/src/lib/api.ts`:

```ts
import type { RoomSourceState, RoomState } from "@screenmate/shared";

export type RoomStateResponse = {
  roomId: string;
  hostSessionId: string | null;
  hostConnected: boolean;
  viewerCount: number;
  state: RoomState;
  sourceState: RoomSourceState;
};
```

Update `apps/viewer-web/src/lib/session-state.ts`:

```ts
import type { RoomSourceState, RoomState } from "@screenmate/shared";

export type ViewerSessionState = {
  roomId: string | null;
  sessionId: string | null;
  viewerToken: string | null;
  hostSessionId: string | null;
  roomState: RoomState | null;
  sourceState: RoomSourceState | null;
  status: ViewerStatus;
  error: string | null;
  endedReason: string | null;
  remoteStream: MediaStream | null;
};

export const initialViewerSessionState: ViewerSessionState = {
  roomId: null,
  sessionId: null,
  viewerToken: null,
  hostSessionId: null,
  roomState: null,
  sourceState: null,
  status: "idle",
  error: null,
  endedReason: null,
  remoteStream: null,
};
```

Update `apps/viewer-web/src/viewer-session.ts` so room-state updates are recoverable and a fresh offer rebuilds the peer client:

```ts
private joinResponse: JoinRoomResponse | null = null;

private createPeerClient(joined: JoinRoomResponse) {
  return createViewerPeerConnection({
    iceServers: joined.iceServers,
    sessionId: joined.sessionId,
    roomId: joined.roomId,
    getTargetSessionId: () => this.snapshot.hostSessionId,
    sendSignal: (message) => this.socketClient?.send(message),
    onRemoteStream: (stream) => {
      this.update({
        remoteStream: stream,
        sourceState: "attached",
        status: "connected",
        error: null,
        endedReason: null,
      });
    },
    onConnectionStateChange: (state) => {
      if (state === "failed") {
        this.update({
          status: "error",
          error: "Direct peer connectivity failed.",
        });
      }
    },
    createPeerConnection: this.options.createPeerConnection,
  });
}

this.update({
  roomId: joined.roomId,
  sessionId: joined.sessionId,
  viewerToken: joined.viewerToken,
  hostSessionId: roomState.hostSessionId,
  roomState: roomState.state,
  sourceState: roomState.sourceState,
  status: "waiting",
  error: null,
  endedReason: null,
  remoteStream: null,
});

this.joinResponse = joined;
this.peerClient = this.createPeerClient(joined);

case "offer":
  this.peerClient?.close();
  if (!this.joinResponse) {
    return;
  }
  this.peerClient = this.createPeerClient(this.joinResponse);
  this.update({
    hostSessionId: message.sessionId,
    sourceState: "attached",
    status: "connecting",
    roomState: "streaming",
  });
  await this.peerClient.acceptOffer(message.sessionId, message.payload.sdp);
  break;

case "room-state":
  this.update({
    roomState: message.payload.state,
    sourceState: message.payload.sourceState,
    status:
      message.payload.state === "closed"
        ? "ended"
        : message.payload.sourceState === "attached" && this.snapshot.remoteStream
          ? "connected"
          : "waiting",
    endedReason:
      message.payload.state === "closed"
        ? "The host ended the room."
        : null,
  });
  if (message.payload.state === "closed") {
    this.teardown(false);
  }
  break;
```

Update `apps/viewer-web/src/components/ViewerPlayer.tsx`:

```tsx
export function ViewerPlayer({
  roomId,
  roomState,
  sourceState,
  status,
  stream,
}: {
  roomId: string | null;
  roomState: string | null;
  sourceState: string | null;
  status: ViewerStatus;
  stream: MediaStream | null;
}) {
  const statusText =
    roomState === "closed"
      ? "The host ended the room."
      : sourceState === "recovering"
        ? "Host is reconnecting the video source"
        : sourceState === "missing"
          ? "Waiting for host to attach a video"
          : status === "connected"
            ? "Connected to host stream"
            : `Status: ${status}${roomState ? ` · ${roomState}` : ""}`;

  return (
    <section className="viewer-player">
      <div className="viewer-status">
        {roomId ? `Room: ${roomId}` : "Waiting for a room code"}
      </div>
      <div className="viewer-status">{statusText}</div>
      <video autoPlay muted={false} playsInline ref={videoRef} />
    </section>
  );
}
```

- [ ] **Step 4: Run the viewer tests and typecheck**

Run:

```bash
pnpm --filter @screenmate/viewer-web test -- test/viewer-session.test.ts test/viewer-player.test.tsx test/app-route.test.tsx
pnpm --filter @screenmate/viewer-web typecheck
```

Expected:

- `PASS apps/viewer-web/test/viewer-session.test.ts`
- `PASS apps/viewer-web/test/viewer-player.test.tsx`
- `PASS apps/viewer-web/test/app-route.test.tsx`
- `tsc --noEmit` exits with code `0`

- [ ] **Step 5: Commit the viewer recovery support**

Run:

```bash
git add apps/viewer-web/src/lib/api.ts apps/viewer-web/src/lib/session-state.ts apps/viewer-web/src/viewer-session.ts apps/viewer-web/src/components/ViewerPlayer.tsx apps/viewer-web/test/viewer-session.test.ts apps/viewer-web/test/viewer-player.test.tsx
git commit -m "feat(viewer): handle host source recovery"
```

## Task 7: Refresh the Manual Checklist and Run Full Verification

**Files:**
- Modify: `docs/testing/manual-room-streaming-checklist.md`

- [ ] **Step 1: Extend the manual checklist for recovery and reattachment**

Update `docs/testing/manual-room-streaming-checklist.md` to include the new recovery scenarios:

```md
# Manual Room Streaming Checklist

- [ ] Start the Cloudflare worker with a real `ROOM_TOKEN_SECRET`.
- [ ] Start the viewer web app and confirm the join page renders.
- [ ] Build and load the extension from `apps/extension/.output/chrome-mv3`.
- [ ] Open a page with at least one normal capturable `video` element.
- [ ] Open the popup and verify it shows `Room idle · unattached` before sharing.
- [ ] Click `Start room` and confirm a real room code appears.
- [ ] Attach the selected video and confirm the popup shows `attached`.
- [ ] Join from the viewer web app with the room code.
- [ ] Confirm the viewer transitions from joining/waiting to connected.
- [ ] Refresh the host page and confirm the room code remains visible.
- [ ] Confirm the popup shows `Recovering video source...` during automatic recovery.
- [ ] Confirm the viewer stays in the room and shows `Host is reconnecting the video source`.
- [ ] If exact recovery fails, confirm the popup shows `No video attached`.
- [ ] Select a different visible video and click `Attach selected video`.
- [ ] Confirm the viewer resumes playback without rejoining the room.
- [ ] Stop the room from the popup and confirm the viewer receives an ended state.
- [ ] Verify the popup shows a clear message when no capturable video exists.
- [ ] Verify the popup shows a clear message when capture is unsupported.
```

- [ ] **Step 2: Run the full verification commands**

Run:

```bash
pnpm --filter @screenmate/shared test
pnpm --filter @screenmate/extension test
pnpm --filter @screenmate/viewer-web test
pnpm typecheck
```

Expected:

- All package-level test suites pass.
- `turbo run typecheck` exits with code `0`.

- [ ] **Step 3: Commit the checklist and final verification pass**

Run:

```bash
git add docs/testing/manual-room-streaming-checklist.md
git commit -m "docs(testing): add room recovery checklist"
```
