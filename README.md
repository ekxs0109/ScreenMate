# ScreenMate

ScreenMate is a Turborepo monorepo for a small-room video sharing MVP:

- `apps/extension` hosts the selected page video from a browser extension.
- `apps/cloudflare` creates rooms, issues scoped tokens, and relays signaling through Durable Objects.
- `apps/viewer-web` lets viewers join with a room code and receive the forwarded WebRTC stream.

## Apps

- `apps/extension` - WXT browser extension for hosts.
- `apps/cloudflare` - Cloudflare Worker plus Durable Object signaling backend.
- `apps/viewer-web` - Vite/React viewer app.
- `packages/shared` - Shared room, signaling, token, and error schemas.
- `packages/webrtc-core` - Shared ICE and peer-state helpers.

## Environment

- `ROOM_TOKEN_SECRET`
  Used by `apps/cloudflare` to sign host and viewer session tokens.
- `WXT_PUBLIC_SCREENMATE_API_BASE_URL`
  Optional. Used by the extension to point at the Cloudflare API.
  Default: `http://localhost:8787`
- `VITE_API_BASE_URL`
  Optional. Used by the viewer web app to point at the Cloudflare API.
  Default: `http://127.0.0.1:8787`

## Local Flow

1. Start the Cloudflare worker in `apps/cloudflare`.
2. Start the viewer app in `apps/viewer-web`.
3. Load the built extension from `apps/extension/.output/chrome-mv3`.
4. Open a page with a normal capturable `video` element.
5. Click `Start sharing` in the extension popup.
6. Copy the displayed room code into the viewer page and join.

## Commands

- `pnpm dev` - Run all app/package dev scripts through Turbo.
- `pnpm build` - Build all workspaces through Turbo.
- `pnpm typecheck` - Typecheck all workspaces through Turbo.
- `pnpm test` - Run all workspace tests through Turbo.

## Notes

- The MVP targets normal web videos with accessible `video` elements.
- DRM-protected sources and restrictive networks without TURN fallback are out of scope for this branch.
