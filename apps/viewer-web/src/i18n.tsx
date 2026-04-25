import { createInstance, type TFunction, type i18n as I18nInstance } from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import {
  I18nextProvider,
  initReactI18next,
  useTranslation,
} from "react-i18next";
import {
  startTransition,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { ViewerErrorCode } from "./viewer-errors";

export const viewerLocales = ["zh", "en", "ja", "es"] as const;
export type ViewerLocale = (typeof viewerLocales)[number];

export const VIEWER_LOCALE_STORAGE_KEY = "screenmate.viewer.locale";

const viewerMessages = {
  zh: {
    documentTitle: "ScreenMate 观看端",
    joinRoomTitle: "加入房间",
    joinRoomDescription: "输入房主分享给你的房间号。",
    roomCodeLabel: "房间号",
    joinRoomAction: "加入房间",
    joiningAction: "正在加入...",
    syncStatus: "同步状态",
    liveBadge: "直播",
    joinOtherRoom: "加入其他房间",
    leaveRoom: "离开",
    connectionLabel: "连接",
    pingLabel: "延迟",
    nameLabel: "名称",
    randomizeName: "随机",
    messagePlaceholder: "发送消息...",
    waitingForHostReconnect: "等待房主重新连接",
    waitingForHost: "等待房主",
    viewingCount: "{{count}} 人观看",
    roomLabel: "房间",
    waitingRoomId: "等待中...",
    hostEndedRoom: "房主已结束房间",
    hostReconnectingVideoSource: "房主正在重新连接视频源",
    waitingForVideoSource: "等待视频源...",
    connectedToHost: "已连接到房主",
    waitingForVideoStream: "等待视频流",
    clickToUnmute: "点击开启声音",
    languageLabel: "语言",
    themeLight: "浅色",
    themeDark: "深色",
    themeSystem: "跟随系统",
    toggleTheme: "切换主题",
    enterRoomIdPrompt: "输入房间号：",
    connectionTypeDirectP2P: "直连 (P2P)",
    hostStartedRoom: "房主已开启房间",
    senderHost: "房主",
    senderSystem: "系统",
    senderYou: "你",
    usernamePrefix: "用户",
    roomNotFound: "这个房间号当前不可用。",
    roomExpired: "这个房间已过期。",
    roomAlreadyClosed: "房主已经结束了这个房间。",
    roomConnectionClosed: "房间连接已关闭。",
    signalingFailed: "信令连接失败。",
    directConnectivityFailed: "你的网络无法建立直连 WebRTC 连接。",
    negotiationFailed: "点对点协商失败。",
    joinFailed: "无法加入这个房间。",
  },
  en: {
    documentTitle: "ScreenMate Viewer",
    joinRoomTitle: "Join Room",
    joinRoomDescription: "Enter the room code shared by the host.",
    roomCodeLabel: "Room code",
    joinRoomAction: "Join room",
    joiningAction: "Joining...",
    syncStatus: "Sync Status",
    liveBadge: "Live",
    joinOtherRoom: "Join Other",
    leaveRoom: "Leave",
    connectionLabel: "Conn",
    pingLabel: "Ping",
    nameLabel: "Name",
    randomizeName: "Randomize",
    messagePlaceholder: "Send a message...",
    waitingForHostReconnect: "Waiting for host reconnect",
    waitingForHost: "Waiting for host",
    viewingCount: "{{count}} viewing",
    roomLabel: "Room",
    waitingRoomId: "Waiting...",
    hostEndedRoom: "Host ended the room",
    hostReconnectingVideoSource: "Host is reconnecting the video source",
    waitingForVideoSource: "Waiting for video source...",
    connectedToHost: "Connected to host",
    waitingForVideoStream: "Waiting for video stream",
    clickToUnmute: "Click to unmute",
    languageLabel: "Language",
    themeLight: "Light",
    themeDark: "Dark",
    themeSystem: "System",
    toggleTheme: "Toggle theme",
    enterRoomIdPrompt: "Enter Room ID:",
    connectionTypeDirectP2P: "Direct (P2P)",
    hostStartedRoom: "Host started the room",
    senderHost: "Host",
    senderSystem: "System",
    senderYou: "You",
    usernamePrefix: "User",
    roomNotFound: "That room code is not active.",
    roomExpired: "That room has expired.",
    roomAlreadyClosed: "The host has already ended this room.",
    roomConnectionClosed: "The room connection closed.",
    signalingFailed: "The signaling connection failed.",
    directConnectivityFailed:
      "Your network could not establish a direct WebRTC connection.",
    negotiationFailed: "Peer negotiation failed.",
    joinFailed: "We couldn't join that room.",
  },
  ja: {
    documentTitle: "ScreenMate 視聴ページ",
    joinRoomTitle: "ルームに参加",
    joinRoomDescription: "ホストから共有されたルームコードを入力してください。",
    roomCodeLabel: "ルームコード",
    joinRoomAction: "ルームに参加",
    joiningAction: "参加中...",
    syncStatus: "同期ステータス",
    liveBadge: "ライブ",
    joinOtherRoom: "別のルームに参加",
    leaveRoom: "退出",
    connectionLabel: "接続",
    pingLabel: "Ping",
    nameLabel: "名前",
    randomizeName: "ランダム",
    messagePlaceholder: "メッセージを送信...",
    waitingForHostReconnect: "ホストの再接続を待っています",
    waitingForHost: "ホストを待っています",
    viewingCount: "{{count}} 人が視聴中",
    roomLabel: "ルーム",
    waitingRoomId: "待機中...",
    hostEndedRoom: "ホストがルームを終了しました",
    hostReconnectingVideoSource: "ホストが映像ソースを再接続しています",
    waitingForVideoSource: "映像ソースを待っています...",
    connectedToHost: "ホストに接続しました",
    waitingForVideoStream: "映像ストリームを待っています",
    clickToUnmute: "クリックしてミュート解除",
    languageLabel: "言語",
    themeLight: "ライト",
    themeDark: "ダーク",
    themeSystem: "システム",
    toggleTheme: "テーマを切り替え",
    enterRoomIdPrompt: "ルーム ID を入力してください:",
    connectionTypeDirectP2P: "直接接続 (P2P)",
    hostStartedRoom: "ホストがルームを開始しました",
    senderHost: "ホスト",
    senderSystem: "システム",
    senderYou: "あなた",
    usernamePrefix: "ユーザー",
    roomNotFound: "そのルームコードは現在利用できません。",
    roomExpired: "そのルームは期限切れです。",
    roomAlreadyClosed: "ホストはすでにこのルームを終了しています。",
    roomConnectionClosed: "ルーム接続が切断されました。",
    signalingFailed: "シグナリング接続に失敗しました。",
    directConnectivityFailed:
      "ネットワークの都合で WebRTC の直接接続を確立できませんでした。",
    negotiationFailed: "ピア接続のネゴシエーションに失敗しました。",
    joinFailed: "そのルームに参加できませんでした。",
  },
  es: {
    documentTitle: "ScreenMate Viewer",
    joinRoomTitle: "Unirse a la sala",
    joinRoomDescription: "Introduce el codigo de sala compartido por el anfitrion.",
    roomCodeLabel: "Codigo de sala",
    joinRoomAction: "Unirse a la sala",
    joiningAction: "Uniendo...",
    syncStatus: "Estado de sincronizacion",
    liveBadge: "En vivo",
    joinOtherRoom: "Unirse a otra",
    leaveRoom: "Salir",
    connectionLabel: "Conexion",
    pingLabel: "Ping",
    nameLabel: "Nombre",
    randomizeName: "Aleatorio",
    messagePlaceholder: "Enviar un mensaje...",
    waitingForHostReconnect: "Esperando la reconexion del anfitrion",
    waitingForHost: "Esperando al anfitrion",
    viewingCount: "{{count}} viendo",
    roomLabel: "Sala",
    waitingRoomId: "Esperando...",
    hostEndedRoom: "El anfitrion termino la sala",
    hostReconnectingVideoSource:
      "El anfitrión está reconectando la fuente de video",
    waitingForVideoSource: "Esperando la fuente de video...",
    connectedToHost: "Conectado al anfitrion",
    waitingForVideoStream: "Esperando la transmision de video",
    clickToUnmute: "Haz clic para activar el sonido",
    languageLabel: "Idioma",
    themeLight: "Claro",
    themeDark: "Oscuro",
    themeSystem: "Sistema",
    toggleTheme: "Cambiar tema",
    enterRoomIdPrompt: "Introduce el ID de sala:",
    connectionTypeDirectP2P: "Directa (P2P)",
    hostStartedRoom: "El anfitrion inicio la sala",
    senderHost: "Anfitrion",
    senderSystem: "Sistema",
    senderYou: "Tu",
    usernamePrefix: "Usuario",
    roomNotFound: "Ese codigo de sala no esta activo.",
    roomExpired: "Esa sala ha expirado.",
    roomAlreadyClosed: "El anfitrion ya termino esta sala.",
    roomConnectionClosed: "La conexion de la sala se cerro.",
    signalingFailed: "La conexion de senalizacion fallo.",
    directConnectivityFailed:
      "Tu red no pudo establecer una conexion WebRTC directa.",
    negotiationFailed: "La negociacion entre pares fallo.",
    joinFailed: "No pudimos unirnos a esa sala.",
  },
} as const;

type ViewerTranslationKey = keyof typeof viewerMessages.en;
type ViewerDictionary = {
  [K in Exclude<ViewerTranslationKey, "viewingCount">]: string;
} & {
  viewingCount: (count: number) => string;
};

type ViewerStringKey = Exclude<ViewerTranslationKey, "viewingCount">;

const localeTags: Record<ViewerLocale, string> = {
  zh: "zh-CN",
  en: "en-US",
  ja: "ja-JP",
  es: "es-ES",
};

function createViewerI18n(initialLocale?: ViewerLocale) {
  const instance = createInstance();

  instance
    .use(LanguageDetector)
    .use(initReactI18next);

  void instance.init({
    fallbackLng: "en",
    interpolation: {
      escapeValue: false,
    },
    load: "languageOnly",
    lng: initialLocale,
    nonExplicitSupportedLngs: true,
    react: {
      useSuspense: false,
    },
    resources: Object.fromEntries(
      viewerLocales.map((locale) => [
        locale,
        {
          translation: viewerMessages[locale],
        },
      ]),
    ),
    supportedLngs: [...viewerLocales],
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: VIEWER_LOCALE_STORAGE_KEY,
      caches: ["localStorage"],
    },
  });

  return instance;
}

function interpolateMessage(
  template: string,
  options?: Record<string, unknown>,
) {
  let output = template;

  for (const [optionKey, optionValue] of Object.entries(options ?? {})) {
    output = output.replaceAll(`{{${optionKey}}}`, String(optionValue));
  }

  return output;
}

function buildViewerDictionary(
  locale: ViewerLocale,
  instance?: I18nInstance,
): ViewerDictionary {
  const translate = (key: ViewerTranslationKey, options?: Record<string, unknown>) => {
    if (instance) {
      return String(
        instance.getFixedT(locale)(key, options) as ReturnType<TFunction>,
      );
    }

    return interpolateMessage(viewerMessages[locale][key], options);
  };

  return {
    documentTitle: translate("documentTitle"),
    joinRoomTitle: translate("joinRoomTitle"),
    joinRoomDescription: translate("joinRoomDescription"),
    roomCodeLabel: translate("roomCodeLabel"),
    joinRoomAction: translate("joinRoomAction"),
    joiningAction: translate("joiningAction"),
    syncStatus: translate("syncStatus"),
    liveBadge: translate("liveBadge"),
    joinOtherRoom: translate("joinOtherRoom"),
    leaveRoom: translate("leaveRoom"),
    connectionLabel: translate("connectionLabel"),
    pingLabel: translate("pingLabel"),
    nameLabel: translate("nameLabel"),
    randomizeName: translate("randomizeName"),
    messagePlaceholder: translate("messagePlaceholder"),
    waitingForHostReconnect: translate("waitingForHostReconnect"),
    waitingForHost: translate("waitingForHost"),
    viewingCount: (count) => translate("viewingCount", { count }),
    roomLabel: translate("roomLabel"),
    waitingRoomId: translate("waitingRoomId"),
    hostEndedRoom: translate("hostEndedRoom"),
    hostReconnectingVideoSource: translate("hostReconnectingVideoSource"),
    waitingForVideoSource: translate("waitingForVideoSource"),
    connectedToHost: translate("connectedToHost"),
    waitingForVideoStream: translate("waitingForVideoStream"),
    clickToUnmute: translate("clickToUnmute"),
    languageLabel: translate("languageLabel"),
    themeLight: translate("themeLight"),
    themeDark: translate("themeDark"),
    themeSystem: translate("themeSystem"),
    toggleTheme: translate("toggleTheme"),
    enterRoomIdPrompt: translate("enterRoomIdPrompt"),
    connectionTypeDirectP2P: translate("connectionTypeDirectP2P"),
    hostStartedRoom: translate("hostStartedRoom"),
    senderHost: translate("senderHost"),
    senderSystem: translate("senderSystem"),
    senderYou: translate("senderYou"),
    usernamePrefix: translate("usernamePrefix"),
    roomNotFound: translate("roomNotFound"),
    roomExpired: translate("roomExpired"),
    roomAlreadyClosed: translate("roomAlreadyClosed"),
    roomConnectionClosed: translate("roomConnectionClosed"),
    signalingFailed: translate("signalingFailed"),
    directConnectivityFailed: translate("directConnectivityFailed"),
    negotiationFailed: translate("negotiationFailed"),
    joinFailed: translate("joinFailed"),
  };
}

export function resolveViewerLocale(locale: string | null | undefined): ViewerLocale {
  const normalized = String(locale || "").toLowerCase();

  if (normalized.startsWith("zh")) {
    return "zh";
  }
  if (normalized.startsWith("ja")) {
    return "ja";
  }
  if (normalized.startsWith("es")) {
    return "es";
  }

  return "en";
}

export function resolveViewerLocalePreference(input?: {
  languages?: string[];
  storageLocale?: string | null;
}): ViewerLocale {
  const stored = input?.storageLocale;
  if (stored && viewerLocales.includes(stored as ViewerLocale)) {
    return stored as ViewerLocale;
  }

  for (const language of input?.languages ?? []) {
    const normalized = String(language || "").toLowerCase();
    if (
      normalized.startsWith("zh") ||
      normalized.startsWith("ja") ||
      normalized.startsWith("es") ||
      normalized.startsWith("en")
    ) {
      return resolveViewerLocale(language);
    }
  }

  return "en";
}

export function getViewerDictionary(locale: ViewerLocale): ViewerDictionary {
  return buildViewerDictionary(locale);
}

export function formatViewerTime(
  timestamp: number,
  locale: ViewerLocale,
): string {
  return new Intl.DateTimeFormat(localeTags[locale], {
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

export function buildRandomViewerUsername(locale: ViewerLocale): string {
  return `${getViewerDictionary(locale).usernamePrefix}_${Math.floor(Math.random() * 10000)}`;
}

export function translateViewerError(
  code: ViewerErrorCode | null,
  locale: ViewerLocale,
): string | null {
  if (!code) {
    return null;
  }

  const copy = getViewerDictionary(locale);

  switch (code) {
    case "ROOM_NOT_FOUND":
      return copy.roomNotFound;
    case "ROOM_EXPIRED":
      return copy.roomExpired;
    case "ROOM_ALREADY_CLOSED":
    case "HOST_ENDED_ROOM":
      return copy.roomAlreadyClosed;
    case "ROOM_CONNECTION_CLOSED":
      return copy.roomConnectionClosed;
    case "SIGNALING_FAILED":
      return copy.signalingFailed;
    case "DIRECT_CONNECTIVITY_FAILED":
      return copy.directConnectivityFailed;
    case "NEGOTIATION_FAILED":
      return copy.negotiationFailed;
    case "ROOM_JOIN_FAILED":
    case "ROOM_STATE_FAILED":
    default:
      return copy.joinFailed;
  }
}

export function ViewerI18nProvider({
  children,
  initialLocale,
}: {
  children: ReactNode;
  initialLocale?: ViewerLocale;
}) {
  const [instance] = useState(() => createViewerI18n(initialLocale));

  useEffect(() => {
    if (!initialLocale) {
      return;
    }

    void instance.changeLanguage(initialLocale);
  }, [initialLocale, instance]);

  useEffect(() => {
    const syncDocument = () => {
      const locale = resolveViewerLocale(instance.resolvedLanguage);
      const copy = buildViewerDictionary(locale, instance);

      document.title = copy.documentTitle;
      document.documentElement.lang = locale;
    };

    syncDocument();
    instance.on("languageChanged", syncDocument);

    return () => {
      instance.off("languageChanged", syncDocument);
    };
  }, [instance]);

  return <I18nextProvider i18n={instance}>{children}</I18nextProvider>;
}

export function useViewerI18n() {
  const { i18n, t } = useTranslation();
  const locale = resolveViewerLocale(i18n.resolvedLanguage);
  const copy = buildViewerDictionary(locale, i18n);

  return {
    locale,
    copy,
    setLocale: (nextLocale: ViewerLocale) => {
      startTransition(() => {
        void i18n.changeLanguage(nextLocale);
      });
    },
    t: <K extends ViewerStringKey>(key: K) => String(t(key)),
  };
}
