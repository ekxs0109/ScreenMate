# ScreenMate TURN Fallback And Room Lifetime Design

Date: 2026-04-22

## Summary

ScreenMate currently relies on public STUN only. That keeps the MVP simple, but it leaves a known failure mode unresolved: some host/viewer pairs cannot establish direct WebRTC connectivity on restrictive NATs or corporate networks.

This design adds a secure TURN fallback path without changing the current room and signaling model:

- Keep the existing Worker and Durable Object signaling architecture.
- Keep peer-to-peer media as the preferred path.
- Add self-hosted `coturn` as the primary TURN provider.
- Keep the ICE server shape consistent across local, test, development, staging, and production.
- Use short-lived TURN credentials from day one.
- Add room renewal for active host sessions, but do not tie TURN credential lifetime to room lifetime.
- Leave room for Cloudflare TURN as a secondary provider later without redesigning the client contract.

## Problem Statement

Today the backend returns an ordered STUN-only `iceServers` pool. That allows ICE to gather server-reflexive candidates, but it does not provide a relay path when NAT hole punching fails.

The result is a predictable product gap:

- Some users fail permanently with `Direct peer connectivity failed`.
- Adding more public STUN servers does not fix networks that require relay.
- The current design has no secure TURN credential story.
- The room expires on a fixed schedule even if the host is still actively sharing.

## Product Goals

- Improve connection success on restrictive networks by adding TURN relay fallback.
- Preserve the current host/viewer join flow and existing signaling model.
- Keep one consistent ICE configuration shape across all environments to simplify debugging.
- Use secure short-lived TURN credentials from the first implementation.
- Prevent ScreenMate TURN capacity from becoming an anonymous public relay.
- Support long-running active rooms without forcing a full reconnect every fixed 2 hours.
- Keep the design provider-agnostic so additional TURN providers can be added later.

## Explicit Non-Goals

- No move to an SFU in this iteration.
- No forced media relay for every connection. Direct P2P remains preferred.
- No anonymous public endpoint that returns TURN credentials.
- No long-lived static TURN usernames or passwords exposed to browsers.
- No unlimited room lifetime.
- No per-region traffic steering or multi-datacenter TURN routing in the first version.

## Recommended Technical Direction

Use one self-hosted `coturn` deployment as the primary TURN provider and continue to return an ordered `iceServers` array from the backend. Keep the STUN pool intentionally small and stable:

- `stun:stun.miwifi.com:3478`
- `stun:stun.cloudflare.com:3478`

Then append a short-lived TURN entry for `coturn`.

This is preferred because:

- It solves the actual failure mode that STUN alone cannot solve.
- It fits the current API shape and `RTCPeerConnection` setup with minimal product-surface change.
- It keeps local debugging behavior close to non-local environments.
- It avoids exposing reusable long-term TURN credentials to untrusted clients.
- It preserves the option to add Cloudflare TURN later as a second TURN provider.

## Alternative Approaches Considered

### 1. More Public STUN Servers Only

This is the cheapest option operationally, but it does not address networks that require relay. It improves resilience to one STUN host failing, not the core connectivity problem.

Rejected because it does not materially improve success on restrictive NATs.

### 2. Cloudflare TURN Only

This is operationally simple and still secure, but it reduces local-debug symmetry and gives less direct control over relay behavior and observability. It also leaves flexibility and path quality concerns for mainland-China-oriented traffic.

Deferred as a useful secondary provider, not the first provider.

### 3. `coturn` Primary, Cloudflare TURN Secondary

This is the long-term target. It provides one self-managed provider plus one managed fallback. However, it adds credential-management complexity and provider-level observability work.

Accepted as a phase-two extension after the primary `coturn` path is stable.

## ICE Configuration Strategy

The backend remains the authority for ICE configuration. Clients continue to treat `iceServers` as opaque backend-supplied configuration.

Rules:

- Keep the ICE shape identical across environments.
- Keep STUN entries fixed to the two approved servers.
- Return TURN entries in the same `iceServers` array.
- Keep `iceTransportPolicy` at the default `"all"` so browsers prefer direct paths when available.
- Do not force `"relay"` in the first version.

Target `iceServers` shape:

```ts
[
  { urls: ["stun:stun.miwifi.com:3478"] },
  { urls: ["stun:stun.cloudflare.com:3478"] },
  {
    urls: [
      "turn:turn.screenmate.local:3478?transport=udp",
      "turn:turn.screenmate.local:3478?transport=tcp",
      "turns:turn.screenmate.local:5349?transport=tcp"
    ],
    username: "<short-lived-username>",
    credential: "<short-lived-password>"
  }
]
```

Later, Cloudflare TURN can be appended as another distinct `RTCIceServer` object with its own credentials.

## Environment Strategy

The environments should differ by endpoint values and secrets, not by contract shape.

### Local, Test, And Development

- Use the same STUN entries as every other environment.
- Run `coturn` locally with Docker.
- Return short-lived TURN credentials signed by the local server.
- Keep logs verbose enough for routine TURN debugging.

### Staging And Production

- Keep the same STUN entries and same response shape.
- Point TURN URLs at the deployed `coturn` host.
- Keep short-lived TURN credentials enabled.
- Add stricter rate limiting and longer-term log retention.

This keeps client behavior and log interpretation aligned across environments.

## Local `coturn` Development Topology

Local development should run `coturn` through Docker with explicit published ports:

- `3478/tcp`
- `3478/udp`
- `5349/tcp`
- A narrow UDP relay range, for example `49160-49200/udp`

Required `coturn` configuration principles:

- Enable shared-secret auth with `use-auth-secret`
- Enable `fingerprint`
- Enable stale nonce handling
- Set a fixed `realm`, for example `screenmate.local`
- Keep the relay port range narrow and explicit
- Do not allow anonymous relay use

If local TURN runs behind NAT, configure the advertised external IP correctly. If local TURN is only used from the same machine or LAN for debugging, a simpler direct bind may be sufficient.

## TURN Credential Model

`coturn` should use the TURN REST shared-secret model, not static long-term user credentials distributed to clients.

The ScreenMate backend stores:

- `TURN_AUTH_SECRET`
- `TURN_REALM`
- `TURN_URLS`

The backend does not store or return reusable browser credentials. Instead it generates them on demand when a room session is created successfully.

Recommended username shape:

```text
<expiresAt>:<roomId>:<sessionId>:<role>
```

Recommended password generation:

- HMAC-SHA1 over the username using `TURN_AUTH_SECRET`
- Base64 output

Recommended TURN credential TTL:

- `10 minutes`

This TTL is intentionally much shorter than room lifetime. It limits the abuse window if credentials are copied while still giving enough time to establish the connection and survive short reconnect loops.

## TURN Credential Delivery

TURN credentials should be issued only in the existing room session endpoints:

- `POST /rooms`
- `POST /rooms/:roomId/join`

Behavior:

- Host receives TURN credentials after successful room creation.
- Viewer receives TURN credentials after successful room join.
- No separate anonymous public TURN credentials endpoint is exposed.
- If a future reconnect flow needs fresh TURN credentials after expiry, it must go through an authenticated room-session path rather than a public endpoint.

This keeps TURN issuance bound to existing room authorization and avoids creating a second unauthenticated attack surface.

## Security Requirements

The design must assume TURN credentials can be observed by the client that uses them. The goal is therefore not perfect secrecy; the goal is constrained, auditable, short-lived access.

Security requirements:

- No static TURN username/password in client config or source control.
- TURN credentials are issued only after successful host or viewer room authorization.
- Credentials expire after a short TTL.
- Username embeds enough context for abuse tracing.
- Room creation and join endpoints are rate-limited.
- TURN signing secrets never leave the backend or TURN infrastructure.
- TURN logs and API issuance logs are correlated by room and session identifiers.
- The backend must reject issuance for expired, closed, or invalid rooms.

Recommended anti-abuse controls:

- IP-based rate limiting on room creation
- IP-plus-room rate limiting on room join
- Structured logs for credential issuance
- Structured logs for room/session closure
- Optional future quotas in `coturn` if relay abuse appears in production

## Room Lifetime And Renewal

Room lifetime and TURN credential lifetime must be treated as separate concepts.

### Room Lifetime

- Initial room TTL remains `2 hours`
- Only the host can extend room lifetime
- Room renewal should be automatic while the host remains connected and active
- Each renewal extends the room by a fixed window, for example `30 to 60 minutes`
- A room must have a hard maximum lifetime, for example `8 to 12 hours`

### Renewal Trigger

Use host heartbeats or equivalent room activity from the host signaling session as the renewal source.

Rules:

- Viewer activity never renews the room
- If the host disconnects and does not return within a grace period, the room expires normally
- If the host remains present, the room should not terminate at the original fixed 2-hour boundary

### TURN Credential Lifetime

- TURN credentials stay short-lived at `10 minutes`
- TURN credentials are not silently renewed forever in the background in the first version
- New TURN credentials are obtained through normal room-session retrieval paths when needed

This split keeps product lifetime friendly to active hosts while keeping relay credentials conservative.

## Data Flow

### Host Start

1. Host starts a room.
2. Backend creates the room and host session.
3. Backend generates short-lived TURN credentials for that host session.
4. Backend returns STUN plus TURN in `iceServers`.
5. Extension creates peer connections with the supplied configuration.

### Viewer Join

1. Viewer joins a room.
2. Backend validates room state and issues a viewer session.
3. Backend generates short-lived TURN credentials for that viewer session.
4. Backend returns STUN plus TURN in `iceServers`.
5. Viewer creates a peer connection with the supplied configuration.

### Active Room Renewal

1. Host remains connected and sends heartbeats.
2. Backend observes that the room is still active.
3. Backend extends room expiry within the hard maximum.
4. Existing connections remain undisturbed.

## Observability And Debugging

The first version should make TURN usage measurable, not just available.

Backend logs should include:

- Room/session TURN credential issuance
- Issuance TTL and expiry timestamp
- Room renewal events
- Room expiry reasons

Client-side diagnostics should include:

- ICE connection state transitions
- Whether a selected candidate pair used `relay`
- TURN-related negotiation failures

`coturn` logs should be available in local development so failures can be separated into:

- bad credential generation
- bad TURN reachability
- bad relay port exposure
- browser candidate selection behavior

## Testing Strategy

At the design level, the required coverage is:

- Backend tests for TURN credential generation shape and TTL
- Backend tests for room creation and join responses that include the TURN entry
- Backend tests for host-only room renewal behavior
- Client tests that preserve the `iceServers` shape and pass TURN entries through normalization
- Manual tests with local Docker `coturn`
- Manual verification that relay candidates appear in browser diagnostics

## Rollout Plan

### Phase 1

- Add local Docker `coturn`
- Add backend TURN short-lived credential generation
- Return TURN entries from create-room and join-room APIs
- Add room renewal logic for active hosts
- Add issuance and renewal logging

### Phase 2

- Add Cloudflare TURN as a second TURN provider
- Compare relay usage and failure recovery by provider
- Add tighter quota and abuse controls if production usage requires them

## Open Decisions Resolved In This Design

- STUN list is fixed to:
  - `stun:stun.miwifi.com:3478`
  - `stun:stun.cloudflare.com:3478`
- `coturn` is the first TURN provider
- TURN credentials are short-lived from the first version
- Local, test, and development use the same ICE contract shape as staging and production
- Room renewal exists and is host-driven
- TURN credential renewal is intentionally more conservative than room renewal
