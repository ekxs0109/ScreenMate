import { i18n } from "#i18n";

export type ExtensionDictionary = {
  appName: string;
  tabSource: string;
  tabRoom: string;
  tabChat: string;
  sourceSniff: string;
  sourceScreen: string;
  sourceUpload: string;
  detected: string;
  mockOrigin: string;
  refreshSniff: string;
  noVideo: string;
  captureTitle: string;
  captureDescription: string;
  captureButton: string;
  screenReady: string;
  screenReadyDescription: string;
  reselect: string;
  uploadDropzone: string;
  roomId: string;
  openRoom: string;
  passwordPlaceholder: string;
  save: string;
  saved: string;
  viewerList: string;
  viewerName: string;
  connType: string;
  connPing: string;
  notSharedYet: string;
  cancel: string;
  changeSource: string;
  generateShare: string;
  endShare: string;
  roomChat: string;
  chatPlaceholder: string;
  popout: string;
  themeLabel: string;
  themeLight: string;
  themeDark: string;
  themeSystem: string;
};

export function getExtensionDictionary(): ExtensionDictionary {
  return {
    appName: i18n.t("appName"),
    tabSource: i18n.t("tabSource"),
    tabRoom: i18n.t("tabRoom"),
    tabChat: i18n.t("tabChat"),
    sourceSniff: i18n.t("sourceSniff"),
    sourceScreen: i18n.t("sourceScreen"),
    sourceUpload: i18n.t("sourceUpload"),
    detected: i18n.t("detected"),
    mockOrigin: i18n.t("mockOrigin"),
    refreshSniff: i18n.t("refreshSniff"),
    noVideo: i18n.t("noVideo"),
    captureTitle: i18n.t("captureTitle"),
    captureDescription: i18n.t("captureDescription"),
    captureButton: i18n.t("captureButton"),
    screenReady: i18n.t("screenReady"),
    screenReadyDescription: i18n.t("screenReadyDescription"),
    reselect: i18n.t("reselect"),
    uploadDropzone: i18n.t("uploadDropzone"),
    roomId: i18n.t("roomId"),
    openRoom: i18n.t("openRoom"),
    passwordPlaceholder: i18n.t("passwordPlaceholder"),
    save: i18n.t("save"),
    saved: i18n.t("saved"),
    viewerList: i18n.t("viewerList"),
    viewerName: i18n.t("viewerName"),
    connType: i18n.t("connType"),
    connPing: i18n.t("connPing"),
    notSharedYet: i18n.t("notSharedYet"),
    cancel: i18n.t("cancel"),
    changeSource: i18n.t("changeSource"),
    generateShare: i18n.t("generateShare"),
    endShare: i18n.t("endShare"),
    roomChat: i18n.t("roomChat"),
    chatPlaceholder: i18n.t("chatPlaceholder"),
    popout: i18n.t("popout"),
    themeLabel: i18n.t("themeLabel"),
    themeLight: i18n.t("themeLight"),
    themeDark: i18n.t("themeDark"),
    themeSystem: i18n.t("themeSystem"),
  };
}
