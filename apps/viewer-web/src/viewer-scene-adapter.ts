import type { ViewerSessionState } from "./lib/session-state";
import type { ViewerMockState } from "./viewer-mock-state";
import type { ViewerSceneModel } from "./viewer-scene-model";

export function buildViewerSceneModel(input: {
  session: ViewerSessionState;
  mock: ViewerMockState;
}): ViewerSceneModel {
  const joined = input.session.status !== "idle";
  const waitingText =
    input.session.roomState === "closed"
      ? "Host ended the room"
      : input.session.sourceState === "recovering"
        ? "Waiting for host reconnect"
        : "Waiting for host";

  return {
    header: {
      title: "ScreenMate",
      live: input.session.status === "connected" || input.session.status === "waiting",
      roomId: input.session.roomId,
      statusText: input.session.status,
    },
    connection: {
      typeLabel: input.mock.connectionType,
      pingLabel: input.mock.pingLabel,
    },
    sidebar: {
      viewerCount:
        input.session.roomId !== null
          ? Math.max(input.mock.viewerCount, 1)
          : input.mock.viewerCount,
      username: input.mock.username,
      messages: input.mock.messages,
    },
    player: {
      showWaitingOverlay: input.session.remoteStream === null,
      waitingText,
      showJoinOverlay: input.session.status === "idle",
      joinBusy: input.session.status === "joining",
      joined,
    },
    notices: {
      error: input.session.error,
      endedReason: input.session.endedReason,
    },
  };
}
