# ScreenMate

ScreenMate is a Turborepo monorepo for a small-room video sharing MVP:

- `apps/extension` hosts the selected page video from a browser extension.
- `apps/server` creates rooms, issues scoped tokens, and relays signaling through Durable Objects.
- `apps/viewer-web` lets viewers join with a room code and receive the forwarded WebRTC stream.

## Apps

- `apps/extension` - WXT browser extension for hosts.
- `apps/server` - Cloudflare Worker plus Durable Object signaling backend.
- `apps/viewer-web` - Vite/React viewer app.
- `packages/shared` - Shared room, signaling, token, and error schemas.
- `packages/webrtc-core` - Shared ICE and peer-state helpers.

## Environment

- `ROOM_TOKEN_SECRET`
  Used by `apps/server` to sign host and viewer session tokens.
- `TURN_AUTH_SECRET`
  Shared secret used to sign coturn REST credentials.
- `TURN_REALM`
  TURN auth realm.
  Example: `screenmate.local`
- `TURN_URLS`
  Comma-separated TURN URLs returned to clients.
- `TURN_TTL_SECONDS`
  Lifetime of issued TURN credentials.
  Default: `600`
- `WXT_PUBLIC_SCREENMATE_API_BASE_URL`
  Optional. Used by the extension to point at the Cloudflare API.
  Default: `http://localhost:8787`
- `WXT_PUBLIC_SCREENMATE_VIEWER_BASE_URL`
  Optional. Used by the extension popup to build the viewer room link.
  Default: `http://localhost:4173`
- `VITE_API_BASE_URL`
  Optional. Used by the viewer web app to point at the Cloudflare API.
  Default: `http://127.0.0.1:8787`

## Local Flow

1. Start the Cloudflare worker in `apps/server`.
2. Start the viewer app in `apps/viewer-web`.
3. Load the built extension from `apps/extension/.output/chrome-mv3`.
4. Open a page with a normal capturable `video` element.
5. Click `Start sharing` in the extension popup.
6. Open the displayed viewer room link from the extension popup, or paste the room code into the viewer page and join.

## Local TURN

Local TURN for ScreenMate runs through Docker for same-machine smoke testing on a single development machine. The checked-in profile is intentionally limited to a loopback-bound plain UDP TURN listener on `127.0.0.1:3478`, publishes the UDP relay port range `127.0.0.1:49160-49200`, and does not enable local TCP or TLS listeners.

```bash
docker compose -f docker-compose.turn.yml up -d
export TURN_AUTH_SECRET=screenmate-local-turn-secret
export TURN_REALM=screenmate.local
export TURN_URLS="turn:127.0.0.1:3478?transport=udp"
pnpm --filter @screenmate/cloudflare dev
```

1. `docker compose -f docker-compose.turn.yml up -d`
2. Set `TURN_AUTH_SECRET`, `TURN_REALM`, and UDP-only `TURN_URLS` for `apps/server`
3. Keep `TURN_AUTH_SECRET` and `TURN_REALM` aligned with `static-auth-secret` and `realm` in `docker/coturn/turnserver.local.conf`
4. Treat this profile as same-machine smoke test coverage only, not a general multi-host coturn setup
5. Even for same-machine testing, Docker Desktop and some Docker setups may advertise relayed candidate addresses that do not map cleanly back to loopback; if that happens, update the loopback-bound port publishing in `docker-compose.turn.yml`, set `listening-ip`, `relay-ip`, and `external-ip` in `docker/coturn/turnserver.local.conf` to a reachable host address, or run coturn directly on the host instead of in Docker
6. Run `pnpm --filter @screenmate/cloudflare dev`

## Commands

- `pnpm dev` - Run all app/package dev scripts through Turbo.
- `pnpm build` - Build all workspaces through Turbo.
- `pnpm typecheck` - Typecheck all workspaces through Turbo.
- `pnpm test` - Run all workspace tests through Turbo.

## Notes

- The MVP targets normal web videos with accessible `video` elements.
- DRM-protected sources and restrictive networks without TURN fallback are out of scope for this branch.
