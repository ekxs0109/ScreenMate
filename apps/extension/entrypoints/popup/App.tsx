import "./popup.css";
import { buildScreenMateViewerRoomUrl } from "../../lib/config";
import { useHostControls } from "./useHostControls";
import { getPopupViewModel } from "./view-model";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Loader2, Copy, Users, Video, Link as LinkIcon, AlertCircle } from "lucide-react";

function formatRoomLifecycle(roomLifecycle: string) {
  switch (roomLifecycle) {
    case "opening":
      return "Opening";
    case "open":
      return "Open";
    case "degraded":
      return "Degraded";
    case "closed":
      return "Closed";
    case "idle":
    default:
      return "Idle";
  }
}

function formatSourceState(sourceState: string) {
  switch (sourceState) {
    case "unattached":
      return "No video attached";
    case "attaching":
      return "Attaching";
    case "attached":
      return "Attached";
    case "recovering":
      return "Recovering";
    case "missing":
      return "No video attached";
    default:
      return sourceState;
  }
}

function App() {
  const {
    snapshot,
    videos,
    selectedVideoId,
    setSelectedVideoId,
    startOrAttach,
    stopRoom,
    isBusy,
    busyAction,
  } = useHostControls();
  const viewModel = getPopupViewModel(snapshot);
  const viewerRoomUrl = snapshot.roomId
    ? buildScreenMateViewerRoomUrl(snapshot.roomId)
    : null;
  const primaryActionLabel =
    isBusy && busyAction === "primary" ? "Working..." : viewModel.primaryActionLabel;
  const stopActionLabel =
    isBusy && busyAction === "stop" ? "Stopping room..." : "Stop room";

  const handleCopyLink = () => {
    if (viewerRoomUrl) {
      navigator.clipboard.writeText(viewerRoomUrl);
    }
  };

  return (
    <main className="w-[360px] min-h-[480px] p-4 font-sans antialiased bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-50 relative flex flex-col gap-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <header className="space-y-1">
        <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-teal-500 to-cyan-600 dark:from-teal-400 dark:to-cyan-500 bg-clip-text text-transparent inline-block">
          ScreenMate
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
          {viewModel.statusText}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <Card className="bg-white/50 dark:bg-slate-900/50 shadow-sm border-slate-200 dark:border-slate-800">
          <CardContent className="p-3 flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
              Room
            </span>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${snapshot.roomLifecycle === 'open' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300 dark:bg-slate-600'}`} />
              <span className="font-medium text-sm">
                {formatRoomLifecycle(snapshot.roomLifecycle)}
              </span>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white/50 dark:bg-slate-900/50 shadow-sm border-slate-200 dark:border-slate-800">
          <CardContent className="p-3 flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
              Video
            </span>
            <div className="flex items-center gap-2">
              <Video className="w-3.5 h-3.5 text-slate-400" />
              <span className="font-medium text-sm truncate">
                {formatSourceState(snapshot.sourceState)}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm border-slate-200 dark:border-slate-800 overflow-hidden">
        <CardContent className="p-0 divide-y divide-slate-100 dark:divide-slate-800">
          <div className="flex items-center justify-between p-3 bg-white/50 dark:bg-slate-900/50">
            <div className="flex items-center gap-2">
              <LinkIcon className="w-4 h-4 text-slate-400" />
              <div className="flex flex-col">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Room ID</span>
                <span className="text-sm font-mono">{snapshot.roomId ?? "Not started"}</span>
              </div>
            </div>
            {viewerRoomUrl && (
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleCopyLink} title="Copy viewer link">
                <Copy className="h-4 w-4" />
              </Button>
            )}
          </div>
          <div className="flex items-center justify-between p-3 bg-white/50 dark:bg-slate-900/50">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-slate-400" />
              <span className="text-sm font-medium">Viewers connected</span>
            </div>
            <Badge variant="secondary" className="font-mono">{snapshot.viewerCount}</Badge>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2 flex-1">
        <div className="flex items-center justify-between">
          <Label className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Available Videos
          </Label>
          <Badge variant="outline" className="text-[10px] h-5 px-1.5">{videos.length}</Badge>
        </div>
        
        <div className="flex-1 overflow-y-auto min-h-[80px] max-h-[160px] rounded-md border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 p-2">
          {videos.length > 0 ? (
            <RadioGroup value={selectedVideoId ?? undefined} onValueChange={setSelectedVideoId} className="gap-1.5">
              {videos.map((video) => (
                <Label
                  key={`${video.frameId}:${video.id}`}
                  htmlFor={`${video.frameId}:${video.id}`}
                  className={`flex items-center gap-3 p-2 rounded-md border cursor-pointer transition-colors ${
                    selectedVideoId === `${video.frameId}:${video.id}`
                      ? "bg-teal-50 dark:bg-teal-950/30 border-teal-200 dark:border-teal-800"
                      : "border-transparent hover:bg-slate-100 dark:hover:bg-slate-800"
                  }`}
                >
                  <RadioGroupItem value={`${video.frameId}:${video.id}`} id={`${video.frameId}:${video.id}`} />
                  <span className="text-sm font-medium truncate flex-1">{video.label}</span>
                </Label>
              ))}
            </RadioGroup>
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-slate-500 dark:text-slate-400">
              No videos found on this page
            </div>
          )}
        </div>
      </div>

      {snapshot.message && (
        <div className="p-2.5 text-xs rounded-md bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400 border border-red-100 dark:border-red-500/20 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <p>{snapshot.message}</p>
        </div>
      )}

      <div className="flex flex-col gap-2 mt-auto pt-2">
        <Button
          disabled={isBusy || !selectedVideoId}
          onClick={() => startOrAttach()}
          className="w-full bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700 text-white border-0 shadow-md"
        >
          {isBusy && busyAction === "primary" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {primaryActionLabel}
        </Button>
        <Button
          variant="outline"
          disabled={isBusy || !viewModel.canStop}
          onClick={() => stopRoom()}
          className="w-full border-slate-200 dark:border-slate-800 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/50 dark:hover:text-red-400 dark:hover:border-red-900/50 transition-colors"
        >
          {isBusy && busyAction === "stop" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {stopActionLabel}
        </Button>
      </div>
    </main>
  );
}

export default App;
