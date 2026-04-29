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

Vitest is the test runner across the monorepo, with Testing Library used for React UI tests. Name tests `*.test.ts` or `*.test.tsx` and place them in the workspace `test/` directory. Cover protocol, token, room-state, and WebRTC signaling changes with unit tests before merging. For streaming flows, use `docs/testing/manual-room-streaming-checklist.md` for manual verification in addition to `pnpm test`.

## Streaming Modes

ScreenMate streams decoded media over WebRTC. It does not send the original video file to viewers.

- Page sniffing: the content script finds a visible page `<video>`, calls `video.captureStream()`, and uses the shared media attachment runtime to negotiate a host WebRTC peer for viewers. Background routes signaling to the owning tab/frame.
- Screen sharing: the offscreen document calls `navigator.mediaDevices.getDisplayMedia()`, attaches that `MediaStream`, and background routes signaling to the offscreen owner.
- Local file streaming: `player.html` saves the selected file into local browser storage, prepares an upload source, and starts the offscreen local-file attachment. The offscreen document owns the hidden `<video>`, calls `captureStream()`, and remains the single WebRTC source owner for local files. `player.html` may keep its own preview/controller surface, but refreshing or closing it must not detach the offscreen stream.
- Legacy player-local streaming: older experiments let `player.html` stream from the DPlayer page's actual playing `<video>` via `video.captureStream()`. Do not use this as the default local-file path because refreshing `player.html` destroys the source owner.

When changing source modes, keep the host source owner explicit. Page sniffing owners are real tab/frame ids, while screen sharing and local-file streaming are offscreen owners. Viewer signaling must be routed to the current or pending owner only, and UI state should not report a new source as attached until that owner has captured and attached a stream.

For offscreen local-file streaming, detach the previous source owner before asking offscreen to attach the local video. Slow mounted/cloud files may take time before the offscreen `<video>` exposes a frame-ready capture stream, so keep the host in an attaching/missing state instead of falling back to a stale previous source.

Local-file playback state belongs to offscreen. `player.html` should send play/pause/seek/time controls through background to the offscreen source when the active owner is offscreen. This keeps the media stream alive when `player.html` is refreshed or closed, and makes playback synchronization target one owner. The selected file must be retained outside the player page, for example in IndexedDB or a durable file handle; an object URL created only in `player.html` is lost on refresh and cannot be recovered by offscreen.

Do not treat offscreen local playback as a codec workaround. Offscreen still uses Chrome's `<video>` decode path before `captureStream()`, so files Chrome cannot decode, such as some MKV/HEVC/FLAC combinations, will fail there too. For unsupported codecs, use screen/window capture from an external player or transcode/remux to a browser-compatible format.

## TDD Workflow

Use TDD for behavior changes, bug fixes, and protocol/state logic. Add or update a failing test before changing production code. For bug fixes, include a regression test that reproduces the issue. Run the smallest relevant test first, make the minimal change to pass it, then run the related workspace tests. Do not delete, skip, or weaken tests just to make the suite pass. Refactor only after tests are green.

Before finishing a task, summarize the tests added or changed and the commands that were run.

## Subagent Workflow

Use subagents for complex implementation work, multi-step refactors, protocol/state changes, WebRTC flow changes, and bug fixes that need investigation. Keep the main agent focused on coordination, planning, and final verification.

Prefer a fresh subagent for each independent task. Give the subagent only the files, plan, constraints, and acceptance criteria it needs. Do not rely on hidden chat history or vague context. Treat a subagent like a focused teammate who needs a clear ticket.

Recommended project subagents may live in `.claude/agents/` and should be committed when they are useful to the team. Suggested agents for this repo:

- `implementer`: implements one scoped task using the existing architecture and TDD rules.
- `spec-reviewer`: checks whether the implementation matches the requested behavior, protocol contract, and acceptance criteria.
- `code-quality-reviewer`: reviews readability, maintainability, security, edge cases, and consistency with repo conventions.
- `test-reviewer`: checks whether tests cover the right behavior without being too brittle or overly coupled to implementation details.
- `webrtc-reviewer`: reviews media capture, signaling, peer connection, token, room-state, and streaming edge cases.

For behavior changes, follow this flow:

1. Main agent writes or updates the implementation plan.
2. Implementer subagent handles one scoped task at a time.
3. The implementer adds or updates a failing test first when TDD applies.
4. After the task passes locally, run a spec review subagent.
5. After spec review passes, run a code quality review subagent.
6. Fix all blocking review findings before moving to the next task.
7. Main agent performs the final integration check and summarizes changed tests and commands run.

Do not use subagents to bypass ownership of the final result. The main agent remains responsible for consistency across workspaces, final test selection, and the final summary.

Avoid subagents for tiny edits, copy changes, simple renames, or documentation-only changes unless review quality would clearly benefit.

## Commit & Pull Request Guidelines

Recent history follows Conventional Commit style: `feat(scope): ...`, `fix(scope): ...`, `docs(scope): ...`, and `chore: ...`. Keep commit scopes tied to the workspace or subsystem you changed. Pull requests should explain the user-visible impact, list affected workspaces, link the relevant issue, and include screenshots or short recordings for popup/viewer UI changes. Call out any required env var or TURN configuration changes explicitly.

For code changes, pull requests should also mention the tests added or updated. If TDD was not practical, briefly explain why.

## Security & Configuration Tips

Do not commit real secrets. Start from the checked-in examples in `apps/server/.dev.vars.example`, `apps/extension/.env.local.example`, and `apps/viewer-web/.env.local.example`, and keep `TURN_AUTH_SECRET`, `ROOM_TOKEN_SECRET`, and related local values out of version control.
