import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@screenmate/shared": resolve("../../packages/shared/src/index.ts"),
    },
  },
});
