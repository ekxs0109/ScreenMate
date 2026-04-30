import {
  Activity,
  Copy,
  ExternalLink,
  Hash,
  Info,
  Key,
  Users,
  LogOut,
} from "lucide-react";
import { cn } from "../../lib/utils";
import type { ExtensionDictionary } from "./i18n";
import type { ExtensionSceneModel } from "./scene-model";
import { PopupScrollArea } from "./presenter";

export function RoomTabPanel({
  scene,
  copy,
  onCopyLink,
  onCopyRoomId,
  onJumpToRoom,
  onStopRoom,
  onSavePassword,
  onPasswordChange,
}: {
  scene: ExtensionSceneModel;
  copy: ExtensionDictionary;
  onCopyLink: () => void;
  onCopyRoomId: () => void;
  onJumpToRoom: () => void;
  onStopRoom: () => void;
  onSavePassword: () => void;
  onPasswordChange: (value: string) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PopupScrollArea
        className="min-h-0 flex-1"
        contentClassName="p-4 flex flex-col gap-6"
      >
        {scene.roomTab.state === "empty" ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-4 opacity-70 px-8 py-20 min-h-[400px] animate-in fade-in duration-500">
            <div className="size-16 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mb-2">
              <Info className="w-8 h-8 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium leading-relaxed">
              {copy.notSharedYet}
            </p>
          </div>
        ) : (
          <>
            <div
              className="bg-white dark:bg-zinc-900 border border-border rounded-xl shadow-sm text-sm overflow-hidden animate-in slide-in-from-bottom-2 duration-300"
              data-testid="popup-room-card"
            >
              <div className="p-4 flex flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Hash className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                      <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                        {copy.roomId}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono font-bold text-xs truncate" data-testid="popup-room-id-value">
                        {scene.roomTab.roomId}
                      </span>
                      <button
                        className="rounded-md p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors shrink-0"
                        onClick={onCopyRoomId}
                        aria-label="Copy Room ID"
                        type="button"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 shrink-0 items-end">
                    <button
                      className="h-8 px-3 rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 font-bold text-xs flex items-center gap-1.5 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors border border-blue-100 dark:border-blue-800/50"
                      onClick={onJumpToRoom}
                      type="button"
                    >
                      {copy.openRoom}
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                    <button
                      data-testid="popup-stop-room"
                      className="h-8 px-3 rounded-lg border border-red-100 bg-red-50 text-red-600 dark:border-red-900/30 dark:bg-red-950/30 dark:text-red-400 font-bold text-xs flex items-center gap-1.5 hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
                      disabled={scene.meta.isBusy || !scene.tabs.canStopRoom}
                      onClick={onStopRoom}
                      type="button"
                    >
                      {copy.endShare}
                      <LogOut className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="h-px bg-border/50 -mx-4" />

                <div className="flex flex-col gap-3">
                  <div className="relative group">
                    <input
                      readOnly
                      type="text"
                      value={scene.roomTab.shareUrl ?? ""}
                      className="w-full bg-zinc-50 dark:bg-zinc-950 border border-border rounded-lg pl-3 pr-10 py-2.5 text-xs font-mono text-muted-foreground outline-none truncate transition-colors"
                    />
                    <button
                      className="absolute right-1.5 top-1.5 p-1.5 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-800 text-muted-foreground transition-colors"
                      onClick={onCopyLink}
                      aria-label="Copy Room Link"
                      type="button"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="relative flex-1 flex items-center">
                      <Key className="absolute left-3 w-3.5 h-3.5 text-muted-foreground" />
                      <input
                        data-testid="popup-room-password-input"
                        type="text"
                        value={scene.roomTab.passwordDraft}
                        onChange={(event) => onPasswordChange(event.target.value)}
                        placeholder={copy.passwordPlaceholder}
                        className="w-full bg-zinc-50 dark:bg-zinc-950 border border-border rounded-lg pl-9 pr-3 py-2 text-xs font-bold focus:ring-1 focus:ring-blue-500 outline-none transition-all dark:text-zinc-200"
                      />
                    </div>
                    <button
                      data-testid="popup-room-password-save"
                      onClick={onSavePassword}
                      type="button"
                      className={cn(
                        "h-8 px-4 rounded-lg font-bold text-xs transition-all shadow-sm whitespace-nowrap",
                        scene.roomTab.passwordSaved
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border border-green-200 dark:border-green-800/50"
                          : "bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200 border border-transparent",
                      )}
                    >
                      {scene.roomTab.passwordSaved ? copy.saved : copy.save}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div
              className="bg-white dark:bg-zinc-900 border border-border rounded-xl shadow-sm text-sm overflow-hidden flex flex-col animate-in slide-in-from-bottom-3 duration-400"
              data-testid="popup-viewer-roster"
            >
              <div className="p-3.5 border-b border-border bg-zinc-50/50 dark:bg-zinc-950/50 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-blue-500" />
                  <span className="font-bold">{copy.viewerList}</span>
                </div>
                <span
                  data-testid="popup-viewer-count"
                  className="px-2 py-0.5 rounded-full bg-blue-100/80 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-[10px] font-bold border border-blue-200 dark:border-blue-800/30 tabular-nums"
                >
                  {scene.roomTab.viewerCount}
                </span>
              </div>
              <div className="grid grid-cols-[1fr_70px_50px] gap-2 px-3.5 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-widest items-center border-b border-border/50 bg-zinc-50 dark:bg-zinc-900/30 transition-colors">
                <span>{copy.viewerName}</span>
                <span className="text-center">{copy.connType}</span>
                <span className="text-right flex items-center justify-end gap-1">
                  <Activity className="w-2.5 h-2.5" />
                  {copy.connPing}
                </span>
              </div>
              <div className="divide-y divide-border/50 max-h-[180px] overflow-y-auto">
                {scene.roomTab.viewerDetails.map((viewer) => (
                  <div
                    key={viewer.id}
                    data-testid={`popup-viewer-row-${viewer.id}`}
                    data-online={viewer.online ? "true" : "false"}
                    className="grid grid-cols-[1fr_70px_50px] gap-2 px-3.5 py-2.5 items-center hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors group"
                  >
                    <div className="font-bold text-xs flex items-center gap-2 min-w-0 pr-1">
                      <div
                        className={cn(
                          "size-1.5 rounded-full shrink-0",
                          viewer.online
                            ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]"
                            : "bg-zinc-300 dark:bg-zinc-600",
                        )}
                      />
                      <span
                        data-testid={`popup-viewer-name-${viewer.id}`}
                        className="truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors"
                      >
                        {viewer.name}
                      </span>
                    </div>
                    <div className="flex justify-center">
                      <span className="text-[9px] font-bold text-muted-foreground bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded-md border border-border whitespace-nowrap transition-colors group-hover:border-zinc-300 dark:group-hover:border-zinc-700">
                        {viewer.connType}
                      </span>
                    </div>
                    <div
                      className={cn(
                        "font-mono font-bold text-[11px] text-right transition-colors",
                        viewer.isGood
                          ? "text-green-600 dark:text-green-400"
                          : "text-amber-500",
                      )}
                    >
                      {viewer.ping}
                    </div>
                  </div>
                ))}
                {scene.roomTab.viewerDetails.length === 0 && (
                  <div className="px-3.5 py-8 text-center text-xs text-muted-foreground italic">
                    {copy.noViewers ?? "No viewers yet"}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </PopupScrollArea>
    </div>
  );
}
