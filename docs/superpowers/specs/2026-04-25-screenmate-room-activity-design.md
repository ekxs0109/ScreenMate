# ScreenMate Room Activity Design

Date: 2026-04-25

## Summary

ScreenMate has migrated the host popup and viewer web UI, but several visible room features are still backed by local mock state. This design covers the next function-completion slice: real viewer identity, viewer connection details, and two-way room chat.

The accepted direction is to make the room Durable Object the short-lived source of truth for room activity. Viewer profiles, latest viewer metrics, and recent chat messages will flow through the existing signaling WebSocket and be retained for the lifetime of the room. This gives host and viewers a shared, recoverable room context without introducing a database or long-term chat history.

## Goals

- Replace mock viewer connection rows in the extension popup with real room roster data.
- Replace local-only popup and viewer chat with real two-way room chat.
- Let viewers start with a random display name and edit it after joining.
- Preserve recent room activity across popup/viewer refreshes and Durable Object restarts during the active room lifetime.
- Keep the existing media signaling path intact.
- Avoid adding persistent cross-room history, analytics storage, or account identity.

## Non-Goals

- No password-protected room implementation in this slice.
- No real screen-share or uploaded-file source implementation in this slice.
- No external database, account system, or long-term chat archive.
- No full content-page floating chat integration yet. The popup chat becomes real in this slice; the existing content chat widget may continue as a lightweight attach indicator until a later pass.
- No broad UI redesign. The existing migrated presenter structure stays in place.

## Recommended Approach

Extend the existing signaling protocol and room Durable Object with room activity messages:

- Viewer profile updates.
- Viewer connection metrics.
- Chat messages.
- Roster snapshots.
- Chat history snapshots.

The Durable Object validates incoming activity, stores the current room activity in memory and storage, and broadcasts normalized snapshots to connected clients. Clients consume the same activity feed instead of maintaining separate mock state.

This approach is preferred because it matches the selected retention model: room-scoped, short-lived, refresh-tolerant state with no new infrastructure.

## Alternatives Considered

### Pure Signaling Forwarding

The Durable Object could simply relay profile, metrics, and chat messages without retaining them. This is simpler, but popup refreshes and viewer reconnects would lose the room context. That does not satisfy the desired "room-local short retention" behavior.

### Separate Activity Store Abstraction

The server could introduce a generic room activity storage interface that later supports D1, KV, or analytics pipelines. This has cleaner future extension points, but it is too heavy for the current goal and would add architecture before there is a real second storage backend.

## Protocol Design

`packages/shared/src/signaling.ts` should add these envelope types:

- `viewer-profile`
  - Sent by a viewer to set or update its display name.
  - Payload: `viewerSessionId`, `displayName`.
  - The server accepts only updates for the sender's own viewer session.
- `viewer-metrics`
  - Sent by a viewer with its latest connection details.
  - Payload: `viewerSessionId`, `connectionType`, optional `pingMs`.
  - The server keeps only the newest metrics per viewer.
- `chat-message`
  - Sent by host or viewer as a text message request.
  - Client payload should include text only plus optional local correlation id.
  - The Durable Object assigns the canonical `messageId`, sender fields, and `sentAt`.
- `viewer-roster`
  - Sent by the Durable Object to host and viewers.
  - Payload contains current viewer rows with display name, online state, connection type, ping, and last update timestamps.
- `chat-history`
  - Sent by the Durable Object on connection and after recovery.
  - Payload contains the most recent room chat messages.

Chat messages should be capped to 500 characters after trimming. Empty messages are rejected or ignored. The room stores the latest 100 chat messages.

## Server Design

`RoomObject` should own a room activity state alongside its existing connection and source state:

- `viewerProfiles: Map<string, ViewerProfile>`
- `viewerMetrics: Map<string, ViewerMetrics>`
- `chatMessages: ChatMessage[]`
- online status derived from currently connected viewer WebSockets

On host connection:

- Send the current room state as today.
- Send `viewer-roster`.
- Send `chat-history`.
- Continue sending viewer presence notifications for media negotiation compatibility.

On viewer connection:

- Register the viewer as online.
- Send the current room state as today.
- Send `viewer-roster`.
- Send `chat-history`.
- Broadcast an updated `viewer-roster` to host and viewers.

On viewer disconnect:

- Mark the viewer offline instead of deleting its profile immediately.
- Broadcast an updated `viewer-roster`.
- Continue sending existing `viewer-left` presence messages so WebRTC peer cleanup keeps working.

On `viewer-profile`:

- Require role `viewer`.
- Require payload `viewerSessionId` to match the socket session id.
- Trim and normalize the display name.
- Store the profile and broadcast `viewer-roster`.

On `viewer-metrics`:

- Require role `viewer`.
- Require payload `viewerSessionId` to match the socket session id.
- Store the latest metrics and broadcast `viewer-roster`.
- Metrics are expected every 5-10 seconds from clients; the Durable Object does not need complex server-side throttling in the first pass.

On `chat-message`:

- Allow role `host` and `viewer`.
- Normalize sender identity from the active session rather than trusting client-provided sender fields.
- Trim and validate message text.
- Append a canonical message to the latest 100 messages.
- Persist and broadcast the canonical `chat-message`.

The activity state should be persisted in Durable Object storage with the room record or a nearby storage key. Room close and expiry do not need separate cleanup beyond the current room lifecycle.

## Viewer Web Design

`ViewerSessionState` should include:

- `displayName`
- `viewerRoster`
- `chatMessages`
- latest local connection metrics when available

`ViewerSession` should:

- Generate the default viewer name using the existing locale-aware random name helper.
- Send `viewer-profile` after the signaling socket opens.
- Expose a method to update the display name and send another `viewer-profile`.
- Send `chat-message` when the viewer submits chat.
- Consume `viewer-roster`, `chat-history`, and canonical `chat-message`.
- Derive metrics from `RTCPeerConnection.getStats()` where available.

For metrics:

- `connectionType` should be `relay` when the selected candidate pair uses a relay candidate, otherwise `direct` when the connection is established.
- `pingMs` should use WebRTC round-trip time when available.
- If RTT is unavailable, the UI should display a neutral unknown value such as `--` rather than fake latency.

`viewer-mock-state.ts` should stop providing joined-room viewer count, ping, connection type, and chat data. It may remain for pre-join default identity if useful, but joined room UI should come from `ViewerSessionState`.

## Extension Design

`HostRoomSnapshot` should include:

- `viewerDetails`
- `chatMessages`

`host-room-runtime` should:

- Consume `viewer-roster`, `chat-history`, and canonical `chat-message` from the host signaling socket.
- Persist the latest activity with the room session.
- Expose viewer details and chat messages through `getSnapshot()`.
- Provide a method for sending host chat messages over the existing WebSocket.

`background.ts` should add popup-facing messages for host chat send and, if needed, snapshot refresh. It should route host chat through `host-room-runtime` rather than local popup state.

`popup/scene-adapter.ts` should:

- Prefer real `snapshot.viewerDetails` over mock viewer rows.
- Prefer real `snapshot.chatMessages` over mock chat messages.
- Preserve the presenter contract so `presenter.tsx` does not need to know whether activity is real or temporary.

`popup/App.tsx` should route chat sends to the background/runtime once a room is active. Local-only message append should be removed from the real room path.

The content-page floating chat widget is out of scope for real chat in this slice. It can continue to show/hide when a source is attached.

## Data Flow

Viewer join flow:

1. Viewer joins the room through the existing HTTP route.
2. Viewer opens the signaling WebSocket.
3. Durable Object sends `room-state`, `viewer-roster`, and `chat-history`.
4. Viewer sends `viewer-profile`.
5. Durable Object stores the profile and broadcasts `viewer-roster`.
6. Viewer periodically sends `viewer-metrics` after peer connection data is available.

Chat flow:

1. Host or viewer submits text.
2. Client sends a `chat-message` request over WebSocket.
3. Durable Object validates and canonicalizes the message.
4. Durable Object appends it to room history.
5. Durable Object broadcasts the canonical `chat-message`.
6. Host popup and viewer append the canonical message to their local session state.

Reconnect flow:

1. Client reconnects to the existing room WebSocket.
2. Durable Object sends current `viewer-roster` and recent `chat-history`.
3. The client replaces local activity state with the server snapshot.

## Error Handling

- Invalid activity envelopes should close the offending WebSocket with the existing invalid-envelope/session-mismatch pattern.
- Unauthorized profile or metrics updates should close with `message-type-not-allowed` or `session-mismatch`.
- Oversized or empty chat text should be ignored with no broadcast, or rejected by closing the socket only if the payload is malformed.
- If metrics collection fails, the viewer remains connected and sends no metrics until the next successful sample.
- If host chat is submitted without an active room socket, the popup should show a clear transient failure through the existing room message surface or keep the send button disabled.

## Testing Strategy

Shared package:

- Add schema tests for `viewer-profile`, `viewer-metrics`, `chat-message`, `viewer-roster`, and `chat-history`.
- Cover invalid display names, invalid metrics, and oversized chat payloads.

Server:

- Test that viewer profile updates are accepted only for the sender's own session.
- Test that metrics update the roster.
- Test that host and viewer chat messages are canonicalized and broadcast.
- Test that new host/viewer connections receive roster and chat history snapshots.
- Test that viewer disconnect marks the roster entry offline while retaining recent activity.

Viewer web:

- Test that join sends the default profile after socket open.
- Test that display name edits send profile updates.
- Test that incoming roster/history/chat update the scene model.
- Test that chat submission sends a message request.
- Test that unknown RTT renders as unknown rather than mock latency.

Extension:

- Test that host runtime stores roster and chat snapshots.
- Test that popup scene adapter uses real roster and chat when present.
- Test that host chat send is routed through the background runtime.
- Keep existing source attach and WebRTC tests passing.

Manual smoke:

- Host starts a room and attaches a page video.
- Viewer A and Viewer B join.
- Both viewers edit names.
- Viewer A, Viewer B, and host popup exchange chat messages.
- Refresh host popup and one viewer; roster and recent chat remain visible.
- Disconnect one viewer; host sees it become offline.

## Rollout Notes

This slice should land before password access control, screen share, or upload-source work. It removes misleading mock social state from the migrated UI and creates the room activity foundation those later features can reuse for status messages.

Implementation should proceed in small vertical passes:

1. Shared schemas and server room activity state.
2. Viewer profile and roster.
3. Chat history and chat send.
4. Viewer metrics.
5. Extension popup replacement of mock roster and chat.

Each pass should preserve the existing media streaming tests.
