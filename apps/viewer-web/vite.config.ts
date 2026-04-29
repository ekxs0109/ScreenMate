import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { codeInspectorPlugin } from "code-inspector-plugin";
import { defineConfig } from "vite";
import path from "path";

export function isCodeInspectorDevProcess(
  env: NodeJS.ProcessEnv = process.env,
  argv = process.argv,
) {
  return (
    env.NODE_ENV !== "test" &&
    env.VITEST !== "true" &&
    !argv.some(
      (arg) =>
        arg === "build" || arg === "preview" || arg.includes("vitest"),
    )
  );
}

export const viewerCodeInspectorOptions = {
  bundler: "vite",
  dev: () => isCodeInspectorDevProcess(),
} satisfies Parameters<typeof codeInspectorPlugin>[0];

export default defineConfig({
  plugins: [
    codeInspectorPlugin(viewerCodeInspectorOptions),
    react(),
    tailwindcss(),
  ],
  server: {
    host: "0.0.0.0",
    port: 4173,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
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
});
