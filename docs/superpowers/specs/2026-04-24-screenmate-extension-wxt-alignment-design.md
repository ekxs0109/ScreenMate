# ScreenMate Extension WXT Alignment Design

Date: 2026-04-24

## Summary

`apps/extension` already builds as a WXT browser extension: `pnpm --filter @screenmate/extension dev` runs `wxt`, `build` runs `wxt build`, and production entrypoints live under `entrypoints/`. The remaining gap is that development support code still behaves like a generic Vite/React workspace in a few important places.

This design moves the extension's testing, test file organization, TypeScript setup, and popup localization onto WXT conventions while preserving the current runtime behavior.

## Problem Statement

The extension has adopted WXT for its runtime entrypoints, but not fully for its supporting infrastructure:

- Tests are flat under `apps/extension/test`.
- Tests run with bare Vitest and do not use WXT's Vitest plugin.
- Browser runtime and storage behavior are still mostly represented by local mocks instead of WXT's fake browser test module.
- `apps/extension/tsconfig.json` is hand-written instead of extending WXT's generated TypeScript project.
- Popup localization is implemented with hand-written dictionaries plus `i18next`, rather than WXT's extension-native i18n pipeline.

This split makes the extension harder to reason about as a WXT app. It also increases the chance that tests drift away from the environment WXT actually builds.

## Goals

- Make extension tests run through WXT's Vitest integration.
- Reorganize extension tests around WXT entrypoint boundaries: background, content, popup, and shared lib.
- Use WXT-generated TypeScript configuration as the extension's typecheck base.
- Move popup localization to WXT i18n source files and generated types.
- Make popup text follow the browser extension locale through WXT i18n.
- Remove the popup's explicit runtime language switching, because WXT i18n is browser-locale based rather than app-locale based.
- Remove `i18next`, `react-i18next`, and `i18next-browser-languagedetector` from the extension once the WXT i18n adapter replaces them.
- Preserve current extension runtime behavior while this infrastructure migration lands.

## Non-Goals

- No broad redesign of the popup UI.
- No behavioral changes to room creation, source attachment, video sniffing, or signaling.
- No migration of `apps/viewer-web`; it is a normal Vite web app and does not need WXT conventions.
- No broad extraction of shared UI or localization packages.
- No attempt to finish mock-backed popup features such as real chat, real password protection, screen capture, or upload streaming.

## Current State

The current extension WXT surface is already healthy in these areas:

- `apps/extension/wxt.config.ts` defines WXT config and the React module.
- `apps/extension/entrypoints/background.ts` exports `defineBackground`.
- `apps/extension/entrypoints/content.ts` exports `defineContentScript`.
- `apps/extension/entrypoints/popup.html` is the popup entrypoint.
- `pnpm --filter @screenmate/extension build` successfully produces `.output/chrome-mv3`.

The current supporting infrastructure is not yet WXT-native:

- `apps/extension/package.json` has `test: "vitest run --passWithNoTests"`.
- `apps/extension/package.json` has `typecheck: "tsc --noEmit"`.
- There is no `apps/extension/vitest.config.ts`.
- `apps/extension/tsconfig.json` does not extend `.wxt/tsconfig.json`.
- `apps/extension/entrypoints/popup/i18n.ts` owns dictionaries, language detection, persistence helpers, and `i18next` initialization.
- `apps/extension/test` contains all extension tests in one flat directory.

## Recommended Approach

Use a gradual WXT alignment. The migration should keep runtime behavior stable and change one supporting layer at a time:

1. Add WXT-aware TypeScript and Vitest configuration.
2. Reorganize test files by WXT entrypoint boundary.
3. Convert tests that touch extension APIs to `wxt/testing/fake-browser`.
4. Move popup i18n source text into WXT locale files.
5. Replace the current `i18next` module with a thin WXT i18n adapter.
6. Remove the popup language selector.
7. Remove unused i18n dependencies after the popup no longer imports them.

This approach keeps the blast radius small while still ending with a clean WXT-shaped extension workspace.

## Alternatives Considered

### Bare Minimum WXT Testing

Only add WXT's Vitest plugin and leave file organization and i18n unchanged.

This is too shallow for the desired outcome because the extension would still keep hand-written i18n dictionaries and a generic test layout.

### One-Shot Rewrite

Move all tests, replace i18n, remove dependencies, and adjust TypeScript configuration in one change.

This is cleaner at the end, but it increases regression risk because the popup language selector, tests, path imports, and generated WXT types would all change at once.

### Gradual WXT Alignment

Move infrastructure in a sequence of focused steps.

This is the recommended option because it satisfies the target WXT shape while keeping each step testable and reversible.

## Target File Organization

The extension test directory should mirror WXT runtime boundaries:

```text
apps/extension/test/
  setup/
    browser.ts
  background/
    background.test.ts
    host-room-runtime.test.ts
    host-room-snapshot.test.ts
  content/
    source-attachment.test.ts
    video-detector.test.ts
    video-preview.test.ts
  popup/
    app.test.tsx
    i18n.test.ts
    logging.test.ts
    scene-adapter.test.ts
    view-model.test.ts
  lib/
    config.test.ts
    logger.test.ts
```

Responsibilities:

- `test/setup/browser.ts`
  - Resets WXT fake browser state between tests that use extension APIs.
  - Provides small shared browser test helpers only if repeated patterns emerge.
- `test/background`
  - Covers background message routing, host runtime state, and host snapshot behavior.
- `test/content`
  - Covers page video detection, preview overlays, and source attachment.
- `test/popup`
  - Covers popup view models, scene adapters, presenter rendering, popup logging helpers, and WXT i18n adapter behavior.
- `test/lib`
  - Covers extension-local utilities that are not tied to an entrypoint.

The move is organizational only. Test assertions should remain behavior-focused and should not be rewritten merely because the file moved.

## WXT Test Configuration

Add `apps/extension/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    setupFiles: ["./test/setup/browser.ts"],
  },
});
```

WXT's Vitest plugin should become the extension's default testing path. Tests that import `wxt/browser` should receive the WXT fake browser module automatically.

The existing `@vitest-environment jsdom` comments can remain on DOM-heavy popup and content tests. The WXT plugin and jsdom environments serve different purposes:

- WXT plugin: extension API module handling and fake browser integration.
- jsdom: DOM APIs for React, content script, and overlay tests.

## WXT Fake Browser Usage

Use `wxt/testing/fake-browser` for tests that need browser API state or extension events.

Good candidates:

- Popup storage tests around `wxt/utils/storage`.
- Popup hook tests that interact with `browser.runtime`, `browser.tabs`, or storage.
- Background integration tests that should validate browser event registration.

Tests for pure helper functions should stay simple. They do not need fake browser setup unless they import `wxt/browser` or `wxt/utils/storage`.

## TypeScript Configuration

Update `apps/extension/tsconfig.json` to extend WXT's generated project:

```json
{
  "extends": "./.wxt/tsconfig.json",
  "compilerOptions": {
    "jsx": "react-jsx"
  }
}
```

If the generated WXT config already provides the required JSX setting through the React module, the local override can be omitted.

Update scripts so generated WXT types exist before typechecking:

```json
{
  "scripts": {
    "typecheck": "wxt prepare && tsc --noEmit",
    "test": "wxt prepare && vitest run --passWithNoTests"
  }
}
```

This makes a fresh clone or CI run independent of any previously generated `.wxt` directory.

## WXT i18n Design

Enable WXT's i18n module in `apps/extension/wxt.config.ts`:

```ts
export default defineConfig({
  modules: ["@wxt-dev/module-react", "@wxt-dev/i18n/module"],
});
```

Move popup strings into WXT locale source files:

```text
apps/extension/locales/en.yml
apps/extension/locales/zh.yml
apps/extension/locales/ja.yml
apps/extension/locales/es.yml
```

The locale files should contain the existing popup dictionary keys:

```yaml
appName: SyncPlay
tabSource: Source
tabRoom: Room Settings
tabChat: Room Chat
sourceSniff: Site Sniffer
sourceScreen: Screen Share
sourceUpload: Local Upload
detected: Detected Video Resources
mockOrigin: Tab
refreshSniff: Rescan
noVideo: No video detected on this page.
captureTitle: Capture Screen/Window
captureDescription: Share a specific tab, app window, or entire desktop.
captureButton: Select Content
screenReady: Screen Ready
screenReadyDescription: Source captured. Click the button below to start sharing.
reselect: Reselect
uploadDropzone: Click or drag video files
roomId: Room ID
openRoom: Open Room
passwordPlaceholder: Leave blank for none
save: Save
saved: Saved
viewerList: Viewer Connection Status
viewerName: Name
connType: Method
connPing: Ping
notSharedYet: No video shared yet
cancel: Cancel
changeSource: Change Source
generateShare: Start Sync Room
endShare: End Share
roomChat: Room Chat
chatPlaceholder: Say something...
languageLabel: Language
systemLabel: System
popout: Pop Out
themeLabel: Theme
themeLight: Light
themeDark: Dark
themeSystem: System
```

The non-English files should carry the current strings from `apps/extension/entrypoints/popup/i18n.ts`.

## Popup i18n Adapter

Keep `apps/extension/entrypoints/popup/i18n.ts`, but reduce its role.

It should own:

- Supported locale constants.
- `ExtensionDictionary` type.
- Locale normalization for tests and fallback behavior.
- A function that returns the presenter dictionary from WXT i18n's `#i18n` API.

It should no longer initialize `i18next`.

The adapter should preserve the presenter's dictionary shape:

```ts
const copy = getExtensionDictionary();
```

This allows `ExtensionPopupPresenter` to keep receiving one dictionary object and avoids rewriting the popup view layer.

## Language Preference Behavior

WXT i18n follows the browser extension locale. The popup should therefore stop offering explicit app-local language choices.

Resolution rules:

- The active locale is the browser extension locale resolved by WXT/browser i18n.
- Unsupported browser locales fall back to English through WXT locale fallback behavior.
- The old `screenmate-extension-locale` local storage preference is ignored after migration.
- If existing stored language preferences are present, they do not affect the WXT i18n adapter.

The language selector in the popup toolbar should be removed because there is no user action available in the popup that can change WXT's active browser extension locale.

The key requirement is that source strings live in WXT locale files and runtime translation reads go through WXT's i18n API, not a hand-written runtime dictionary.

## Manifest Localization

The extension can localize manifest fields after popup i18n migration is stable.

Initial manifest localization should include:

- Extension display name.
- Browser action default title.

This is useful but not required for the first infrastructure step. The main requirement is moving popup strings to WXT i18n and proving build output includes generated locale assets.

## Dependency Cleanup

After the popup no longer imports `i18next`, remove these extension dependencies:

- `i18next`
- `i18next-browser-languagedetector`
- `react-i18next`

Add the WXT i18n dependency required by the module:

- `@wxt-dev/i18n`

The root lockfile will change as part of this dependency update.

## Testing Requirements

Required automated checks:

- `pnpm --filter @screenmate/extension test`
- `pnpm --filter @screenmate/extension typecheck`
- `pnpm --filter @screenmate/extension build`

Required focused coverage:

- WXT Vitest config loads and existing tests still pass after moving files.
- Tests that use WXT browser APIs reset fake browser state between runs.
- Popup i18n adapter reads strings through WXT i18n.
- Popup no longer persists or applies explicit language preference choices.
- Presenter receives the same dictionary shape after WXT i18n migration.
- Build output includes generated locale assets.

## Risks And Mitigations

Risk: WXT `browser.i18n.getMessage` follows the active browser extension locale, while the popup currently supports explicit in-app language switching.

Mitigation: Prefer WXT-native behavior and remove the explicit popup language switcher. Keep the presenter dictionary shape stable so the text plumbing remains small.

Risk: Moving tests changes many relative imports.

Mitigation: Move tests by boundary and run the affected package tests after each group. Do not change assertions in the same step unless required by path or setup changes.

Risk: Extending `.wxt/tsconfig.json` may expose generated type differences or stricter include behavior.

Mitigation: Run `wxt prepare` before typecheck and keep any local compiler overrides minimal.

Risk: Existing staged work in the repository can be accidentally committed with infrastructure changes.

Mitigation: Commit this migration in focused commits that name exact files, and avoid broad `git add .`.

## Success Criteria

- `apps/extension` has WXT-owned Vitest and TypeScript setup.
- Extension tests are organized by WXT entrypoint boundary.
- Popup localization source strings live in WXT locale files.
- The popup no longer depends on `i18next`.
- The popup no longer presents an explicit language switcher that cannot be backed by WXT i18n.
- Current extension tests, typecheck, and build pass.
- Existing runtime behavior is unchanged.
