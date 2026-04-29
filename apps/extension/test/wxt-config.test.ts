import { describe, expect, it } from "vitest";

import wxtConfig, {
  createExtensionCodeInspectorPlugin,
  extensionCodeInspectorOptions,
  isCodeInspectorDevProcess,
  resolveChromiumLaunchConfig,
} from "../wxt.config";

describe("wxt config", () => {
  it("does not override WXT-managed html entrypoints with manual rollup inputs", () => {
    const viteConfig = wxtConfig.vite?.({} as never) as any;

    expect(viteConfig?.build?.rollupOptions?.input).toBeUndefined();
  });

  it("resolves internal workspace packages from source during extension dev", () => {
    const viteConfig = wxtConfig.vite?.({} as never) as any;

    expect(viteConfig?.resolve?.alias).toMatchObject({
      "@screenmate/shared": expect.stringContaining("packages/shared/src/index.ts"),
      "@screenmate/webrtc-core": expect.stringContaining(
        "packages/webrtc-core/src/index.ts",
      ),
    });
  });

  it("enables code inspector for extension Vite builds", () => {
    const viteConfig = wxtConfig.vite?.({} as never) as any;
    const excludedConditions = Array.isArray(extensionCodeInspectorOptions.exclude)
      ? extensionCodeInspectorOptions.exclude
      : [extensionCodeInspectorOptions.exclude];

    expect(viteConfig?.plugins?.map((plugin: any) => plugin?.name)).toContain(
      "@code-inspector/vite",
    );
    expect(extensionCodeInspectorOptions.injectTo).toEqual([
      expect.stringContaining("entrypoints/popup/main.tsx"),
      expect.stringContaining("entrypoints/player/main.tsx"),
    ]);
    expect(extensionCodeInspectorOptions.include).toEqual([
      expect.any(RegExp),
      expect.any(RegExp),
    ]);
    expect(
      extensionCodeInspectorOptions.include?.some((condition) =>
        condition instanceof RegExp &&
        condition.test("/entrypoints/popup/main.tsx"),
      ),
    ).toBe(true);
    expect(
      extensionCodeInspectorOptions.include?.some((condition) =>
        condition instanceof RegExp &&
        condition.test("/entrypoints/player/main.tsx"),
      ),
    ).toBe(true);
    expect(extensionCodeInspectorOptions.skipSnippets).toContain("htmlScript");
    expect(
      excludedConditions.some((condition) =>
        condition instanceof RegExp && condition.test("/lib/logger.ts"),
      ),
    ).toBe(true);
  });

  it("keeps code inspector side effects out of tests and WXT prepare", () => {
    expect(isCodeInspectorDevProcess({ NODE_ENV: "test" }, ["node"])).toBe(
      false,
    );
    expect(isCodeInspectorDevProcess({ VITEST: "true" }, ["node"])).toBe(false);
    expect(isCodeInspectorDevProcess({}, ["node", "wxt", "prepare"])).toBe(
      false,
    );
    expect(isCodeInspectorDevProcess({}, ["node", "wxt", "build"])).toBe(
      false,
    );
    expect(isCodeInspectorDevProcess({}, ["node", "wxt"])).toBe(true);
  });

  it("does not inject code inspector during WXT SSR pre-render transforms", async () => {
    const plugin = createExtensionCodeInspectorPlugin() as any;
    const source = "export const value = 1;";

    await expect(
      Promise.resolve(
        plugin.transform(source, "/entrypoints/popup/main.tsx", { ssr: true }),
      ),
    ).resolves.toBe(source);
  });

  it("uses Brave when Chrome is missing and Brave is installed", () => {
    const launchConfig = resolveChromiumLaunchConfig(
      { HOME: "/Users/example" },
      (filePath) => String(filePath).includes("Brave Browser.app"),
    );

    expect(launchConfig.chromiumBinaries).toEqual({
      chrome: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    });
    expect(
      launchConfig.chromiumArgs.some((arg) =>
        arg.endsWith("apps/extension/.wxt/brave-data"),
      ),
    ).toBe(true);
  });

  it("allows overriding the Brave user data directory", () => {
    const launchConfig = resolveChromiumLaunchConfig(
      {
        SCREENMATE_WXT_BRAVE_USER_DATA_DIR: "/tmp/screenmate-brave",
        SCREENMATE_WXT_CHROMIUM: "brave",
      },
      () => false,
    );

    expect(launchConfig.chromiumArgs).toContain(
      "--user-data-dir=/tmp/screenmate-brave",
    );
  });
});
