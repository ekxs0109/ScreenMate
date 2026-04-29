// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { markScreenMateViewerPage } from "../src/screenmate-page-marker";

afterEach(() => {
  document.documentElement.removeAttribute("data-screenmate-app");
  document.head.innerHTML = "";
});

describe("markScreenMateViewerPage", () => {
  it("marks the shared DOM so extension content scripts can identify viewer pages", () => {
    markScreenMateViewerPage();

    expect(document.documentElement.dataset.screenmateApp).toBe("viewer");
    expect(
      document
        .querySelector('meta[name="screenmate-app"]')
        ?.getAttribute("content"),
    ).toBe("viewer");
  });
});
