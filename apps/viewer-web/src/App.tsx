import { useEffect, useRef, useState } from "react";
import { JoinForm } from "./components/JoinForm";
import { ViewerPlayer } from "./components/ViewerPlayer";
import {
  getViewerApiBaseUrl,
  getViewerRoomIdFromLocation,
} from "./lib/config";
import {
  initialViewerSessionState,
  type ViewerSessionState,
} from "./lib/session-state";
import { ViewerSession } from "./viewer-session";

export default function App() {
  const initialRoomId = getViewerRoomIdFromLocation();
  const [session, setSession] = useState<ViewerSessionState>(initialViewerSessionState);
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

  return (
    <main className="viewer-shell">
      <section className="viewer-card">
        <h1>ScreenMate Viewer</h1>
        <p className="viewer-status">
          {initialRoomId
            ? "Joining the room from the shared link."
            : "Join a room with the code from the host extension popup."}
        </p>
        <JoinForm isBusy={session.status === "joining"} onJoin={handleJoin} />
        {session.error ? <p className="viewer-error">{session.error}</p> : null}
        {session.endedReason ? (
          <p className="viewer-ended">{session.endedReason}</p>
        ) : null}
        <ViewerPlayer
          roomId={session.roomId}
          roomState={session.roomState}
          sourceState={session.sourceState}
          status={session.status}
          stream={session.remoteStream}
        />
      </section>
    </main>
  );
}
