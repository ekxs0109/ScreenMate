import { useEffect, useRef, useState } from "react";
import { JoinForm } from "./components/JoinForm";
import { ViewerPlayer } from "./components/ViewerPlayer";
import { ThemeToggle } from "./components/theme-toggle";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./components/ui/card";
import { Badge } from "./components/ui/badge";
import {
  getViewerApiBaseUrl,
  getViewerRoomIdFromLocation,
} from "./lib/config";
import {
  initialViewerSessionState,
  type ViewerSessionState,
} from "./lib/session-state";
import { ViewerSession } from "./viewer-session";
import { AlertCircle } from "lucide-react";

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
    <div className="min-h-screen bg-background/95 p-4 md:p-8 md:pt-12 font-sans antialiased text-slate-900 dark:text-slate-50 transition-colors duration-300 relative">
      <div className="absolute top-4 right-4 z-50">
        <ThemeToggle />
      </div>

      <main className="max-w-3xl mx-auto space-y-6">
        <Card className="border-slate-200/50 dark:border-slate-800/50 shadow-xl dark:shadow-2xl dark:shadow-slate-900/50 bg-white/70 dark:bg-slate-900/70 backdrop-blur-md rounded-2xl overflow-hidden transition-all duration-300">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-3xl font-bold tracking-tight bg-gradient-to-r from-teal-500 to-cyan-600 dark:from-teal-400 dark:to-cyan-500 bg-clip-text text-transparent inline-block">
              ScreenMate
            </CardTitle>
            <CardDescription className="text-sm font-medium mt-1 dark:text-slate-400">
              {initialRoomId
                ? "Joining the room from the shared link"
                : "Join a room with the code from the host extension popup"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-4">
            <JoinForm isBusy={session.status === "joining"} onJoin={handleJoin} />

            {session.error && (
              <div className="p-3 text-sm rounded-lg bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400 border border-red-100 dark:border-red-500/20 flex items-center gap-2">
                <AlertCircle className="size-4 shrink-0" />
                <p>{session.error}</p>
              </div>
            )}
            
            {session.endedReason && (
              <div className="p-3 text-sm rounded-lg bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 border border-amber-100 dark:border-amber-500/20 flex items-center gap-2">
                <AlertCircle className="size-4 shrink-0" />
                <p>{session.endedReason}</p>
              </div>
            )}

            {session.status !== "idle" && (
              <div className="flex items-center justify-center pt-2">
                <Badge variant={session.status === "connected" ? "default" : "secondary"} className="px-3 py-1 uppercase tracking-wider text-xs font-semibold">
                  {session.status}
                </Badge>
              </div>
            )}

            <ViewerPlayer
              roomId={session.roomId}
              roomState={session.roomState}
              sourceState={session.sourceState}
              status={session.status}
              stream={session.remoteStream}
            />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
