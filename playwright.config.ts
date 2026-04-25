import { defineConfig } from "@playwright/test";

const roomTokenSecret = "screenmate-e2e-room-token-secret";
const turnAuthSecret = "screenmate-e2e-turn-secret";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: false,
    trace: "on-first-retry",
    viewport: {
      width: 1440,
      height: 960,
    },
  },
  webServer: [
    {
      command:
        "pnpm --filter @screenmate/cloudflare dev --ip 127.0.0.1 --port 8787 --local --persist-to .wrangler/state-e2e",
      url: "http://127.0.0.1:8787/config/ice",
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ROOM_TOKEN_SECRET: roomTokenSecret,
        TURN_AUTH_SECRET: turnAuthSecret,
        TURN_REALM: "screenmate.local",
        TURN_URLS: "",
        TURN_TTL_SECONDS: "600",
      },
    },
    {
      command:
        "VITE_SCREENMATE_API_BASE_URL=http://127.0.0.1:8787 pnpm --filter @screenmate/viewer-web dev -- --host 127.0.0.1 --port 4173 --strictPort",
      url: "http://127.0.0.1:4173/e2e-host.html",
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
