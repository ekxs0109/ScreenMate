// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

const messages = {
  appName: "SyncPlay JP",
  tabSource: "メディア元",
  tabRoom: "ルーム設定",
  tabChat: "チャット",
  sourceSniff: "スニッファー",
  sourceScreen: "画面共有",
  sourceUpload: "ファイルアップロード",
  detected: "検出されたメディア",
  followAuto: "自動",
  followAutoDescription: "ホストが見ているタブを追従",
  currentPlayback: "再生中",
  waitingPlayback: "動画待機中",
  webVideoStream: "Web 動画ストリーム",
  autoMode: "自動追従",
  manualMode: "手動選択",
  autoFollowEmptyTitle: "自動追従がオンです",
  autoFollowEmptyDescription: "ホストのアクティブなタブを追従します。",
  mockOrigin: "タブ",
  refreshSniff: "再スキャン",
  noVideo: "このページで動画が見つかりません。",
  captureTitle: "画面 / ウィンドウをキャプチャ",
  captureDescription: "特定のタブ、アプリウィンドウ、またはデスクトップ全体を共有します",
  captureButton: "共有コンテンツを選択",
  screenReady: "画面準備完了",
  screenReadyDescription: "キャプチャ成功。下のボタンをクリックして共有を開始します。",
  reselect: "再選択",
  uploadDropzone: "クリックまたはドラッグしてアップロード",
  roomId: "ルーム ID",
  openRoom: "開く",
  passwordPlaceholder: "パスワードなし(空白)",
  save: "保存",
  saved: "保存済み",
  viewerList: "視聴者の接続状態",
  viewerName: "名前",
  connType: "接続タイプ",
  connPing: "Ping",
  notSharedYet: "まだ共有されていません",
  noViewers: "視聴者はまだいません",
  cancel: "キャンセル",
  changeSource: "ソースを変更",
  generateShare: "ルームを作成",
  endShare: "共有を終了",
  roomChat: "チャット",
  chatPlaceholder: "メッセージ...",
  popout: "ポップアウト",
  themeLabel: "テーマ",
  themeLight: "ライト",
  themeDark: "ダーク",
  themeSystem: "システム",
  sourceShareBrowserTab: "タブ共有",
  sourceShareScreen: "画面共有",
  sourceShareWindow: "ウィンドウ共有",
};

vi.mock("#i18n", () => ({
  i18n: {
    t: (key: keyof typeof messages) => messages[key] ?? `missing:${key}`,
  },
}));

import * as popupI18n from "../../entrypoints/popup/i18n";

describe("popup i18n", () => {
  it("only exposes the WXT-backed dictionary adapter", () => {
    expect(popupI18n).not.toHaveProperty("extensionLocales");
    expect(popupI18n).not.toHaveProperty("normalizeExtensionLocale");
  });

  it("returns presenter copy from WXT i18n", () => {
    const copy = popupI18n.getExtensionDictionary();

    expect(copy.appName).toBe("SyncPlay JP");
    expect(copy.tabSource).toBe("メディア元");
    expect(copy.themeSystem).toBe("システム");
    expect(copy.noViewers).toBe("視聴者はまだいません");
    expect(copy.sourceShareBrowserTab).toBe("タブ共有");
    expect("languageLabel" in copy).toBe(false);
    expect("systemLabel" in copy).toBe(false);
  });
});
