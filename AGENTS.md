# Repository Guidelines

## Project Structure & Module Organization
ScreenMate is a `pnpm` + Turborepo monorepo. App code lives under `apps/`: `extension` for the WXT browser extension, `server` for the Cloudflare Worker and Durable Object backend, and `viewer-web` for the Vite/React viewer. Shared contracts and WebRTC utilities live in `packages/shared/src` and `packages/webrtc-core/src`. Tests sit beside each workspace in `test/`, while longer-form notes live in `docs/` and local TURN assets live in `docker/coturn/`.

## Build, Test, and Development Commands
Use the root scripts for normal development:

- `pnpm dev` runs all workspace dev processes through Turbo.
- `pnpm build` builds every workspace.
- `pnpm typecheck` runs TypeScript checks across the repo.
- `pnpm test` runs all Vitest suites.

Use filtered commands when you only need one target, for example `pnpm --filter @screenmate/viewer-web dev` or `pnpm --filter @screenmate/cloudflare test`.

## Coding Style & Naming Conventions
This repo uses TypeScript with ESM imports, semicolons, and 2-space indentation. Match existing file naming: React components use `PascalCase.tsx` (`JoinForm.tsx`), utility and model files use kebab-case or lower-case (`peer-client.ts`, `room-object.ts`). Prefer the existing path aliases such as `@/components` in UI apps. UI work in `apps/extension` and `apps/viewer-web` uses shadcn patterns plus Tailwind utilities; keep shared protocol and schema logic in `packages/shared` instead of duplicating types.

## Testing Guidelines
Vitest is the test runner across the monorepo, with Testing Library used for React UI tests. Name tests `*.test.ts` or `*.test.tsx` and place them in the workspace `test/` directory. Cover protocol, token, and room-state changes with unit tests before merging. For streaming flows, use `docs/testing/manual-room-streaming-checklist.md` for manual verification in addition to `pnpm test`.

## Commit & Pull Request Guidelines
Recent history follows Conventional Commit style: `feat(scope): ...`, `fix(scope): ...`, `docs(scope): ...`, and `chore: ...`. Keep commit scopes tied to the workspace or subsystem you changed. Pull requests should explain the user-visible impact, list affected workspaces, link the relevant issue, and include screenshots or short recordings for popup/viewer UI changes. Call out any required env var or TURN configuration changes explicitly.

## Security & Configuration Tips
Do not commit real secrets. Start from the checked-in examples in `apps/server/.dev.vars.example`, `apps/extension/.env.local.example`, and `apps/viewer-web/.env.local.example`, and keep `TURN_AUTH_SECRET`, `ROOM_TOKEN_SECRET`, and related local values out of version control.
