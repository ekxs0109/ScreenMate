import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/screenmate";

test("renders the room activity host harness page", async ({ screenmate }) => {
  await expect(screenmate.hostPage.getByTestId("e2e-host-video")).toBeVisible();
});

test("covers the popup + viewer room activity smoke flow", async ({ screenmate }) => {
  test.slow();

  const { popupPage, viewerPage } = screenmate;

  await waitForSniffCard(popupPage);
  await popupPage.locator('[data-testid^="popup-sniff-card-"]').first().click();
  await popupPage.getByTestId("popup-start-or-attach").click();

  await popupPage.getByTestId("popup-tab-room").click();
  await expect(popupPage.getByTestId("popup-room-status")).toContainText("attached");

  const roomId = (await popupPage.getByTestId("popup-room-id-value").textContent())?.trim();
  if (!roomId) {
    throw new Error("Expected a room id after starting the room.");
  }

  await viewerPage.goto("http://127.0.0.1:4173/");
  await viewerPage.getByTestId("viewer-room-code-input").fill(roomId);
  await viewerPage.getByTestId("viewer-join-submit").click();

  await waitForViewerConnected(viewerPage);
  await expect(viewerPage.getByTestId("viewer-video")).toBeVisible();
  await expect(popupPage.getByTestId("popup-viewer-count")).toHaveText("1");

  const hostMessage = "host smoke ping";
  const viewerMessage = "viewer smoke pong";
  const renamedViewer = "QA Viewer";

  await popupPage.getByTestId("popup-tab-chat").click();
  await popupPage.getByTestId("popup-chat-input").fill(hostMessage);
  await popupPage.getByTestId("popup-chat-send").click();
  await expect(messageLocator(viewerPage, "viewer-chat-message-", hostMessage)).toHaveCount(1);

  await viewerPage.getByTestId("viewer-chat-input").fill(viewerMessage);
  await viewerPage.getByTestId("viewer-chat-send").click();
  await expect(messageLocator(popupPage, "popup-chat-message-", viewerMessage)).toHaveCount(1);

  const displayNameInput = viewerPage.getByTestId("viewer-display-name-input");
  await displayNameInput.fill(renamedViewer);
  await expect(displayNameInput).toHaveValue(renamedViewer);
  await displayNameInput.blur();

  await popupPage.getByTestId("popup-tab-room").click();
  await expect(popupPage.locator('[data-testid^="popup-viewer-name-"]', { hasText: renamedViewer })).toHaveCount(1);
  await expect(popupPage.getByTestId("popup-viewer-count")).toHaveText("1");

  await popupPage.reload();
  await expect(popupPage.getByTestId("popup-room-id-value")).toHaveText(roomId);
  await viewerPage.reload();

  await popupPage.getByTestId("popup-tab-room").click();
  await expect
    .poll(async () => popupPage.locator('[data-testid^="popup-viewer-row-"]').count(), {
      message: "Expected the popup roster rows to be restored after refresh.",
      timeout: 10_000,
    })
    .toBeGreaterThan(0);
  await popupPage.getByTestId("popup-tab-chat").click();
  await expect(messageLocator(popupPage, "popup-chat-message-", hostMessage)).toHaveCount(1);
  await expect(messageLocator(popupPage, "popup-chat-message-", viewerMessage)).toHaveCount(1);
  await expect(viewerPage).toHaveURL(new RegExp(`/rooms/${roomId}$`));
});

async function waitForSniffCard(popupPage: Page) {
  await expect
    .poll(async () => popupPage.locator('[data-testid^="popup-sniff-card-"]').count(), {
      message: "Expected the popup to discover at least one sniffable video source.",
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
}

async function waitForViewerConnected(viewerPage: Page) {
  await expect(viewerPage.locator('[data-testid="viewer-connection-state"][data-status="connected"]')).toBeVisible({
    timeout: 20_000,
  });
}

function messageLocator(page: Page, prefix: string, text: string) {
  return page.locator(`[data-testid^="${prefix}"]`, { hasText: text });
}
