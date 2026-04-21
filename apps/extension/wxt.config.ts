import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    permissions: ["activeTab", "tabs", "webNavigation"],
    host_permissions: ["http://*/*", "https://*/*"],
  },
});
