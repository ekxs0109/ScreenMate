# ScreenMate Room/Source Decoupling Design

Date: 2026-04-21

## Summary

ScreenMate currently treats "selected page video" and "host room session" as the same thing. That coupling causes the room to disappear whenever the page refreshes, the content script is reloaded, or the page replaces the underlying `<video>` element.

This design changes the host flow to treat the room as a long-lived session and the page video as a detachable media source. After the change:

- Refreshing the page or replacing the `<video>` element must not close the room.
- Viewers stay in the room and see a recovery state instead of being forced to rejoin.
- The extension automatically attempts to recover the source in the same tab.
- If automatic recovery fails, the host can attach any newly selected video to the existing room.

## Problem Statement

Today the active host room lives inside the content script. That means:

- Refreshing the page tears down the content script and destroys the host room state.
- `videoId` values are derived from a `WeakMap` keyed by live DOM nodes, so they become invalid as soon as the player rebuilds or the DOM is replaced.
- The popup treats the current page scan as the source of truth for the whole host session, so room state and media-source state disappear together.

This is the wrong ownership model. The room is the durable collaboration object. The selected `video` is only the current media attachment for that room.

## Product Goals

- Keep the room alive when the host page refreshes, navigates within the same SPA, or rebuilds the target `<video>` element.
- Keep viewers in the room during recovery so they do not need to manually rejoin.
- Automatically restore the source when the same tab and frame come back with a strong match to the previous source.
- Fall back to a clear "room still open, no video attached" state when automatic recovery fails.
- Allow the host to attach any newly selected video in the tracked tab to the existing room.
- Preserve the room code and viewer count in the popup throughout recovery and manual reattachment.

## Explicit Non-Goals

- No automatic switching to the "closest" different video when the original source cannot be matched exactly.
- No cross-tab room migration in this iteration. Recovery and manual reattachment are scoped to the tracked host tab.
- No attempt to preserve the exact browser `MediaStream` or `RTCPeerConnection` objects across page refreshes.
- No guarantee that host recovery survives a full browser restart or extension reload.
- No change to the viewer join flow or room-token model.

## Constraints That Shape The Design

- The extension is Manifest V3 and currently uses an extension background service worker.
- Content scripts are destroyed on full page refresh and can be replaced during SPA transitions and iframe reloads.
- Extension runtime messaging uses JSON-serializable payloads, so page-owned `MediaStream` objects cannot be handed to the background as durable room state.
- Chrome MV3 service workers can keep a WebSocket alive with explicit keepalive traffic, but they can still be restarted unexpectedly. The room runtime therefore needs resumable in-memory state backed by extension session storage.

These constraints mean the design must separate durable room ownership from page-bound media capture, instead of trying to move the captured `MediaStream` itself into the background.

## Design Principles

- The room outlives the source.
- Room state and source state are separate pieces of state.
- Refreshing or replacing a `video` is a recoverable source event, not a terminal room event.
- Automatic recovery should be conservative. If the source cannot be matched confidently, fall back to manual reattachment.
- The popup should render the background room snapshot, not infer the room from the current DOM scan.

## Proposed Architecture

### 1. Background `HostRoomRuntime`

The background becomes the authority for room lifecycle and recovery state.

Responsibilities:

- Create the room and hold the current `roomId`, host token, host session ID, and signaling URL.
- Maintain the signaling WebSocket to the Durable Object.
- Track viewer presence, viewer count, and the set of currently joined viewer session IDs.
- Track the active host tab ID, frame ID, and the last attached source fingerprint.
- Track recovery timers and the current room snapshot exposed to the popup.
- Persist a resumable room snapshot in `chrome.storage.session` so service-worker restarts can rebuild the room snapshot during the same browser session.

This runtime does not own the page `MediaStream`. It owns the room, viewer roster, and recovery orchestration.

### 2. Content `SourceAttachmentRuntime`

The content script becomes a page-local source adapter.

Responsibilities:

- Enumerate visible videos in the current frame.
- Capture a `MediaStream` from a selected page `video`.
- Own the page-bound host transport for the current attachment.
- Receive "create offer for viewer X", "detach source", and "teardown attachment" commands from the background.
- Report source loss when tracks end, when the page unloads, or when the content runtime is invalidated.

The content runtime is disposable. It may be destroyed and recreated many times during a single room.

### 3. Popup As Control Surface

The popup stops treating page scan state as the entire host session.

Responsibilities:

- Read the current room snapshot from the background.
- Independently request the current list of selectable videos from the active tab.
- Show room-level status even when no source is currently attached.
- Offer two primary actions:
  - `Start room` when no room exists.
  - `Attach selected video` when a room exists but no source is attached.

### 4. Viewer Session

The viewer web app stays joined to the room while the host source recovers.

Responsibilities:

- Distinguish `room closed` from `host source recovering` and `host source missing`.
- Keep the viewer in the room during source recovery.
- Accept a fresh offer after host reattachment without requiring a new room join.

## State Model

### Background Host Snapshot

The extension host snapshot should be expanded to represent room state and source state separately.

```ts
type HostRoomLifecycle = "idle" | "opening" | "open" | "degraded" | "closed";

type HostSourceState =
  | "unattached"
  | "attaching"
  | "attached"
  | "recovering"
  | "missing";

type HostRoomSnapshot = {
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
```

### Viewer-Facing Room State

The shared `room-state` signaling payload should keep the existing room state concept and add source state.

```ts
type SharedRoomState = "hosting" | "streaming" | "degraded" | "closed";

type SharedSourceState =
  | "attached"
  | "recovering"
  | "missing";
```

Rules:

- `hosting` means the room is open but there are no active viewers.
- `streaming` means the room is open, a source is attached, and at least one viewer is present.
- `degraded` means the room is open but the host is recovering or missing a source.
- `closed` means the room has ended and viewers must leave.

## Source Fingerprint And Matching Rules

`videoId` remains an ephemeral identifier for a single DOM scan. It is no longer treated as a durable room key.

The background stores a source fingerprint for automatic recovery:

- `tabId`
- `frameId`
- `primaryUrl`: first non-empty value from `currentSrc`, `src`, or `poster`
- `elementId`: DOM `id` if present
- `label`
- `visibleIndex`: index within the visible-video list sorted by size

Automatic recovery is allowed only when all of the following are true:

- The content runtime comes back from the same `tabId`.
- The candidate comes from the same `frameId`.
- Exactly one visible candidate matches the previous `primaryUrl`.

If no exact `primaryUrl` match exists, or if multiple candidates match, automatic recovery stops and the room moves to `sourceState = "missing"`.

This conservative matching avoids silently switching the room to the wrong video.

## Protocol Changes

### Extension Internal Messages

The extension message contract should grow to include room/session operations instead of overloading `start-sharing`.

New or changed message families:

- `screenmate:get-room-session`
  - Returns the background `HostRoomSnapshot`.
- `screenmate:list-videos`
  - Still scans the active tab, but its `videoId` is explicitly ephemeral.
- `screenmate:start-room`
  - Creates the room if it does not already exist.
- `screenmate:attach-source`
  - Attaches a selected page video to the current room.
- `screenmate:content-ready`
  - Sent by the content script on boot so the background can attempt automatic recovery.
- `screenmate:source-detached`
  - Sent by the content script when tracks end or the attachment is torn down.
- `screenmate:stop-room`
  - Explicitly closes the room.

`screenmate:start-sharing` can remain as a temporary compatibility alias for `start-room + attach-source` during refactor, but the final model should separate them.

### Shared Signaling

`packages/shared/src/signaling.ts` should extend `room-state` payloads from:

```ts
{ state }
```

to:

```ts
{
  state,
  sourceState,
  viewerCount,
}
```

This lets the viewer distinguish:

- Room is healthy and streaming.
- Room is still open but the host is recovering.
- Room is still open but no source is attached.
- Room is actually closed.

## Main Flows

### 1. Initial Start

1. The popup asks the background for the current room snapshot.
2. If no room exists, the popup sends `screenmate:start-room`.
3. The background creates the room, opens signaling, persists the session snapshot in `chrome.storage.session`, and marks `roomLifecycle = "open"`.
4. The popup selects a page video and sends `screenmate:attach-source`.
5. The targeted content runtime captures the selected `video`.
6. The content runtime builds a fresh page-bound host transport for the current viewer roster.
7. The background updates `sourceState = "attached"` and broadcasts a shared `room-state`.

### 2. Page Refresh Or Video Replacement

1. The current content runtime is invalidated or the active track ends.
2. The background does not close the room.
3. The background marks `sourceState = "recovering"`, sets `roomLifecycle = "degraded"`, stores `recoverByTimestamp = now + 15000`, and broadcasts `room-state = degraded + recovering`.
4. Viewers remain in the room and see a recovery message instead of a room-ended message.

### 3. Automatic Recovery

1. A new content runtime boots in the tracked tab and sends `screenmate:content-ready` with diagnostics and the current video list.
2. The background compares the new candidates to the stored source fingerprint.
3. If there is exactly one strong match, the background automatically issues `screenmate:attach-source` for that candidate.
4. The new content runtime captures the recovered source, rebuilds host-side offers for all current viewer session IDs, and resumes streaming.
5. The background clears the recovery deadline and marks `sourceState = "attached"`.

### 4. Manual Reattachment

1. If the 15 second recovery window expires or no exact source match exists, the background marks `sourceState = "missing"`.
2. The popup still shows the existing room code and viewer count.
3. The host selects any visible video in the tracked tab and clicks `Attach selected video`.
4. The background instructs the current content runtime to attach that source to the existing room.
5. A fresh transport is created for the existing viewer roster and viewers resume watching without rejoining the room.

### 5. Explicit Room Stop

Only these events truly end the room:

- Host explicitly clicks stop.
- Backend sends `room-closed`.
- Host room session becomes unrecoverable because signaling credentials are invalid or the socket cannot be re-established.

Refreshing a page or losing a `video` must never directly trigger `room-closed`.

## Error Handling And UX Rules

### Recoverable Conditions

These conditions move the room into recovery or missing state without ending the room:

- Content script no longer responds because the page refreshed.
- The attached track fires `ended`.
- The target `video` element disappears.
- Automatic source matching fails.

Popup behavior:

- Keep showing the room code and viewer count.
- Show `Recovering video source...` while within the 15 second recovery window.
- Show `No video attached` when recovery expires or no match is found.
- Offer `Attach selected video` instead of `Start sharing` when the room already exists.

Viewer behavior:

- `recovering`: keep the room open and show `Host is reconnecting the video source`.
- `missing`: keep the room open and show `Waiting for host to attach a video`.
- `closed`: end the viewing session and show the terminal room-ended reason.

### Fatal Conditions

These conditions are terminal and close the room:

- Explicit host stop.
- Backend room expiration.
- Signaling authentication failure that cannot be retried.
- Background room runtime restart where no valid session snapshot remains in `chrome.storage.session`.

## Background Resilience

The background room runtime should persist the following fields in `chrome.storage.session`:

- `roomId`
- `hostToken`
- `hostSessionId`
- `signalingUrl`
- `viewerSessionIds`
- `viewerCount`
- `activeTabId`
- `activeFrameId`
- `sourceFingerprint`
- `sourceState`
- `recoverByTimestamp`

On service-worker startup:

1. Read the persisted session snapshot.
2. If no valid open room exists, do nothing.
3. If a valid room snapshot exists, reconnect signaling.
4. Restore `viewerCount` from the reconnect handshake or fresh room-state updates.
5. If `recoverByTimestamp` is still in the future, restore the room to `sourceState = recovering`; otherwise restore it to `sourceState = missing`.

This gives the room a resumable control plane during the same browser session without persisting long-term credentials across browser restarts.

## Module Breakdown

### `apps/extension`

- `entrypoints/background.ts`
  - Becomes the room/session authority and message router.
- `entrypoints/background/host-room-runtime.ts`
  - New module for room lifecycle, signaling, recovery timers, and storage-backed snapshots.
- `entrypoints/content/source-attachment.ts`
  - New module for page-bound capture and transport lifecycle.
- `entrypoints/content/video-detector.ts`
  - Keeps ephemeral `videoId` generation but also exposes source fingerprints for recovery matching.
- `entrypoints/popup/useHostControls.ts`
  - Reads background room snapshots and switches between `Start room` and `Attach selected video` flows.
- `entrypoints/popup/App.tsx`
  - Renders room-lifecycle and source-state combinations explicitly.
- `wxt.config.ts`
  - Add the `storage` permission required for `chrome.storage.session`.

### `packages/shared`

- `src/signaling.ts`
  - Extend `room-state` payload with `sourceState` and `viewerCount`.
- `src/room.ts`
  - Keep shared room state enums aligned with viewer-facing states.

### `apps/viewer-web`

- `ViewerSession`
  - Handle source recovery messages without ending the room.
- `session-state`
  - Track `sourceState` separately from join/connect status.
- `ViewerPlayer`
  - Render `recovering`, `missing`, and `closed` states distinctly.

## Testing Strategy

### Unit Tests

Add unit coverage for the background room runtime:

- Start room without source attached.
- Attach source and transition to healthy room state.
- Viewer joins while source is attached.
- Source detaches and room moves to `recovering`.
- Automatic recovery succeeds within 15 seconds.
- Automatic recovery fails and room moves to `missing`.
- Explicit stop transitions to `closed`.

### Extension Integration Tests

Add message-flow tests covering:

- Popup reading room session from background.
- Content boot sending `screenmate:content-ready`.
- Background automatic recovery trigger on same tab/frame.
- Manual attach to an existing room.
- Content invalidation becoming `recovering` instead of clearing the room.

### Viewer Tests

Add viewer-web tests for:

- `room-state` with `sourceState = recovering`.
- `room-state` with `sourceState = missing`.
- New offer flow after host reattachment.
- Terminal `room-closed` behavior still ending the session.

### Manual Acceptance Checklist

- Start a room and stream normally.
- Refresh the host page; verify the room code remains visible and viewers stay in the room.
- Confirm automatic recovery succeeds when the same source comes back in the same tab/frame.
- Confirm the room falls back to `No video attached` when exact recovery is impossible.
- Manually attach a different visible video and verify viewers continue in the same room without rejoining.
- Replace the `video` element during an SPA navigation and verify the room is not closed.
- Click stop and verify viewers receive `room closed`.

## Acceptance Criteria

- Refreshing the page does not clear the room code.
- Viewers do not need to manually rejoin after host refresh or source reattachment.
- Automatic recovery succeeds only on exact same-source matches in the tracked tab/frame.
- Failed automatic recovery degrades to `sourceState = missing` without closing the room.
- The host can attach a different visible video to the existing room.
- Only explicit stop or unrecoverable signaling failure closes the room.
