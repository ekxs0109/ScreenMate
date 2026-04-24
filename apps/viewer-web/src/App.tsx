import { useEffect, useRef, useState } from "react";
import { ViewerShell } from "./components/ViewerShell";
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
  const initialRoomId = getViewerRoomIdFromLocation();
  const [session, setSession] = useState<ViewerSessionState>(initialViewerSessionState);
  const [mock, setMock] = useState<ViewerMockState>(createViewerMockState);
  const [viewerSession] = useState(
    () =>
      new ViewerSession({
        apiBaseUrl: getViewerApiBaseUrl(),
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
    session,
    mock,
  });

  return (
    <ViewerShell
      scene={scene}
      stream={session.remoteStream}
      language={mock.language}
      onLanguageChange={(language) => setMock((current) => ({ ...current, language }))}
      onJoin={handleJoin}
      onLeaveRoom={() => {
        viewerSession.destroy();
        setSession(initialViewerSessionState);
        window.history.replaceState({}, "", "/");
      }}
      onJoinOtherRoom={() => {
        const newRoomId = window.prompt("Enter Room ID:");
        if (newRoomId) {
          void viewerSession.join(newRoomId);
          window.history.replaceState({}, "", `/rooms/${encodeURIComponent(newRoomId)}`);
        }
      }}
      onRandomizeUsername={() =>
        setMock((current) => ({
          ...current,
          username: `User_${Math.floor(Math.random() * 10000)}`,
        }))
      }
      onSendMessage={(text) =>
        setMock((current) => ({
          ...current,
          messages: [
            ...current.messages,
            {
              id: `local-${Date.now()}`,
              sender: "You",
              text,
              time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            },
          ],
        }))
      }
    />
  );
}
