import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const chromiumBrowser = process.env.SCREENMATE_WXT_CHROMIUM?.trim().toLowerCase();
const braveProfileDirectory =
  process.env.SCREENMATE_WXT_BRAVE_PROFILE_DIRECTORY?.trim() || "Default";
const braveUserDataDir =
  process.env.HOME != null
    ? path.join(
        process.env.HOME,
        "Library",
        "Application Support",
        "BraveSoftware",
        "Brave-Browser",
      )
    : path.resolve(__dirname, ".wxt/chrome-data");
const chromiumBinaries =
  chromiumBrowser === "brave"
    ? {
        chrome: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      }
    : undefined;
const chromiumArgs =
  chromiumBrowser === "brave"
    ? [
        `--user-data-dir=${braveUserDataDir}`,
        `--profile-directory=${braveProfileDirectory}`,
      ]
    : [`--user-data-dir=${path.resolve(__dirname, ".wxt/chrome-data")}`];

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
      },
    },
  }),
});
