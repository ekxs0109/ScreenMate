import { useEffect, useState } from "react";
import { ViewerShell } from "./components/ViewerShell";
import {
  buildRandomViewerUsername,
  useViewerI18n,
} from "./i18n";
import {
  getViewerApiBaseUrl,
  getViewerRoomPasswordFromLocation,
  getViewerRoomIdFromLocation,
} from "./lib/config";
import {
  initialViewerSessionState,
  type ViewerSessionState,
} from "./lib/session-state";
import { buildViewerSceneModel } from "./viewer-scene-adapter";
import { createViewerMockState, type ViewerMockState } from "./viewer-mock-state";
import { ViewerSession } from "./viewer-session";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { JoinForm } from "./components/JoinForm";

export default function App() {
  const { copy, locale } = useViewerI18n();
  const initialRoomId = getViewerRoomIdFromLocation();
  const initialRoomPassword = getViewerRoomPasswordFromLocation();
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
  const [isJoinOtherRoomOpen, setIsJoinOtherRoomOpen] = useState(false);

  useEffect(() => {
    const unsubscribe = viewerSession.subscribe(setSession);

    return () => {
      unsubscribe();
      viewerSession.destroy();
    };
  }, [viewerSession]);

  useEffect(() => {
    if (!initialRoomId) {
      return;
    }

    const currentSnapshot = viewerSession.getSnapshot();
    if (
      currentSnapshot.roomId === initialRoomId &&
      currentSnapshot.status !== "idle"
    ) {
      return;
    }

    void viewerSession.join(initialRoomId, initialRoomPassword);
  }, [initialRoomId, initialRoomPassword, viewerSession]);

  async function handleJoin(roomCode: string, password: string) {
    await viewerSession.join(roomCode, password);
    window.history.replaceState(
      {},
      "",
      `/rooms/${encodeURIComponent(roomCode)}`,
    );
  }

  const scene = buildViewerSceneModel({
    locale,
    session,
    mock,
  });

  return (
    <>
      <ViewerShell
        initialRoomPassword={initialRoomPassword}
        scene={scene}
        stream={session.remoteStream}
        onJoin={handleJoin}
        onLeaveRoom={() => {
          viewerSession.destroy();
          setSession(initialViewerSessionState);
          window.history.replaceState({}, "", "/");
        }}
        onJoinOtherRoom={() => {
          setIsJoinOtherRoomOpen(true);
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
      <Dialog open={isJoinOtherRoomOpen} onOpenChange={setIsJoinOtherRoomOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{copy.joinOtherRoom}</DialogTitle>
            <DialogDescription>
              {copy.joinRoomDescription}
            </DialogDescription>
          </DialogHeader>
          <JoinForm
            initialPassword={initialRoomPassword}
            isBusy={scene.player.joinBusy}
            onJoin={(roomCode, password) => {
              void viewerSession.join(roomCode, password).then(() => {
                setIsJoinOtherRoomOpen(false);
                window.history.replaceState({}, "", `/rooms/${encodeURIComponent(roomCode)}`);
              });
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
