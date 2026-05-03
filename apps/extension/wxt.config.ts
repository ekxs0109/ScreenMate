import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";
import type { codeInspectorPlugin } from "code-inspector-plugin";
import { createRequire } from "node:module";
import path from "path";

const require = createRequire(import.meta.url);

export function isCodeInspectorDevProcess(
  env: NodeJS.ProcessEnv = process.env,
  argv = process.argv,
) {
  const npmLifecycleEvent = env.npm_lifecycle_event?.trim();
  const npmLifecycleScript = env.npm_lifecycle_script?.trim();

  return (
    env.CODE_INSPECTOR === "true" &&
    env.NODE_ENV !== "test" &&
    env.VITEST !== "true" &&
    npmLifecycleEvent !== "build" &&
    npmLifecycleEvent !== "test" &&
    npmLifecycleEvent !== "typecheck" &&
    !npmLifecycleScript?.includes("wxt prepare") &&
    !argv.some(
      (arg) =>
        arg === "build" ||
        arg === "prepare" ||
        arg === "preview" ||
        arg.includes("vitest"),
    )
  );
}

export const extensionCodeInspectorOptions = {
  bundler: "vite",
  dev: () => isCodeInspectorDevProcess(),
  exclude: [/.*/],
  include: [
    /[\\/]entrypoints[\\/]popup[\\/]/,
    /[\\/]entrypoints[\\/]player[\\/]/,
  ],
  injectTo: [
    path.resolve(__dirname, "entrypoints/popup/main.tsx"),
    path.resolve(__dirname, "entrypoints/player/main.tsx"),
  ],
  skipSnippets: ["htmlScript"],
} satisfies Parameters<typeof codeInspectorPlugin>[0];

export function createExtensionCodeInspectorPlugin() {
  const { codeInspectorPlugin } = require(
    "code-inspector-plugin",
  ) as typeof import("code-inspector-plugin");
  const plugin = codeInspectorPlugin(extensionCodeInspectorOptions);
  const transform = plugin.transform;

  return {
    ...plugin,
    transform(
      this: unknown,
      code: string,
      id: string,
      options?: { ssr?: boolean },
    ) {
      if (options?.ssr) {
        return code;
      }

      if (typeof transform === "function") {
        return transform.call(this, code, id, options);
      }

      return transform?.handler?.call(this, code, id, options) ?? code;
    },
  };
}

export function createExtensionVitePlugins(
  env: NodeJS.ProcessEnv = process.env,
  argv = process.argv,
) {
  return [
    ...(isCodeInspectorDevProcess(env, argv)
      ? [createExtensionCodeInspectorPlugin()]
      : []),
    tailwindcss(),
  ];
}

export default defineConfig({
  modules: ["@wxt-dev/module-react", "@wxt-dev/i18n/module"],
  manifest: {
    name: "__MSG_extName__",
    short_name: "ScreenMate",
    description: "__MSG_extDescription__",
    default_locale: "en",
    permissions: ["activeTab", "tabs", "webNavigation", "storage", "offscreen"],
    host_permissions: ["http://*/*", "https://*/*"],
    web_accessible_resources: [
      {
        resources: ["patterns/cubes.png"],
        matches: ["<all_urls>"],
      },
    ],
  },
  vite: () => ({
    plugins: createExtensionVitePlugins(),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "."),
        "@screenmate/shared": path.resolve(
          __dirname,
          "../../packages/shared/src/index.ts",
        ),
        "@screenmate/webrtc-core": path.resolve(
          __dirname,
          "../../packages/webrtc-core/src/index.ts",
        ),
      },
    },
  }),
});
