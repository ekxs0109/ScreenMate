import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import wxtConfig, {
  createExtensionVitePlugins,
  createExtensionCodeInspectorPlugin,
  extensionCodeInspectorOptions,
  isCodeInspectorDevProcess,
} from "../wxt.config";

describe("wxt config", () => {
  it("keeps inherited DEBUG logs out of build, typecheck, and test scripts", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts.dev).toBe("wxt");
    expect(packageJson.scripts.build).toMatch(/^DEBUG= /);
    expect(packageJson.scripts.typecheck).toContain("DEBUG= wxt prepare");
    expect(packageJson.scripts.test).toContain("DEBUG= wxt prepare");
    expect(packageJson.scripts.test).toContain("DEBUG= vitest run");
  });

  it("does not override WXT-managed html entrypoints with manual rollup inputs", () => {
    const viteConfig = wxtConfig.vite?.({} as never) as any;

    expect(viteConfig?.build?.rollupOptions?.input).toBeUndefined();
  });

  it("sets localized extension metadata instead of exposing the package name", () => {
    expect(wxtConfig.manifest?.name).toBe("__MSG_extName__");
    expect(wxtConfig.manifest?.short_name).toBe("ScreenMate");
    expect(wxtConfig.manifest?.description).toBe("__MSG_extDescription__");
    expect(wxtConfig.manifest?.default_locale).toBe("en");
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

  it("enables code inspector for extension dev builds", () => {
    const plugins = createExtensionVitePlugins(
      { CODE_INSPECTOR: "true" },
      ["node", "wxt"],
    );
    const excludedConditions = Array.isArray(extensionCodeInspectorOptions.exclude)
      ? extensionCodeInspectorOptions.exclude
      : [extensionCodeInspectorOptions.exclude];

    expect(plugins.map((plugin: any) => plugin?.name)).toContain(
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
    expect(isCodeInspectorDevProcess({}, ["node", "wxt"])).toBe(false);
    expect(
      isCodeInspectorDevProcess({ CODE_INSPECTOR: "true" }, ["node", "wxt"]),
    ).toBe(true);
    expect(isCodeInspectorDevProcess({ NODE_ENV: "test" }, ["node"])).toBe(
      false,
    );
    expect(isCodeInspectorDevProcess({ VITEST: "true" }, ["node"])).toBe(false);
    expect(isCodeInspectorDevProcess({ npm_lifecycle_event: "test" }, ["node"])).toBe(
      false,
    );
    expect(
      isCodeInspectorDevProcess({ npm_lifecycle_event: "typecheck" }, ["node"]),
    ).toBe(false);
    expect(
      isCodeInspectorDevProcess(
        { npm_lifecycle_script: "wxt prepare && vitest run --passWithNoTests" },
        ["node"],
      ),
    ).toBe(false);
    expect(isCodeInspectorDevProcess({}, ["node", "wxt", "prepare"])).toBe(
      false,
    );
    expect(isCodeInspectorDevProcess({}, ["node", "wxt", "build"])).toBe(
      false,
    );
  });

  it("does not create code inspector plugin outside extension dev builds", () => {
    const plugins = createExtensionVitePlugins(
      { npm_lifecycle_event: "test" },
      ["node"],
    );

    expect(plugins.map((plugin: any) => plugin?.name)).not.toContain(
      "@code-inspector/vite",
    );
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

  it("uses the WXT-managed Chrome profile by default", () => {
    expect(wxtConfig.webExt).toBeUndefined();
  });
});
