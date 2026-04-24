# Extension WXT Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `apps/extension` use WXT conventions for tests, TypeScript setup, and popup i18n while preserving runtime behavior and avoiding popup UI redesign.

**Architecture:** Keep WXT entrypoints as the runtime boundary and make tests mirror those boundaries. Add WXT Vitest/TypeScript setup, move popup strings into WXT locale files, replace the `i18next` module with a thin `#i18n` adapter, and remove only the existing language selector wiring from the popup.

**Tech Stack:** TypeScript, React 19, WXT 0.20, `@wxt-dev/module-react`, `@wxt-dev/i18n`, Vitest, WXT fake browser, Testing Library, pnpm/Turborepo

---

## File Structure

- Modify: `apps/extension/package.json`
  - Add `@wxt-dev/i18n`.
  - Run `wxt prepare` before `typecheck` and `test`.
  - Remove unused `i18next`, `i18next-browser-languagedetector`, and `react-i18next`.
- Modify: `apps/extension/wxt.config.ts`
  - Add `@wxt-dev/i18n/module`.
- Modify: `apps/extension/tsconfig.json`
  - Extend WXT's generated `.wxt/tsconfig.json`.
- Create: `apps/extension/vitest.config.ts`
  - Load WXT's Vitest plugin.
- Create: `apps/extension/test/setup/browser.ts`
  - Reset WXT fake browser state between tests.
- Move tests:
  - `apps/extension/test/background.test.ts` -> `apps/extension/test/background/background.test.ts`
  - `apps/extension/test/host-room-runtime.test.ts` -> `apps/extension/test/background/host-room-runtime.test.ts`
  - `apps/extension/test/host-room-snapshot.test.ts` -> `apps/extension/test/background/host-room-snapshot.test.ts`
  - `apps/extension/test/source-attachment.test.ts` -> `apps/extension/test/content/source-attachment.test.ts`
  - `apps/extension/test/video-detector.test.ts` -> `apps/extension/test/content/video-detector.test.ts`
  - `apps/extension/test/video-preview.test.ts` -> `apps/extension/test/content/video-preview.test.ts`
  - `apps/extension/test/popup-app.test.tsx` -> `apps/extension/test/popup/app.test.tsx`
  - `apps/extension/test/popup-i18n.test.ts` -> `apps/extension/test/popup/i18n.test.ts`
  - `apps/extension/test/popup-logging.test.ts` -> `apps/extension/test/popup/logging.test.ts`
  - `apps/extension/test/popup-scene-adapter.test.ts` -> `apps/extension/test/popup/scene-adapter.test.ts`
  - `apps/extension/test/popup-view-model.test.ts` -> `apps/extension/test/popup/view-model.test.ts`
  - `apps/extension/test/config.test.ts` -> `apps/extension/test/lib/config.test.ts`
  - `apps/extension/test/logger.test.ts` -> `apps/extension/test/lib/logger.test.ts`
- Create:
  - `apps/extension/locales/en.yml`
  - `apps/extension/locales/zh.yml`
  - `apps/extension/locales/ja.yml`
  - `apps/extension/locales/es.yml`
- Modify: `apps/extension/entrypoints/popup/i18n.ts`
  - Replace `i18next` with WXT `#i18n`.
- Modify: `apps/extension/entrypoints/popup/App.tsx`
  - Remove language selector state and `react-i18next`.
- Modify: `apps/extension/entrypoints/popup/presenter.tsx`
  - Remove only the language selector props/imports/render block.
- Modify tests:
  - `apps/extension/test/popup/i18n.test.ts`
  - `apps/extension/test/popup/app.test.tsx`

## Guardrail: No UI Redesign

Do not change popup sizing, layout, spacing, color, card styles, tabs, source controls, room controls, chat controls, theme toggle, or popout button. The only presenter markup removal is the existing language `Select` in the header. Leave the surrounding header, theme button, and popout button classes as they are.

## Task 1: Add WXT TypeScript And Vitest Foundation

**Files:**
- Modify: `apps/extension/package.json`
- Modify: `apps/extension/tsconfig.json`
- Create: `apps/extension/vitest.config.ts`
- Create: `apps/extension/test/setup/browser.ts`

- [ ] **Step 1: Write the WXT test setup file**

Create `apps/extension/test/setup/browser.ts`:

```ts
import { beforeEach } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

beforeEach(() => {
  fakeBrowser.reset();
});
```

- [ ] **Step 2: Add WXT Vitest config**

Create `apps/extension/vitest.config.ts`:

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

- [ ] **Step 3: Update TypeScript config to extend WXT**

Replace `apps/extension/tsconfig.json` with:

```json
{
  "extends": "./.wxt/tsconfig.json",
  "compilerOptions": {
    "jsx": "react-jsx"
  }
}
```

- [ ] **Step 4: Update extension scripts**

In `apps/extension/package.json`, change only the `typecheck` and `test` scripts:

```json
{
  "scripts": {
    "dev": "wxt",
    "build": "wxt build",
    "typecheck": "wxt prepare && tsc --noEmit",
    "test": "wxt prepare && vitest run --passWithNoTests"
  }
}
```

- [ ] **Step 5: Run WXT prepare and typecheck**

Run:

```bash
pnpm --filter @screenmate/extension typecheck
```

Expected: PASS with `wxt prepare` completing before `tsc --noEmit`.

- [ ] **Step 6: Run extension tests**

Run:

```bash
pnpm --filter @screenmate/extension test
```

Expected: PASS. If a test fails because fake browser state is now active, keep the WXT setup and update only that test's setup, not the production code.

- [ ] **Step 7: Commit WXT test/type foundation**

```bash
git add apps/extension/package.json apps/extension/tsconfig.json apps/extension/vitest.config.ts apps/extension/test/setup/browser.ts
git commit -m "test(extension): add wxt vitest setup"
```

## Task 2: Reorganize Extension Tests By WXT Boundary

**Files:**
- Move files under `apps/extension/test`
- Modify moved test imports

- [ ] **Step 1: Move tests into WXT boundary folders**

Run:

```bash
mkdir -p apps/extension/test/background apps/extension/test/content apps/extension/test/popup apps/extension/test/lib
git mv apps/extension/test/background.test.ts apps/extension/test/background/background.test.ts
git mv apps/extension/test/host-room-runtime.test.ts apps/extension/test/background/host-room-runtime.test.ts
git mv apps/extension/test/host-room-snapshot.test.ts apps/extension/test/background/host-room-snapshot.test.ts
git mv apps/extension/test/source-attachment.test.ts apps/extension/test/content/source-attachment.test.ts
git mv apps/extension/test/video-detector.test.ts apps/extension/test/content/video-detector.test.ts
git mv apps/extension/test/video-preview.test.ts apps/extension/test/content/video-preview.test.ts
git mv apps/extension/test/popup-app.test.tsx apps/extension/test/popup/app.test.tsx
git mv apps/extension/test/popup-i18n.test.ts apps/extension/test/popup/i18n.test.ts
git mv apps/extension/test/popup-logging.test.ts apps/extension/test/popup/logging.test.ts
git mv apps/extension/test/popup-scene-adapter.test.ts apps/extension/test/popup/scene-adapter.test.ts
git mv apps/extension/test/popup-view-model.test.ts apps/extension/test/popup/view-model.test.ts
git mv apps/extension/test/config.test.ts apps/extension/test/lib/config.test.ts
git mv apps/extension/test/logger.test.ts apps/extension/test/lib/logger.test.ts
```

Expected: files move without content changes.

- [ ] **Step 2: Rewrite relative imports in moved tests**

Run:

```bash
perl -0pi -e 's#\\.\\./entrypoints#../../entrypoints#g; s#\\.\\./lib#../../lib#g; s#\\.\\./components#../../components#g' apps/extension/test/background/*.ts apps/extension/test/content/*.ts apps/extension/test/popup/*.ts apps/extension/test/popup/*.tsx apps/extension/test/lib/*.ts
```

Expected: moved tests import production files from `../../entrypoints`, `../../lib`, or `../../components`.

- [ ] **Step 3: Verify no old flat test files remain**

Run:

```bash
find apps/extension/test -maxdepth 1 -type f
```

Expected: no output.

- [ ] **Step 4: Run moved tests**

Run:

```bash
pnpm --filter @screenmate/extension test
```

Expected: PASS with the same test count as before the move.

- [ ] **Step 5: Commit test reorganization**

```bash
git add apps/extension/test
git commit -m "test(extension): organize tests by wxt entrypoint"
```

## Task 3: Add WXT i18n Module And Locale Files

**Files:**
- Modify: `apps/extension/package.json`
- Modify: `apps/extension/wxt.config.ts`
- Create: `apps/extension/locales/en.yml`
- Create: `apps/extension/locales/zh.yml`
- Create: `apps/extension/locales/ja.yml`
- Create: `apps/extension/locales/es.yml`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Add WXT i18n dependency**

Run:

```bash
pnpm --filter @screenmate/extension add -D @wxt-dev/i18n
```

Expected: `apps/extension/package.json` contains `@wxt-dev/i18n` in `devDependencies`, and `pnpm-lock.yaml` is updated.

- [ ] **Step 2: Enable WXT i18n module**

Update `apps/extension/wxt.config.ts` so the `modules` list is:

```ts
modules: ["@wxt-dev/module-react", "@wxt-dev/i18n/module"],
```

The rest of `wxt.config.ts` stays unchanged.

- [ ] **Step 3: Create English locale file**

Create `apps/extension/locales/en.yml`:

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
popout: Pop Out
themeLabel: Theme
themeLight: Light
themeDark: Dark
themeSystem: System
```

- [ ] **Step 4: Create Chinese locale file**

Create `apps/extension/locales/zh.yml`:

```yaml
appName: SyncPlay
tabSource: 资源选择
tabRoom: 房间设置
tabChat: 房间群聊
sourceSniff: 页面嗅探
sourceScreen: 屏幕共享
sourceUpload: 本地上传
detected: 嗅探到的网页资源
mockOrigin: 当前标签
refreshSniff: 重新嗅探
noVideo: 未检测到视频
captureTitle: 捕获屏幕或窗口
captureDescription: 支持共享单个网页标签、应用软件或整个桌面
captureButton: 选择共享内容
screenReady: 屏幕已就绪
screenReadyDescription: 内容捕获成功，请点击底部按钮开启共享房间。
reselect: 重选
uploadDropzone: 点击或拖拽视频文件
roomId: 房间号
openRoom: 进入房间
passwordPlaceholder: 留空则无密码
save: 保存
saved: 已保存
viewerList: 观众连接状态
viewerName: 名称
connType: 连接方式
connPing: 质量
notSharedYet: 暂未分享视频
cancel: 取消
changeSource: 更换当前资源
generateShare: 创建同步房间
endShare: 结束分享
roomChat: 房间群聊
chatPlaceholder: 发点什么...
popout: 弹出窗口
themeLabel: 主题
themeLight: 浅色
themeDark: 深色
themeSystem: 跟随系统
```

- [ ] **Step 5: Create Japanese locale file**

Create `apps/extension/locales/ja.yml`:

```yaml
appName: SyncPlay
tabSource: メディア元
tabRoom: ルーム設定
tabChat: チャット
sourceSniff: スニッファー
sourceScreen: 画面共有
sourceUpload: ファイルアップロード
detected: 検出されたメディア
mockOrigin: タブ
refreshSniff: 再スキャン
noVideo: このページで動画が見つかりません。
captureTitle: 画面 / ウィンドウをキャプチャ
captureDescription: 特定のタブ、アプリウィンドウ、またはデスクトップ全体を共有します
captureButton: 共有コンテンツを選択
screenReady: 画面準備完了
screenReadyDescription: キャプチャ成功。下のボタンをクリックして共有を開始します。
reselect: 再選択
uploadDropzone: クリックまたはドラッグしてアップロード
roomId: ルーム ID
openRoom: 開く
passwordPlaceholder: パスワードなし(空白)
save: 保存
saved: 保存済み
viewerList: 視聴者の接続状態
viewerName: 名前
connType: 接続タイプ
connPing: Ping
notSharedYet: まだ共有されていません
cancel: キャンセル
changeSource: ソースを変更
generateShare: ルームを作成
endShare: 共有を終了
roomChat: チャット
chatPlaceholder: メッセージ...
popout: ポップアウト
themeLabel: テーマ
themeLight: ライト
themeDark: ダーク
themeSystem: システム
```

- [ ] **Step 6: Create Spanish locale file**

Create `apps/extension/locales/es.yml`:

```yaml
appName: SyncPlay
tabSource: Orígenes
tabRoom: Sala Ajustes
tabChat: Chat
sourceSniff: Reconocer
sourceScreen: Compartir Pantalla
sourceUpload: Subir Archivo
detected: Medios detectados
mockOrigin: Pestaña
refreshSniff: Refrescar
noVideo: No se detectó video en esta página.
captureTitle: Capturar pantalla o ventana
captureDescription: Comparte una pestaña, una ventana de app o todo el escritorio.
captureButton: Seleccionar contenido
screenReady: Pantalla lista
screenReadyDescription: Fuente capturada. Haz clic abajo para iniciar la sala.
reselect: Volver a elegir
uploadDropzone: Haz clic o arrastra archivos de video
roomId: ID Sala
openRoom: Entrar
passwordPlaceholder: Dejar en blanco para sin contraseña
save: Guardar
saved: Guardado
viewerList: Conexiones de Espectadores
viewerName: Nombre
connType: Método
connPing: Ping
notSharedYet: No compartido
cancel: Cancelar
changeSource: Cambiar Fuente
generateShare: Crear Sala
endShare: Finalizar
roomChat: Chat
chatPlaceholder: Di algo...
popout: Ventana
themeLabel: Tema
themeLight: Claro
themeDark: Oscuro
themeSystem: Sistema
```

- [ ] **Step 7: Run WXT prepare to generate locale types**

Run:

```bash
pnpm --filter @screenmate/extension exec wxt prepare
```

Expected: PASS and `.wxt` generated types include WXT i18n references.

- [ ] **Step 8: Commit WXT i18n source setup**

```bash
git add apps/extension/package.json apps/extension/wxt.config.ts apps/extension/locales pnpm-lock.yaml
git commit -m "feat(extension): add wxt locale sources"
```

## Task 4: Replace Popup i18n Adapter With WXT i18n

**Files:**
- Modify: `apps/extension/entrypoints/popup/i18n.ts`
- Modify: `apps/extension/test/popup/i18n.test.ts`

- [ ] **Step 1: Write the failing WXT i18n adapter test**

Replace `apps/extension/test/popup/i18n.test.ts` with:

```ts
import { describe, expect, it, vi } from "vitest";

const messages: Record<string, string> = {
  appName: "SyncPlay",
  tabSource: "Source",
  tabRoom: "Room Settings",
  tabChat: "Room Chat",
  sourceSniff: "Site Sniffer",
  sourceScreen: "Screen Share",
  sourceUpload: "Local Upload",
  detected: "Detected Video Resources",
  mockOrigin: "Tab",
  refreshSniff: "Rescan",
  noVideo: "No video detected on this page.",
  captureTitle: "Capture Screen/Window",
  captureDescription: "Share a specific tab, app window, or entire desktop.",
  captureButton: "Select Content",
  screenReady: "Screen Ready",
  screenReadyDescription: "Source captured. Click the button below to start sharing.",
  reselect: "Reselect",
  uploadDropzone: "Click or drag video files",
  roomId: "Room ID",
  openRoom: "Open Room",
  passwordPlaceholder: "Leave blank for none",
  save: "Save",
  saved: "Saved",
  viewerList: "Viewer Connection Status",
  viewerName: "Name",
  connType: "Method",
  connPing: "Ping",
  notSharedYet: "No video shared yet",
  cancel: "Cancel",
  changeSource: "Change Source",
  generateShare: "Start Sync Room",
  endShare: "End Share",
  roomChat: "Room Chat",
  chatPlaceholder: "Say something...",
  popout: "Pop Out",
  themeLabel: "Theme",
  themeLight: "Light",
  themeDark: "Dark",
  themeSystem: "System",
};

vi.mock("#i18n", () => ({
  i18n: {
    t: (key: string) => messages[key] ?? `missing:${key}`,
  },
}));

import {
  extensionLocales,
  getExtensionDictionary,
  normalizeExtensionLocale,
} from "../../entrypoints/popup/i18n";

describe("popup i18n", () => {
  it("normalizes browser plugin locales to supported languages", () => {
    expect(normalizeExtensionLocale("zh-CN")).toBe("zh");
    expect(normalizeExtensionLocale("ja-JP")).toBe("ja");
    expect(normalizeExtensionLocale("fr-FR")).toBe("en");
  });

  it("lists supported WXT locale source files", () => {
    expect(extensionLocales).toEqual(["zh", "en", "ja", "es"]);
  });

  it("returns presenter copy from WXT i18n", () => {
    const copy = getExtensionDictionary();

    expect(copy.appName).toBe("SyncPlay");
    expect(copy.tabSource).toBe("Source");
    expect(copy.themeSystem).toBe("System");
    expect("languageLabel" in copy).toBe(false);
    expect("systemLabel" in copy).toBe(false);
  });
});
```

- [ ] **Step 2: Run the popup i18n test to verify it fails**

Run:

```bash
pnpm --filter @screenmate/extension test -- test/popup/i18n.test.ts
```

Expected: FAIL because `getExtensionDictionary` still requires a language argument and the returned dictionary still includes language selector keys.

- [ ] **Step 3: Replace popup i18n implementation**

Replace `apps/extension/entrypoints/popup/i18n.ts` with:

```ts
import { i18n } from "#i18n";

export const extensionLocales = ["zh", "en", "ja", "es"] as const;

export type ExtensionLocale = (typeof extensionLocales)[number];

export type ExtensionDictionary = {
  appName: string;
  tabSource: string;
  tabRoom: string;
  tabChat: string;
  sourceSniff: string;
  sourceScreen: string;
  sourceUpload: string;
  detected: string;
  mockOrigin: string;
  refreshSniff: string;
  noVideo: string;
  captureTitle: string;
  captureDescription: string;
  captureButton: string;
  screenReady: string;
  screenReadyDescription: string;
  reselect: string;
  uploadDropzone: string;
  roomId: string;
  openRoom: string;
  passwordPlaceholder: string;
  save: string;
  saved: string;
  viewerList: string;
  viewerName: string;
  connType: string;
  connPing: string;
  notSharedYet: string;
  cancel: string;
  changeSource: string;
  generateShare: string;
  endShare: string;
  roomChat: string;
  chatPlaceholder: string;
  popout: string;
  themeLabel: string;
  themeLight: string;
  themeDark: string;
  themeSystem: string;
};

const FALLBACK_LOCALE: ExtensionLocale = "en";

function isExtensionLocale(language: string): language is ExtensionLocale {
  return (extensionLocales as readonly string[]).includes(language);
}

export function normalizeExtensionLocale(language: string | undefined | null): ExtensionLocale {
  if (!language) {
    return FALLBACK_LOCALE;
  }

  const baseLanguage = language.toLowerCase().split("-")[0];
  return isExtensionLocale(baseLanguage) ? baseLanguage : FALLBACK_LOCALE;
}

export function getExtensionDictionary(): ExtensionDictionary {
  return {
    appName: i18n.t("appName"),
    tabSource: i18n.t("tabSource"),
    tabRoom: i18n.t("tabRoom"),
    tabChat: i18n.t("tabChat"),
    sourceSniff: i18n.t("sourceSniff"),
    sourceScreen: i18n.t("sourceScreen"),
    sourceUpload: i18n.t("sourceUpload"),
    detected: i18n.t("detected"),
    mockOrigin: i18n.t("mockOrigin"),
    refreshSniff: i18n.t("refreshSniff"),
    noVideo: i18n.t("noVideo"),
    captureTitle: i18n.t("captureTitle"),
    captureDescription: i18n.t("captureDescription"),
    captureButton: i18n.t("captureButton"),
    screenReady: i18n.t("screenReady"),
    screenReadyDescription: i18n.t("screenReadyDescription"),
    reselect: i18n.t("reselect"),
    uploadDropzone: i18n.t("uploadDropzone"),
    roomId: i18n.t("roomId"),
    openRoom: i18n.t("openRoom"),
    passwordPlaceholder: i18n.t("passwordPlaceholder"),
    save: i18n.t("save"),
    saved: i18n.t("saved"),
    viewerList: i18n.t("viewerList"),
    viewerName: i18n.t("viewerName"),
    connType: i18n.t("connType"),
    connPing: i18n.t("connPing"),
    notSharedYet: i18n.t("notSharedYet"),
    cancel: i18n.t("cancel"),
    changeSource: i18n.t("changeSource"),
    generateShare: i18n.t("generateShare"),
    endShare: i18n.t("endShare"),
    roomChat: i18n.t("roomChat"),
    chatPlaceholder: i18n.t("chatPlaceholder"),
    popout: i18n.t("popout"),
    themeLabel: i18n.t("themeLabel"),
    themeLight: i18n.t("themeLight"),
    themeDark: i18n.t("themeDark"),
    themeSystem: i18n.t("themeSystem"),
  };
}

export default i18n;
```

- [ ] **Step 4: Run popup i18n test**

Run:

```bash
pnpm --filter @screenmate/extension test -- test/popup/i18n.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit i18n adapter**

```bash
git add apps/extension/entrypoints/popup/i18n.ts apps/extension/test/popup/i18n.test.ts
git commit -m "feat(extension): read popup copy from wxt i18n"
```

## Task 5: Remove Popup Language Selector Without UI Redesign

**Files:**
- Modify: `apps/extension/entrypoints/popup/App.tsx`
- Modify: `apps/extension/entrypoints/popup/presenter.tsx`
- Modify: `apps/extension/test/popup/app.test.tsx`

- [ ] **Step 1: Update popup presenter test for removed selector**

In `apps/extension/test/popup/app.test.tsx`, add the same `#i18n` mock from Task 4 above the imports that load `../../entrypoints/popup/i18n`, then update calls from:

```ts
copy={getExtensionDictionary("en")}
```

to:

```ts
copy={getExtensionDictionary()}
```

In the first render test, add this assertion:

```ts
expect(screen.queryByRole("combobox")).toBeNull();
```

- [ ] **Step 2: Run popup app test to verify it fails**

Run:

```bash
pnpm --filter @screenmate/extension test -- test/popup/app.test.tsx
```

Expected: FAIL because `ExtensionPopupPresenter` still renders the language `Select`.

- [ ] **Step 3: Remove language state from popup container**

In `apps/extension/entrypoints/popup/App.tsx`:

Remove this import:

```ts
import { startTransition, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
```

Replace it with:

```ts
import { useMemo } from "react";
```

Replace the i18n import block:

```ts
import {
  getExtensionDictionary,
  getExtensionLanguagePreference,
  normalizeExtensionLocale,
  persistExtensionLanguagePreference,
  resolveExtensionLanguagePreference,
  type ExtensionLanguagePreference,
} from "./i18n";
```

with:

```ts
import { getExtensionDictionary } from "./i18n";
```

Remove these lines inside `App`:

```ts
const { i18n } = useTranslation();
const [languagePreference, setLanguagePreference] =
  useState<ExtensionLanguagePreference>(getExtensionLanguagePreference);
```

Replace:

```ts
const language = normalizeExtensionLocale(i18n.resolvedLanguage ?? i18n.language);
const copy = getExtensionDictionary(language);
```

with:

```ts
const copy = getExtensionDictionary();
```

Remove these props from `<ExtensionPopupPresenter />`:

```tsx
languagePreference={languagePreference}
onLanguageChange={(nextLanguage) => {
  const preference = nextLanguage as ExtensionLanguagePreference;
  setLanguagePreference(preference);
  persistExtensionLanguagePreference(preference);
  startTransition(() => {
    void i18n.changeLanguage(
      resolveExtensionLanguagePreference(preference),
    );
  });
}}
```

- [ ] **Step 4: Remove only language selector wiring from presenter**

In `apps/extension/entrypoints/popup/presenter.tsx`, remove `Globe` from the `lucide-react` import list.

Remove this whole import block:

```ts
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
```

Replace:

```ts
import type {
  ExtensionDictionary,
  ExtensionLanguagePreference,
} from "./i18n";
```

with:

```ts
import type { ExtensionDictionary } from "./i18n";
```

Remove these destructured props:

```ts
languagePreference,
onLanguageChange,
```

Remove these prop types:

```ts
languagePreference: ExtensionLanguagePreference;
onLanguageChange: (language: string) => void;
```

Remove only this JSX block from the header controls:

```tsx
<Select value={languagePreference} onValueChange={onLanguageChange}>
  <SelectTrigger aria-label={copy.languageLabel} className="h-8 w-[110px] gap-1.5 border-border bg-background px-2.5 text-xs font-medium shadow-sm">
    <Globe className="size-3.5 shrink-0 text-muted-foreground" />
    <SelectValue />
  </SelectTrigger>
  <SelectContent align="end">
    <SelectGroup>
      <SelectItem value="system">{copy.systemLabel}</SelectItem>
      <SelectItem value="zh">中文</SelectItem>
      <SelectItem value="en">English</SelectItem>
      <SelectItem value="ja">日本語</SelectItem>
      <SelectItem value="es">Español</SelectItem>
    </SelectGroup>
  </SelectContent>
</Select>
```

Do not change the surrounding header, theme button, or popout button class names.

- [ ] **Step 5: Remove popup i18n bootstrap import**

In `apps/extension/entrypoints/popup/main.tsx`, remove:

```ts
import "./i18n";
```

The popup container imports `getExtensionDictionary`, so the adapter is still loaded.

- [ ] **Step 6: Run popup tests**

Run:

```bash
pnpm --filter @screenmate/extension test -- test/popup/app.test.tsx test/popup/i18n.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit language selector removal**

```bash
git add apps/extension/entrypoints/popup/App.tsx apps/extension/entrypoints/popup/presenter.tsx apps/extension/entrypoints/popup/main.tsx apps/extension/test/popup/app.test.tsx
git commit -m "feat(extension): follow wxt locale in popup"
```

## Task 6: Remove Legacy i18n Dependencies And Verify Build Output

**Files:**
- Modify: `apps/extension/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Remove legacy i18n packages**

Run:

```bash
pnpm --filter @screenmate/extension remove i18next i18next-browser-languagedetector react-i18next
```

Expected: `apps/extension/package.json` no longer lists those packages and `pnpm-lock.yaml` is updated.

- [ ] **Step 2: Run full extension verification**

Run:

```bash
pnpm --filter @screenmate/extension test
pnpm --filter @screenmate/extension typecheck
pnpm --filter @screenmate/extension build
```

Expected: all three commands PASS.

- [ ] **Step 3: Verify WXT locale output exists**

Run:

```bash
find apps/extension/.output/chrome-mv3/_locales -name messages.json | sort
```

Expected output includes:

```text
apps/extension/.output/chrome-mv3/_locales/en/messages.json
apps/extension/.output/chrome-mv3/_locales/es/messages.json
apps/extension/.output/chrome-mv3/_locales/ja/messages.json
apps/extension/.output/chrome-mv3/_locales/zh/messages.json
```

- [ ] **Step 4: Commit dependency cleanup**

```bash
git add apps/extension/package.json pnpm-lock.yaml
git commit -m "chore(extension): remove legacy i18n dependencies"
```

## Self-Review Checklist

- Spec coverage: covered WXT Vitest, fake browser setup, test file organization, WXT TypeScript config, WXT locale files, popup WXT i18n adapter, removal of legacy i18n dependencies, and no-UI-redesign guardrail.
- Placeholder scan: no `TBD`, `TODO`, or deferred implementation placeholders are present.
- Type consistency: `ExtensionDictionary`, `ExtensionLocale`, and `getExtensionDictionary()` signatures are consistent across tasks.
- UI constraint: only the language selector is removed; all other popup UI structure and class names are preserved.
