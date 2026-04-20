# ScreenMate Room Streaming Design

Date: 2026-04-20

## Summary

ScreenMate is a browser-extension-first shared watching product. The host installs the extension, selects a playable `video` element from a normal web page, and starts a room. Viewers do not install the extension. They open a web page, enter the room code, and watch the host's forwarded media stream.

The first version targets small rooms of 1 to 5 viewers, host-only playback control, normal web pages with accessible `video` elements, and Cloudflare-hosted signaling. Media transport stays peer-to-peer between the host extension and viewer web pages. Cloudflare does not relay media in the MVP.

## Product Goals

- Let a host share one selected web-page video stream with 1 to 5 viewers through a room code.
- Keep the viewer flow simple: open web page, enter room code, watch.
- Run room coordination, signaling, and lightweight session validation on Cloudflare Workers and Durable Objects.
- Avoid binding the product to a single STUN provider.
- Keep the architecture upgradeable from P2P mesh to an SFU later without rewriting the UI or room model.

## Explicit Non-Goals For MVP

- No support for DRM-protected or membership-protected video sources.
- No shared playback control for viewers.
- No chat, voice, reactions, subtitles, recording, or replay.
- No account system or persistent user identity.
- No promise of stable support above 5 simultaneous viewers.
- No guarantee that all mainland China networks can establish direct WebRTC connectivity without a TURN server.
- No in-Worker media relay and no Cloudflare Realtime SFU dependency in the MVP.

## Assumptions And Constraints

- The repository will be reorganized as a Turborepo monorepo.
- The host uses a Chromium-compatible browser extension built with WXT.
- The host can manually choose the target `video`; automatic primary-video detection is out of scope for the first version.
- The browser page must expose a capturable media source. If `captureStream()` or equivalent media extraction fails, sharing fails for that source.
- Cloudflare hosts the room APIs, WebSocket signaling entrypoint, and Durable Object room state.
- ICE configuration is delivered by the backend as a configurable server pool. The app must not hard-code a single STUN endpoint as a required dependency.
- Development may start with public STUN servers only. Production readiness may require a TURN server such as self-hosted `coturn`, but TURN provisioning is not part of the MVP scope.

## Recommended Technical Direction

Use native WebRTC on the client side, Cloudflare Workers plus Durable Objects for signaling, and a configurable ICE server pool supplied by the backend.

This is preferred over a heavier SFU design because:

- The room size target is small enough for host-to-viewer mesh to be acceptable for an MVP.
- Cloudflare is well suited for room coordination and signaling, but media relay is intentionally deferred.
- Native WebRTC keeps the future migration path open to LiveKit, mediasoup, or a managed SFU without forcing a rewrite of product boundaries.

## Monorepo Layout

```text
apps/
  extension/      # WXT browser extension for the host flow
  viewer-web/     # Viewer web app
  cloudflare/     # Worker, Durable Objects, room APIs
packages/
  shared/         # Room models, signaling protocol, schema, errors
  webrtc-core/    # Peer connection lifecycle, ICE config helpers
  ui/             # Shared UI primitives used by both apps when duplication appears
turbo.json
```

## Architecture

### 1. Host Extension

The extension owns the host flow:

- Detect available `video` elements in the current page.
- Present a numbered selection UI.
- Capture media from the chosen element.
- Create a room through the Cloudflare API.
- Open a signaling connection.
- Create one `RTCPeerConnection` per viewer.
- Stream the selected media track set to each viewer.
- Show room status, viewer count, and stop-sharing controls.

### 2. Viewer Web App

The viewer web app owns the watch flow:

- Accept a room code.
- Join the room through the Cloudflare API.
- Open a signaling connection.
- Create one `RTCPeerConnection` to the host session.
- Receive and render the remote media stream.
- Show loading, connected, disconnected, and room-ended states.

### 3. Cloudflare Worker API

The Worker provides stateless HTTP entrypoints:

- `POST /rooms` to create a room.
- `POST /rooms/:roomId/join` to join a room as a viewer.
- `GET /rooms/:roomId` to fetch lightweight room state for the viewer UI.
- `GET /rooms/:roomId/ws` to upgrade to WebSocket signaling.
- `GET /config/ice` to supply the current ICE pool configuration.

The Worker also issues short-lived role-scoped tokens and routes WebSocket connections into the proper Durable Object room instance.

### 4. Durable Object Room Instance

Each room maps to one Durable Object that owns authoritative room state:

- Current host session metadata.
- Current viewer sessions.
- Room lifecycle state.
- Signaling message routing.
- Disconnect cleanup and room expiration.

The Durable Object coordinates signaling only. It never proxies media packets.

## Room Lifecycle

### States

- `idle`: no active host session exists.
- `hosting`: host is connected and the room accepts viewers.
- `streaming`: at least one viewer is actively receiving media.
- `degraded`: host remains present but connection establishment is failing often enough that the UI should warn about network compatibility.
- `closed`: host stopped sharing or the room expired.

### Main Flow

1. The host opens the extension popup and starts sharing.
2. The content script scans page videos and lets the host choose one.
3. The extension captures the chosen source and calls `POST /rooms`.
4. The Worker returns `roomId`, `hostToken`, signaling URL, and ICE pool config.
5. The host shares the room code.
6. A viewer opens the web app and submits the room code.
7. The viewer calls `POST /rooms/:roomId/join`.
8. The Worker returns `viewerToken`, signaling URL, and ICE pool config.
9. Both sides connect to the room WebSocket.
10. The host creates a dedicated peer connection for that viewer and begins offer/answer exchange.
11. ICE candidates flow through the Durable Object.
12. Once connected, media flows directly from the host extension to the viewer browser.

### Disconnect Behavior

- If the host leaves, the room transitions to `closed` and all viewers receive a terminal room-ended event.
- If a viewer leaves, the room stays active and only that viewer peer is cleaned up.
- If the Durable Object restarts, the clients reconnect signaling and restore room presence. Existing established media connections may continue independently, but the app should re-sync room presence and control state after reconnect.

## Signaling Protocol

All signaling message types must live in `packages/shared` and be validated with shared schemas on both client and server.

Required message families:

- Room presence:
  - `host-connected`
  - `viewer-joined`
  - `viewer-left`
  - `host-left`
  - `room-closed`
- WebRTC negotiation:
  - `offer`
  - `answer`
  - `ice-candidate`
  - `negotiation-failed`
- Session health:
  - `heartbeat`
  - `reconnect`
  - `room-state`

Every message must include:

- `roomId`
- `sessionId`
- `role`
- `messageType`
- `timestamp`

Role validation is enforced in the Durable Object so a viewer cannot impersonate a host message.

## ICE Strategy

The ICE strategy must be configurable and provider-agnostic.

Rules:

- The client never depends on one hard-coded STUN host.
- The backend returns an ordered `iceServers` pool.
- The default pool includes Cloudflare STUN and additional public STUN endpoints commonly used in mainland China deployments.
- The exact server list lives in backend configuration, not in product logic.
- The backend must support environment-specific pools, so local development, staging, and production can differ without code changes.

Expected behavior:

- If direct connectivity succeeds, the app streams peer-to-peer.
- If all public STUN-assisted attempts fail, the viewer sees a clear network compatibility failure state.
- The architecture leaves room for adding TURN credentials later without redesigning the join flow.

## Security Model

The MVP uses lightweight session security rather than full user identity.

- Room creation returns a short-lived `hostToken`.
- Room join returns a short-lived `viewerToken`.
- Host and viewer tokens have different scopes.
- Tokens are stored only in the active extension or browser session, not persisted as long-term credentials.
- WebSocket upgrade requires a valid role-scoped token.
- The Durable Object validates role, room membership, and session freshness on every signaling action.
- Rooms expire automatically 2 hours after creation.

## Module Breakdown

### `apps/extension`

- `entrypoints/content/video-detector`
  - Find and rank page `video` elements.
  - Provide overlay numbering and selection interactions.
- `entrypoints/content/video-capture`
  - Extract `MediaStream` from the selected element.
  - Normalize capture failures into shared error codes.
- `entrypoints/content/host-session`
  - Manage room creation, signaling session, viewer registry, and teardown.
- `entrypoints/content/peer-manager`
  - Create and manage one peer connection per viewer.
  - Handle negotiation, ICE, retry, and cleanup.
- `entrypoints/popup`
  - Start and stop sharing.
  - Display room code, viewer count, connection states, and unsupported-source errors.

### `apps/viewer-web`

- `join-page`
  - Room code submission and join request UX.
- `socket-client`
  - Durable Object WebSocket lifecycle and reconnect handling.
- `peer-client`
  - Single remote peer connection lifecycle.
- `player`
  - Remote stream attachment and viewer state UI.
- `session-state`
  - In-memory token, session, and room state management.

### `apps/cloudflare`

- `routes/create-room`
- `routes/join-room`
- `routes/get-room`
- `routes/ws-upgrade`
- `lib/token`
- `lib/ice-pool`
- `do/room-object`

### `packages/shared`

- Signaling message schemas.
- Room state models.
- Shared error codes.
- Token payload types.
- Event enums and payload contracts.

### `packages/webrtc-core`

- Peer connection factory.
- ICE configuration normalization.
- Shared peer state machine.
- Retry and timeout helpers.

## Failure Handling

The UI must make failure causes explicit rather than hiding them behind generic disconnect messages.

Required cases:

- No capturable `video` found on page.
- Selected video exists but cannot be captured.
- Room code is invalid or expired.
- Host ended the room.
- Peer negotiation failed.
- Network environment does not support direct connection with the current ICE pool.

For the MVP, a failed connection attempt should end with a clear message and a user-driven retry path. Silent indefinite retries are not acceptable.

## Testing Strategy

### Unit Tests

- Shared protocol schema validation.
- Room state transitions.
- Token creation and validation.
- ICE pool parsing and normalization.
- Peer state machine transitions.

### Integration Tests

- Worker routes for room creation, join, and state fetch.
- Durable Object signaling registration and role validation.
- Host and viewer reconnect behavior against room state recovery.

### Manual End-To-End Verification

- Start sharing from a page with multiple videos and select the correct one.
- Join from a viewer web page using a room code.
- Stream successfully to 1 viewer and then to multiple viewers up to the MVP target.
- Stop sharing from the host and verify the viewer receives room closure.
- Disconnect and reconnect a viewer.
- Attempt to share unsupported or protected content and verify correct failure messaging.
- Test under at least one mainland China network environment before calling the feature beta-ready.

## Major Risks

- DRM and protected playback paths cannot be supported reliably.
- Browser support for `captureStream()` behavior varies by site and browser.
- Public STUN availability is not stable enough to be treated as a hard guarantee.
- Without TURN, some viewers will fail permanently on restrictive networks.
- Host uplink quality is a hard bottleneck for multiple viewers in mesh mode.
- Page-specific DOM complexity may make video selection confusing unless the overlay UX is deliberate and robust.

## Future Upgrade Path

The MVP should preserve the option to evolve without breaking user-facing flows:

- Add TURN credentials delivery through the existing ICE config API.
- Swap mesh media delivery for LiveKit or mediasoup later while keeping room creation and viewer join flows intact.
- Add richer room telemetry without changing the signaling protocol contract shape.

## Decision Summary

The approved MVP is:

- Host installs the extension.
- Viewers use only a web page and room code.
- Host chooses a page `video` manually.
- Media transport uses native WebRTC in P2P mesh mode.
- Cloudflare Workers and Durable Objects handle room APIs and signaling.
- ICE configuration is backend-driven and not bound to a single STUN provider.
- The repository is organized as a Turborepo monorepo.
