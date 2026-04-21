import { useEffect, useState } from "react";
import { JoinForm } from "./components/JoinForm";
import { ViewerPlayer } from "./components/ViewerPlayer";
import {
  initialViewerSessionState,
  type ViewerSessionState,
} from "./lib/session-state";
import { ViewerSession } from "./viewer-session";

const API_BASE_URL =
  import.meta.env.VITE_SCREENMATE_API_BASE_URL ??
  import.meta.env.VITE_API_BASE_URL ??
  window.location.origin;

export default function App() {
  const [session, setSession] = useState<ViewerSessionState>(initialViewerSessionState);
  const [viewerSession] = useState(
    () =>
      new ViewerSession({
        apiBaseUrl: API_BASE_URL,
      }),
  );

  useEffect(() => {
    const unsubscribe = viewerSession.subscribe(setSession);

    return () => {
      unsubscribe();
      viewerSession.destroy();
    };
  }, [viewerSession]);

  async function handleJoin(roomCode: string) {
    await viewerSession.join(roomCode);
  }

  return (
    <main className="viewer-shell">
      <section className="viewer-card">
        <h1>ScreenMate Viewer</h1>
        <p className="viewer-status">
          Join a room with the code from the host extension popup.
        </p>
        <JoinForm isBusy={session.status === "joining"} onJoin={handleJoin} />
        {session.error ? <p className="viewer-error">{session.error}</p> : null}
        {session.endedReason ? (
          <p className="viewer-ended">{session.endedReason}</p>
        ) : null}
        <ViewerPlayer
          roomId={session.roomId}
          roomState={session.roomState}
          status={session.status}
          stream={session.remoteStream}
        />
      </section>
    </main>
  );
}
