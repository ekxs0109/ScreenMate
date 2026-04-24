// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

const messages = {
  appName: "SyncPlay",
  tabSource: "Source",
  tabRoom: "Room Settings",
  tabChat: "Room Chat",
  sourceSniff: "Site Sniffer",
  sourceScreen: "Screen Share",
  sourceUpload: "Local Upload",
  detected: "Detected Video Resources",
  mockOrigin: "Tab",
  refreshSniff: "Rescan",
  noVideo: "No video detected on this page.",
  captureTitle: "Capture Screen/Window",
  captureDescription: "Share a specific tab, app window, or entire desktop.",
  captureButton: "Select Content",
  screenReady: "Screen Ready",
  screenReadyDescription: "Source captured. Click the button below to start sharing.",
  reselect: "Reselect",
  uploadDropzone: "Click or drag video files",
  roomId: "Room ID",
  openRoom: "Open Room",
  passwordPlaceholder: "Leave blank for none",
  save: "Save",
  saved: "Saved",
  viewerList: "Viewer Connection Status",
  viewerName: "Name",
  connType: "Method",
  connPing: "Ping",
  notSharedYet: "No video shared yet",
  cancel: "Cancel",
  changeSource: "Change Source",
  generateShare: "Start Sync Room",
  endShare: "End Share",
  roomChat: "Room Chat",
  chatPlaceholder: "Say something...",
  popout: "Pop Out",
  themeLabel: "Theme",
  themeLight: "Light",
  themeDark: "Dark",
  themeSystem: "System",
};

vi.mock("#i18n", () => ({
  i18n: {
    t: (key: keyof typeof messages) => messages[key] ?? `missing:${key}`,
  },
}));

import {
  extensionLocales,
  getExtensionDictionary,
  normalizeExtensionLocale,
} from "../../entrypoints/popup/i18n";

describe("popup i18n", () => {
  it("normalizes browser locales to supported languages", () => {
    expect(normalizeExtensionLocale("zh-CN")).toBe("zh");
    expect(normalizeExtensionLocale("ja-JP")).toBe("ja");
    expect(normalizeExtensionLocale("fr-FR")).toBe("en");
  });

  it("lists supported WXT locale source files", () => {
    expect(extensionLocales).toEqual(["zh", "en", "ja", "es"]);
  });

  it("returns presenter copy from WXT i18n", () => {
    const copy = getExtensionDictionary();

    expect(copy.appName).toBe("SyncPlay");
    expect(copy.tabSource).toBe("Source");
    expect(copy.themeSystem).toBe("System");
    expect("languageLabel" in copy).toBe(false);
    expect("systemLabel" in copy).toBe(false);
  });
});
