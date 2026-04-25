import { describe, expect, it } from "vitest";

import wxtConfig from "../wxt.config";

describe("wxt config", () => {
  it("does not override WXT-managed html entrypoints with manual rollup inputs", () => {
    const viteConfig = wxtConfig.vite?.({} as never) as any;

    expect(viteConfig?.build?.rollupOptions?.input).toBeUndefined();
  });
});
