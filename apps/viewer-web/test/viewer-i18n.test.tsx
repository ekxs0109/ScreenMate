// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  VIEWER_LOCALE_STORAGE_KEY,
  ViewerI18nProvider,
  resolveViewerLocale,
  resolveViewerLocalePreference,
  useViewerI18n,
} from "../src/i18n";

function LocaleProbe() {
  const { locale, setLocale, t } = useViewerI18n();

  return (
    <div>
      <span>{locale}</span>
      <span>{t("joinRoomTitle")}</span>
      <button type="button" onClick={() => setLocale("zh")}>
        switch
      </button>
    </div>
  );
}

describe("viewer i18n", () => {
  beforeEach(() => {
    localStorage.clear();
    document.title = "";
    document.documentElement.lang = "en";
  });

  it("normalizes browser locales into supported viewer locales", () => {
    expect(resolveViewerLocale("zh-CN")).toBe("zh");
    expect(resolveViewerLocale("ja-JP")).toBe("ja");
    expect(resolveViewerLocale("es-MX")).toBe("es");
    expect(resolveViewerLocale("fr-FR")).toBe("en");
  });

  it("prefers stored locale over browser locale", () => {
    localStorage.setItem(VIEWER_LOCALE_STORAGE_KEY, "es");

    expect(
      resolveViewerLocalePreference({
        languages: ["ja-JP", "en-US"],
        storageLocale: localStorage.getItem(VIEWER_LOCALE_STORAGE_KEY),
      }),
    ).toBe("es");
  });

  it("updates document metadata and persists locale changes", () => {
    render(
      <ViewerI18nProvider initialLocale="en">
        <LocaleProbe />
      </ViewerI18nProvider>,
    );

    expect(screen.getByText("Join Room")).toBeTruthy();
    expect(document.title).toBe("ScreenMate Viewer");
    expect(document.documentElement.lang).toBe("en");

    fireEvent.click(screen.getByRole("button", { name: "switch" }));

    expect(screen.getByText("加入房间")).toBeTruthy();
    expect(document.title).toBe("ScreenMate 观看端");
    expect(document.documentElement.lang).toBe("zh");
    expect(localStorage.getItem(VIEWER_LOCALE_STORAGE_KEY)).toBe("zh");
  });
});
