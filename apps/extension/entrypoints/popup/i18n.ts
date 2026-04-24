import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

export const extensionLocales = ["zh", "en", "ja", "es"] as const;
export const extensionLanguagePreferences = ["system", ...extensionLocales] as const;

export type ExtensionLocale = (typeof extensionLocales)[number];
export type ExtensionLanguagePreference =
  (typeof extensionLanguagePreferences)[number];

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
  languageLabel: string;
  systemLabel: string;
  popout: string;
  themeLabel: string;
  themeLight: string;
  themeDark: string;
  themeSystem: string;
};

const dictionaries: Record<ExtensionLocale, ExtensionDictionary> = {
  zh: {
    appName: "SyncPlay",
    tabSource: "资源选择",
    tabRoom: "房间设置",
    tabChat: "房间群聊",
    sourceSniff: "页面嗅探",
    sourceScreen: "屏幕共享",
    sourceUpload: "本地上传",
    detected: "嗅探到的网页资源",
    mockOrigin: "当前标签",
    refreshSniff: "重新嗅探",
    noVideo: "未检测到视频",
    captureTitle: "捕获屏幕或窗口",
    captureDescription: "支持共享单个网页标签、应用软件或整个桌面",
    captureButton: "选择共享内容",
    screenReady: "屏幕已就绪",
    screenReadyDescription: "内容捕获成功，请点击底部按钮开启共享房间。",
    reselect: "重选",
    uploadDropzone: "点击或拖拽视频文件",
    roomId: "房间号",
    openRoom: "进入房间",
    passwordPlaceholder: "留空则无密码",
    save: "保存",
    saved: "已保存",
    viewerList: "观众连接状态",
    viewerName: "名称",
    connType: "连接方式",
    connPing: "质量",
    notSharedYet: "暂未分享视频",
    cancel: "取消",
    changeSource: "更换当前资源",
    generateShare: "创建同步房间",
    endShare: "结束分享",
    roomChat: "房间群聊",
    chatPlaceholder: "发点什么...",
    languageLabel: "语言",
    systemLabel: "跟随系统",
    popout: "弹出窗口",
    themeLabel: "主题",
    themeLight: "浅色",
    themeDark: "深色",
    themeSystem: "跟随系统",
  },
  en: {
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
    languageLabel: "Language",
    systemLabel: "System",
    popout: "Pop Out",
    themeLabel: "Theme",
    themeLight: "Light",
    themeDark: "Dark",
    themeSystem: "System",
  },
  ja: {
    appName: "SyncPlay",
    tabSource: "メディア元",
    tabRoom: "ルーム設定",
    tabChat: "チャット",
    sourceSniff: "スニッファー",
    sourceScreen: "画面共有",
    sourceUpload: "ファイルアップロード",
    detected: "検出されたメディア",
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
    cancel: "キャンセル",
    changeSource: "ソースを変更",
    generateShare: "ルームを作成",
    endShare: "共有を終了",
    roomChat: "チャット",
    chatPlaceholder: "メッセージ...",
    languageLabel: "言語",
    systemLabel: "システム",
    popout: "ポップアウト",
    themeLabel: "テーマ",
    themeLight: "ライト",
    themeDark: "ダーク",
    themeSystem: "システム",
  },
  es: {
    appName: "SyncPlay",
    tabSource: "Orígenes",
    tabRoom: "Sala Ajustes",
    tabChat: "Chat",
    sourceSniff: "Reconocer",
    sourceScreen: "Compartir Pantalla",
    sourceUpload: "Subir Archivo",
    detected: "Medios detectados",
    mockOrigin: "Pestaña",
    refreshSniff: "Refrescar",
    noVideo: "No se detectó video en esta página.",
    captureTitle: "Capturar pantalla o ventana",
    captureDescription: "Comparte una pestaña, una ventana de app o todo el escritorio.",
    captureButton: "Seleccionar contenido",
    screenReady: "Pantalla lista",
    screenReadyDescription: "Fuente capturada. Haz clic abajo para iniciar la sala.",
    reselect: "Volver a elegir",
    uploadDropzone: "Haz clic o arrastra archivos de video",
    roomId: "ID Sala",
    openRoom: "Entrar",
    passwordPlaceholder: "Dejar en blanco para sin contraseña",
    save: "Guardar",
    saved: "Guardado",
    viewerList: "Conexiones de Espectadores",
    viewerName: "Nombre",
    connType: "Método",
    connPing: "Ping",
    notSharedYet: "No compartido",
    cancel: "Cancelar",
    changeSource: "Cambiar Fuente",
    generateShare: "Crear Sala",
    endShare: "Finalizar",
    roomChat: "Chat",
    chatPlaceholder: "Di algo...",
    languageLabel: "Idioma",
    systemLabel: "Sistema",
    popout: "Ventana",
    themeLabel: "Tema",
    themeLight: "Claro",
    themeDark: "Oscuro",
    themeSystem: "Sistema",
  },
};

const LANGUAGE_STORAGE_KEY = "screenmate-extension-locale";
const FALLBACK_LOCALE: ExtensionLocale = "en";

function isExtensionLocale(language: string): language is ExtensionLocale {
  return (extensionLocales as readonly string[]).includes(language);
}

function getNavigatorLanguage(): string | undefined {
  return typeof navigator === "undefined" ? undefined : navigator.language;
}

export function normalizeExtensionLocale(language: string | undefined | null): ExtensionLocale {
  if (!language) {
    return FALLBACK_LOCALE;
  }

  const baseLanguage = language.toLowerCase().split("-")[0];
  return isExtensionLocale(baseLanguage) ? baseLanguage : FALLBACK_LOCALE;
}

export function getExtensionDictionary(language: string): ExtensionDictionary {
  return dictionaries[normalizeExtensionLocale(language)];
}

export function getExtensionLanguagePreference(): ExtensionLanguagePreference {
  if (typeof window === "undefined") {
    return "system";
  }

  const storedLanguage = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (storedLanguage && isExtensionLocale(storedLanguage)) {
    return storedLanguage;
  }

  return "system";
}

export function persistExtensionLanguagePreference(
  preference: ExtensionLanguagePreference,
) {
  if (typeof window === "undefined") {
    return;
  }

  if (preference === "system") {
    window.localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, preference);
}

export function resolveExtensionLanguagePreference(
  preference: ExtensionLanguagePreference,
  browserLanguage = getNavigatorLanguage(),
): ExtensionLocale {
  return preference === "system"
    ? normalizeExtensionLocale(browserLanguage)
    : preference;
}

if (!i18n.isInitialized) {
  const languageDetector = new LanguageDetector();

  languageDetector.init(
    {
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      order: ["localStorage", "navigator"],
      caches: [],
    },
    {},
  );

  void i18n
    .use(languageDetector)
    .use(initReactI18next)
    .init({
      resources: Object.fromEntries(
        extensionLocales.map((locale) => [
          locale,
          { translation: dictionaries[locale] },
        ]),
      ),
      fallbackLng: FALLBACK_LOCALE,
      supportedLngs: [...extensionLocales],
      load: "languageOnly",
      nonExplicitSupportedLngs: true,
      interpolation: {
        escapeValue: false,
      },
      react: {
        useSuspense: false,
      },
    });
}

export default i18n;
