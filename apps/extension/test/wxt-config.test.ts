import { describe, expect, it } from "vitest";

import wxtConfig, { resolveChromiumLaunchConfig } from "../wxt.config";

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
