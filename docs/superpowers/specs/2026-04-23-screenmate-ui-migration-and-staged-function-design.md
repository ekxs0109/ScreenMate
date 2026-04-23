# ScreenMate UI Migration And Staged Function Completion Design

Date: 2026-04-23

## Summary

ScreenMate currently has two production-facing UI surfaces:

- The extension popup in `apps/extension`
- The viewer web app in `apps/viewer-web`

There is also a separate `ui_test` prototype that contains a much richer visual design and a broader interaction model for both surfaces.

This design defines how to migrate the `ui_test` UI into the real product without mixing that work with feature development. The work is intentionally split into two stages:

1. `UI migration`
   - Rebuild the extension and viewer UIs in the main apps to match the `ui_test` prototype.
   - Keep all existing real capabilities working.
   - Preserve prototype-only areas by backing them with controlled mock state when no real implementation exists yet.
2. `Function completion`
   - Replace stage-one mock modules with real implementations one module at a time.
   - Keep the migrated UI structure stable while the backing behavior becomes real.

The recommended approach is a container/presenter split with adapter-based scene models. That keeps visual migration and function completion separate, testable, and reversible.

## Problem Statement

Today the product and the prototype are separated in a way that makes migration risky:

- `ui_test` is visually richer than the real apps.
- The production popup and viewer already have working state and networking flows.
- Some prototype modules do not exist yet in the main product, including chat-oriented and richer room-detail interactions.
- If the team ports the prototype by editing pages directly, the UI rewrite and function development will become tangled in the same components.

That would create three avoidable problems:

1. Stage-one UI work would block on stage-two backend or runtime behavior.
2. Mock data and real data would be mixed into the page layer.
3. Replacing mock behavior later would require reworking the same JSX again.

## Product Goals

- Migrate both prototype surfaces into the real product:
  - `ui_test/src/pages/Extension.tsx` -> `apps/extension`
  - `ui_test/src/pages/Viewer.tsx` -> `apps/viewer-web`
- Keep the UI migration and function development as explicitly separate delivery phases.
- Preserve existing working flows during the UI migration:
  - extension room lifecycle and source attachment
  - viewer join flow and remote stream playback
- Render complete stage-one UI even when some modules are still mock-backed.
- Make every mock-backed module easy to replace later without rewriting the presenter layer.
- Keep `ui_test` as a reference prototype, not as runtime code imported by the apps.

## Explicit Non-Goals

- No direct reuse of `ui_test` files inside production runtime code.
- No attempt to finish all missing product capabilities during stage one.
- No major redesign of the existing host-room or viewer-session core logic in order to support the new UI.
- No forced cross-app shared runtime module that merges extension and viewer behavior into one system.
- No broad refactor unrelated to the UI migration and mock-to-real replacement path.

## Recommended Technical Direction

Use the same architecture pattern in both apps:

1. `Container`
   - Owns the real session/runtime hooks and page lifecycle.
   - Owns mock modules required for stage one.
2. `Adapter`
   - Converts real state and mock state into one scene model for rendering.
3. `Presenter`
   - Renders the `ui_test`-style UI.
   - Never talks directly to browser runtime APIs, `ViewerSession`, or WebRTC state.
4. `Mock modules`
   - Hold stage-one-only fake data, fake interactions, and temporary local flows.

This is preferred because:

- It keeps the visual migration unblocked by missing capabilities.
- It prevents mock logic from leaking into the presenter layer.
- It makes stage-two work a controlled replacement of adapter inputs rather than a UI rewrite.
- It works equally well for the extension popup and the viewer app without forcing them into the same runtime.

## Alternative Approaches Considered

### 1. Replace Existing Pages In Place

This is the fastest path in raw edit count. However, it mixes real state, mock state, and rendering logic in the same page components.

Rejected because it would make stage two expensive and fragile.

### 2. Shared Cross-App Design-System Refactor First

This would extract shared primitives and tokens before the migration.

Deferred because it adds heavy front-loaded work before either real UI is delivered, and the extension popup and viewer layouts are different enough that early forced reuse risks over-design.

### 3. Adapter-Based Scene Model Per App

This keeps the apps independent while giving both the same migration and replacement pattern.

Accepted because it best matches the requirement to separate UI migration from function completion.

## Architecture Overview

Each app should adopt the same high-level structure:

```text
runtime state + mock state
        ->
     adapter
        ->
   scene model
        ->
    presenter UI
```

Rules:

- The presenter receives a single scene model and callback set.
- The presenter never infers whether data is real or mock from implementation details.
- The adapter is the only place that merges real and mock sources.
- Mock modules are not spread across UI leaf components.

## Stage Boundaries

### Stage 1: UI Migration

Scope:

- Rebuild both production UIs to match the prototype direction.
- Wire existing capabilities to real state.
- Preserve missing capabilities with mock-backed modules.
- Keep a complete user-visible interaction surface instead of blank placeholders.

Exit criteria:

- Both apps visually match the target structure closely enough to be the new default UI.
- Existing real flows still work.
- Missing modules are present, interactive, and clearly backed by controlled mock state.

### Stage 2: Function Completion

Scope:

- Replace mock modules with real implementations one module at a time.
- Keep presenter structure stable.
- Expand adapter contracts only where needed.

Exit criteria:

- Mock modules are replaced or intentionally removed.
- The UI no longer depends on misleading fake product behavior.
- Existing stage-one presenter tests continue to pass with real implementations.

## Shared Design Principles

- Treat `ui_test` as a visual and interaction reference, not a code dependency.
- Prefer view-model-driven rendering over component-local ad hoc state.
- Keep mock state explicit and easy to audit.
- Let real connection or session state override mock activity when the two conflict.
- Design for replacement: every mock-backed module should have a single, obvious seam where real behavior can be connected later.

## Extension App Design

### Current Real Inputs

The extension already has real runtime behavior through the popup and background flow:

- `useHostControls`
- `HostRoomSnapshot`
- real room start / attach / stop actions
- real video enumeration and preview selection
- real room status and viewer count
- real viewer-room URL generation

These must remain the source of truth for existing host behaviors during stage one.

### Extension Target Structure

Recommended extension popup structure:

```text
popup container
  ->
extension scene adapter
  ->
ExtensionSceneModel
  ->
popup presenter
```

Suggested responsibilities:

- `popup container`
  - owns `useHostControls`
  - owns theme/language state
  - owns stage-one mock modules
- `extension scene adapter`
  - maps real room/source state into presenter-friendly sections
  - injects mock-backed modules when capability is missing
- `popup presenter`
  - renders the migrated popup UI and tab structure

### Extension Stage-One Real Modules

These should be backed by real production state immediately:

- Source sniff list based on real detected videos
- Selected-video state
- Preview-highlight interaction
- Start room
- Attach selected video
- Stop room
- Room lifecycle summary
- Source lifecycle summary
- Room ID
- Viewer count aggregate
- Viewer link generation

### Extension Stage-One Mock Modules

These should render in stage one but remain mock-backed until stage two:

- Source `screen` mode
- Source `upload` mode
- Chat tab and message flow
- Password save/edit experience
- Viewer connection detail rows beyond aggregate count
- Any richer source metadata that the current runtime does not provide directly

The QR code can be real in stage one because it only depends on the existing viewer link.

### Extension Scene Model Requirements

The extension presenter should consume one model shaped around UI sections rather than raw runtime objects. It should expose:

- header status
- source tab data
- room tab data
- chat tab data
- primary and secondary actions
- inline errors and disabled states
- explicit provenance for key modules: `real`, `mock`, or `mixed`

The presenter should not need to understand `HostRoomSnapshot` semantics directly.

### Extension Data Priority Rules

- Real room lifecycle and source lifecycle always outrank mock activity.
- Real viewer aggregate count outranks mock connection-detail totals.
- If no real video is available, the source tab remains visible but start/attach actions are disabled.
- Mock chat and mock room settings must not mutate real host-room state unless stage two explicitly wires them in.

## Viewer Web App Design

### Current Real Inputs

The viewer app already has real runtime behavior through:

- `ViewerSession`
- URL-based auto join
- manual join flow
- room state, source state, and session status
- remote stream playback
- autoplay/unmute handling
- room-ended and error messaging

These behaviors remain the real source of truth during stage one.

### Viewer Target Structure

Recommended viewer app structure:

```text
viewer container
  ->
viewer scene adapter
  ->
ViewerSceneModel
  ->
viewer presenter
```

Suggested responsibilities:

- `viewer container`
  - owns `ViewerSession`
  - owns join / leave / URL boot logic
  - owns stage-one mock modules
- `viewer scene adapter`
  - maps real session and playback state into presenter sections
  - merges in mock-backed side-panel features
- `viewer presenter`
  - renders the migrated top bar, player shell, and right-side panel

### Viewer Stage-One Real Modules

These should be backed by real production state immediately:

- Join room flow
- Auto-join from shared URL
- Remote stream rendering
- Waiting / recovering / closed / error states
- Unmute interaction for autoplay fallback
- Room ID and basic connection state derived from the real session

### Viewer Stage-One Mock Modules

These should render in stage one but remain mock-backed until stage two:

- Chat thread and send-message flow
- Viewer identity generation and randomization
- Rich connection-type and ping detail
- Online audience detail beyond what real session state exposes
- Prototype-only top-bar utility actions that do not yet map to real product capability

`Leave room` may connect to real page-state reset/navigation immediately, but it should not force a broader new room-management feature set during stage one.

### Viewer Scene Model Requirements

The viewer presenter should consume one model that includes:

- top-bar status
- join-state section
- player section
- sync/side-panel section
- chat section
- inline error / ended state messages
- explicit provenance for key modules: `real`, `mock`, or `mixed`

The presenter should not know about raw `ViewerSessionState` internals.

### Viewer Data Priority Rules

- Real room/session/playback status always overrides mock message activity.
- If the room is closed or recovering, the UI must reflect the real condition even if the mock chat is active.
- The presence of mock side-panel data must never make the player look connected when the real session is not connected.
- If no stream is available, the player remains in the real waiting state rather than simulating playback.

## Mock Module Strategy

Mocking is not a hidden implementation detail. It is a deliberate stage-one delivery tool.

Rules:

- Do not use one global "mock mode" switch for the entire app.
- Create mock seams per module.
- Keep mock state outside the presenter tree when possible.
- Mark key scene-model sections with provenance:
  - `real`
  - `mock`
  - `mixed`
- Prefer deterministic, inspectable mock state over random ad hoc component state.

This allows stage two to replace one module at a time without destabilizing the rest of the UI.

## File And Module Boundaries

Exact filenames may follow repo conventions, but each app should gain the same responsibility split:

- `scene-model`
- `scene-adapter`
- `mock-state`
- presenter components organized by UI section
- a top-level container that owns real runtime hooks

This structure should exist separately in:

- `apps/extension`
- `apps/viewer-web`

It should not require a new shared runtime package unless a later iteration identifies a truly stable common UI primitive set.

## Data Flow Rules

For both apps:

1. Real runtime state is produced by existing production hooks/classes.
2. Mock state is produced by stage-one mock modules.
3. The adapter merges both into a single scene model.
4. The presenter renders only from that scene model.
5. User actions are routed back to the container, which delegates to real handlers, mock handlers, or both as needed.

This keeps every page on one rendering contract.

## Error Handling

- Existing real runtime errors must continue to surface through the scene model.
- Mock modules may use lightweight local inline messaging, but they must not mask real session failures.
- Any UI section that is unavailable because real data is missing should remain visible with a controlled disabled or empty state rather than disappearing unexpectedly.
- Presenter components should render stable layouts across `idle`, `busy`, `recovering`, `missing`, `closed`, and `error` states.

## Testing Strategy

### Adapter Tests

Add adapter-level tests that verify:

- real runtime state maps correctly into the scene model
- mock module state maps correctly into the scene model
- precedence rules between real and mock data are respected

### Presenter Tests

Add presenter/component tests that verify:

- major sections render for both apps
- disabled and busy states render correctly
- tabs and side panels switch correctly
- stage-one mock-backed sections still render in a controlled way

### Existing Runtime Regression Coverage

Retain existing behavior tests around:

- extension host controls and popup behavior
- viewer session state transitions
- viewer playback behavior

The migration should not relocate core behavior assertions into visual-only tests.

## Delivery Breakdown

The work should be tracked as four deliverables:

1. Extension UI migration
2. Viewer UI migration
3. Extension function completion for mock-backed modules
4. Viewer function completion for mock-backed modules

This gives the team a clean separation between shipping the new interface and completing the remaining product surface.

## Acceptance Criteria

### Stage-One Acceptance

- The extension popup visually reflects the `ui_test` direction while preserving real host controls.
- The viewer web app visually reflects the `ui_test` direction while preserving real join and playback flows.
- Prototype-only modules appear as complete, interactive mock-backed UI rather than empty placeholders.
- Real and mock responsibilities are separated through adapters and scene models.
- Existing core flows still work under the migrated UI.

### Stage-Two Acceptance

- Each mock-backed module can be replaced independently with real behavior.
- Presenter structure remains largely stable while real capability is added.
- Real implementations remove misleading fake behavior rather than layering on top of it.
- Tests cover both the replacement seam and the preserved real flows.

## Risks And Mitigations

### 1. Prototype Information Density Exceeds Current Real Data

Risk:

- The prototype displays more metadata and richer secondary interactions than the real runtime provides.

Mitigation:

- Adapters define the downgrade path explicitly.
- Mock modules fill only the missing sections instead of forcing presenters to fabricate values.

### 2. Extension Popup Space Is Tight

Risk:

- The prototype popup layout may be visually dense in the real extension window.

Mitigation:

- Preserve the prototype visual language while allowing popup-specific spacing and overflow tuning inside the presenter implementation.

### 3. UI Migration Could Regress Real Flows

Risk:

- A visual rewrite may accidentally break existing room/session behavior.

Mitigation:

- Keep runtime ownership in existing containers and hooks.
- Add adapter and presenter tests rather than moving core behavior into visual code.

## Open Implementation Guidance

When stage-two function completion begins, modules should be replaced in descending order of product value and lowest UI churn. A likely order is:

1. extension viewer-detail data
2. extension password/access behavior
3. extension screen/upload source paths
4. extension chat
5. viewer room/sidebar connection detail
6. viewer identity behavior
7. viewer chat

This order is guidance, not a hard requirement. The core rule is that replacements happen at the adapter and mock-module seam, not by rewriting presenters.
