import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";
import { existsSync } from "node:fs";
import path from "path";

const googleChromeBinary =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const braveBrowserBinary =
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";

export function resolveChromiumLaunchConfig(
  env: NodeJS.ProcessEnv,
  fileExists = existsSync,
) {
  const chromiumBrowser = env.SCREENMATE_WXT_CHROMIUM?.trim().toLowerCase();
  const useBrave =
    chromiumBrowser === "brave" ||
    (chromiumBrowser == null &&
      !fileExists(googleChromeBinary) &&
      fileExists(braveBrowserBinary));
  const braveProfileDirectory =
    env.SCREENMATE_WXT_BRAVE_PROFILE_DIRECTORY?.trim() || "Default";
  const braveUserDataDir =
    env.SCREENMATE_WXT_BRAVE_USER_DATA_DIR?.trim() ||
    path.resolve(__dirname, ".wxt/brave-data");

  return {
    chromiumArgs: useBrave
      ? [
          `--user-data-dir=${braveUserDataDir}`,
          `--profile-directory=${braveProfileDirectory}`,
        ]
      : [`--user-data-dir=${path.resolve(__dirname, ".wxt/chrome-data")}`],
    chromiumBinaries: useBrave
      ? {
          chrome: braveBrowserBinary,
        }
      : undefined,
  };
}

const { chromiumArgs, chromiumBinaries } = resolveChromiumLaunchConfig(
  process.env,
);

export default defineConfig({
  modules: ["@wxt-dev/module-react", "@wxt-dev/i18n/module"],
  webExt: {
    ...(chromiumBinaries ? { binaries: chromiumBinaries } : {}),
    chromiumArgs,
  },
  manifest: {
    default_locale: "en",
    permissions: ["activeTab", "tabs", "webNavigation", "storage", "desktopCapture"],
    host_permissions: ["http://*/*", "https://*/*"],
    web_accessible_resources: [
      {
        resources: ["patterns/cubes.png"],
        matches: ["<all_urls>"],
      },
    ],
  },
  vite: () => ({
    plugins: [tailwindcss()],
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
