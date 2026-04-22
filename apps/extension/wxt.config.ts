import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    permissions: ["activeTab", "tabs", "webNavigation", "storage"],
    host_permissions: ["http://*/*", "https://*/*"],
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
