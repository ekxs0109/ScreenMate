import { configDefaults, defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

export default defineConfig({
  plugins: [
    WxtVitest({
      dev: {
        server: {
          host: "127.0.0.1",
          origin: "127.0.0.1",
          port: 37100,
          strictPort: true,
        },
      },
    }),
  ],
  test: {
    exclude: [
      ...configDefaults.exclude,
      "**/.output/**",
      "**/.wxt/**",
    ],
    pool: "threads",
    setupFiles: ["./test/setup/browser.ts"],
  },
});
