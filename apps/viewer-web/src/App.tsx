import { useEffect, useRef, useState } from "react";
import { ViewerShell } from "./components/ViewerShell";
import {
  buildRandomViewerUsername,
  useViewerI18n,
} from "./i18n";
import {
  getViewerApiBaseUrl,
  getViewerRoomIdFromLocation,
} from "./lib/config";
import {
  initialViewerSessionState,
  type ViewerSessionState,
} from "./lib/session-state";
import { buildViewerSceneModel } from "./viewer-scene-adapter";
import { createViewerMockState, type ViewerMockState } from "./viewer-mock-state";
import { ViewerSession } from "./viewer-session";

export default function App() {
  const { copy, locale } = useViewerI18n();
  const initialRoomId = getViewerRoomIdFromLocation();
  const [displayName, setDisplayName] = useState(() =>
    buildRandomViewerUsername(locale),
  );
  const [session, setSession] = useState<ViewerSessionState>(initialViewerSessionState);
  const [mock, setMock] = useState<ViewerMockState>(() => ({
    ...createViewerMockState(locale),
    username: displayName,
  }));
  const [viewerSession] = useState(
    () =>
      new ViewerSession({
        apiBaseUrl: getViewerApiBaseUrl(),
        initialDisplayName: displayName,
      }),
  );
  const autoJoinedRoomIdRef = useRef<string | null>(null);

  useEffect(() => {
    const unsubscribe = viewerSession.subscribe(setSession);

    return () => {
      unsubscribe();
      viewerSession.destroy();
    };
  }, [viewerSession]);

  useEffect(() => {
    if (
      !initialRoomId ||
      autoJoinedRoomIdRef.current === initialRoomId
    ) {
      return;
    }

    autoJoinedRoomIdRef.current = initialRoomId;
    void viewerSession.join(initialRoomId);
  }, [initialRoomId, viewerSession]);

  async function handleJoin(roomCode: string) {
    await viewerSession.join(roomCode);
  }

  const scene = buildViewerSceneModel({
    locale,
    session,
    mock,
  });

  return (
    <ViewerShell
      scene={scene}
      stream={session.remoteStream}
      onJoin={handleJoin}
      onLeaveRoom={() => {
        viewerSession.destroy();
        setSession(initialViewerSessionState);
        window.history.replaceState({}, "", "/");
      }}
      onJoinOtherRoom={() => {
        const newRoomId = window.prompt(copy.enterRoomIdPrompt);
        if (newRoomId) {
          void viewerSession.join(newRoomId);
          window.history.replaceState({}, "", `/rooms/${encodeURIComponent(newRoomId)}`);
        }
      }}
      onRandomizeUsername={() => {
        const nextDisplayName = buildRandomViewerUsername(locale);
        setDisplayName(nextDisplayName);
        viewerSession.updateDisplayName(nextDisplayName);
        setMock((current) => ({
          ...current,
          username: nextDisplayName,
        }));
      }}
      onDisplayNameChange={(nextName) => {
        const nextDisplayName = nextName.trim();

        if (!nextDisplayName) {
          return;
        }

        setDisplayName(nextDisplayName);
        viewerSession.updateDisplayName(nextDisplayName);
        setMock((current) => ({
          ...current,
          username: nextDisplayName,
        }));
      }}
      onSendMessage={(text) => {
        return viewerSession.sendChatMessage(text);
      }}
    />
  );
}
