import fs from "fs";
import os from "os";
import path from "path";
import { chromium, expect, test as base, type BrowserContext, type Page } from "@playwright/test";

const extensionPath = path.resolve(
  __dirname,
  "../../../apps/extension/.output/chrome-mv3",
);
const viewerBaseUrl = "http://127.0.0.1:4173";
const hostHarnessUrl = `${viewerBaseUrl}/e2e-host.html`;

export type ScreenMateFixture = {
  context: BrowserContext;
  extensionId: string;
  hostPage: Page;
  popupPage: Page;
  viewerPage: Page;
};

export const test = base.extend<{ screenmate: ScreenMateFixture }>({
  screenmate: async ({}, use) => {
    if (!fs.existsSync(extensionPath)) {
      throw new Error(
        `Missing built extension at ${extensionPath}. Run "pnpm e2e:prepare" first.`,
      );
    }

    const userDataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "screenmate-e2e-"),
    );
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      viewport: { width: 1440, height: 960 },
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });

    try {
      const serviceWorker =
        context.serviceWorkers()[0] ??
        (await context.waitForEvent("serviceworker"));
      const extensionId = new URL(serviceWorker.url()).host;
      const hostPage = await context.newPage();
      await hostPage.goto(hostHarnessUrl);
      await expect(hostPage.getByTestId("e2e-host-video")).toBeVisible();

      const popupPage = await context.newPage();
      await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
      await expect(popupPage.getByTestId("popup-tab-source")).toBeVisible();

      const viewerPage = await context.newPage();

      await use({
        context,
        extensionId,
        hostPage,
        popupPage,
        viewerPage,
      });
    } finally {
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  },
});

export { expect };
