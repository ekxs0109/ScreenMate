import { describe, expect, it } from "vitest";

import viteConfig, {
  isCodeInspectorDevProcess,
  viewerCodeInspectorOptions,
} from "../vite.config";

function pluginNames(plugins: any[] = []) {
  return plugins
    .flat(Number.POSITIVE_INFINITY)
    .map((plugin: any) => plugin?.name);
}

describe("viewer Vite config", () => {
  it("enables code inspector for viewer builds", () => {
    const names = pluginNames(viteConfig.plugins);

    expect(names).toContain("@code-inspector/vite");
    expect(viewerCodeInspectorOptions.bundler).toBe("vite");
    expect(names.indexOf("@code-inspector/vite")).toBeLessThan(
      names.indexOf("vite:react-babel"),
    );
  });

  it("keeps code inspector side effects out of tests", () => {
    expect(isCodeInspectorDevProcess({ NODE_ENV: "test" }, ["node"])).toBe(
      false,
    );
    expect(isCodeInspectorDevProcess({ VITEST: "true" }, ["node"])).toBe(false);
    expect(isCodeInspectorDevProcess({}, ["node", "vitest"])).toBe(false);
    expect(isCodeInspectorDevProcess({}, ["node", "vite", "build"])).toBe(
      false,
    );
    expect(isCodeInspectorDevProcess({}, ["node", "vite"])).toBe(true);
  });
});
