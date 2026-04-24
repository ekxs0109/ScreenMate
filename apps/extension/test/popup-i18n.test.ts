// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  getExtensionDictionary,
  getExtensionLanguagePreference,
  normalizeExtensionLocale,
  persistExtensionLanguagePreference,
  resolveExtensionLanguagePreference,
} from "../entrypoints/popup/i18n";

describe("popup i18n", () => {
  it("normalizes browser locales to supported languages", () => {
    expect(normalizeExtensionLocale("zh-CN")).toBe("zh");
    expect(normalizeExtensionLocale("ja-JP")).toBe("ja");
    expect(normalizeExtensionLocale("fr-FR")).toBe("en");
  });

  it("returns localized copy for normalized languages", () => {
    expect(getExtensionDictionary("es-MX").languageLabel).toBe("Idioma");
    expect(getExtensionDictionary("unknown").languageLabel).toBe("Language");
  });

  it("treats the missing locale preference as system", () => {
    window.localStorage.clear();

    expect(getExtensionLanguagePreference()).toBe("system");
    expect(resolveExtensionLanguagePreference("system", "ja-JP")).toBe("ja");
  });

  it("persists explicit locale choices and clears them for system mode", () => {
    persistExtensionLanguagePreference("es");
    expect(getExtensionLanguagePreference()).toBe("es");

    persistExtensionLanguagePreference("system");
    expect(getExtensionLanguagePreference()).toBe("system");
  });
});
