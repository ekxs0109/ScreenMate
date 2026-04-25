import type { ViewerSessionState } from "./lib/session-state";
import {
  formatViewerTime,
  getViewerDictionary,
  translateViewerError,
  type ViewerLocale,
} from "./i18n";
import type { ViewerMockState } from "./viewer-mock-state";
import type { ViewerSceneModel } from "./viewer-scene-model";

export function buildViewerSceneModel(input: {
  locale: ViewerLocale;
  session: ViewerSessionState;
  mock: ViewerMockState;
}): ViewerSceneModel {
  const copy = getViewerDictionary(input.locale);
  const joined = input.session.status !== "idle";
  const waitingText =
    input.session.roomState === "closed"
      ? copy.hostEndedRoom
      : input.session.sourceState === "recovering"
        ? copy.waitingForHostReconnect
        : copy.waitingForHost;

  return {
    header: {
      title: "ScreenMate",
      live: input.session.status === "connected" || input.session.status === "waiting",
      roomId: input.session.roomId,
      statusText: input.session.status,
    },
    connection: {
      typeLabel: copy.connectionTypeDirectP2P,
      pingLabel: `${input.mock.pingMs}ms`,
    },
    sidebar: {
      viewerCount:
        input.session.roomId !== null
          ? Math.max(input.mock.viewerCount, 1)
          : input.mock.viewerCount,
      username: input.mock.username,
      messages: input.mock.messages.map((message) => ({
        id: message.id,
        senderKind: message.senderKind,
        sender:
          message.senderKind === "host"
            ? copy.senderHost
            : message.senderKind === "system"
              ? copy.senderSystem
              : message.senderKind === "self"
                ? copy.senderYou
                : message.senderName ?? "",
        text:
          message.textKey === "hostStartedRoom"
            ? copy.hostStartedRoom
            : message.text ?? "",
        time: formatViewerTime(message.timestamp, input.locale),
      })),
    },
    player: {
      showWaitingOverlay: input.session.remoteStream === null,
      waitingText,
      showJoinOverlay:
        input.session.status === "idle" ||
        input.session.status === "error" ||
        input.session.status === "ended",
      joinBusy: input.session.status === "joining",
      joined,
    },
    notices: {
      error: translateViewerError(input.session.errorCode, input.locale),
      endedReason: translateViewerError(input.session.endedReasonCode, input.locale),
    },
  };
}
