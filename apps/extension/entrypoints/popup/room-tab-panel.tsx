import {
  Activity,
  Copy,
  ExternalLink,
  Hash,
  Info,
  Key,
  Users,
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
              <div className="p-3 border-b border-border bg-zinc-50/50 dark:bg-zinc-950/50 flex justify-between items-center transition-colors">
                <div className="flex items-center gap-2">
                  <Hash className="w-4 h-4 text-blue-500" />
                  <span className="font-bold">
                    {copy.roomId}:{" "}
                    <span data-testid="popup-room-id-value">
                      {scene.roomTab.roomId}
                    </span>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="rounded-md p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors"
                    onClick={onCopyRoomId}
                    aria-label="Copy Room ID"
                    type="button"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                  <button
                    className="text-xs text-blue-600 dark:text-blue-400 font-bold flex items-center gap-1.5 hover:underline decoration-2 underline-offset-4 transition-[color,text-decoration-color]"
                    onClick={onJumpToRoom}
                    type="button"
                  >
                    {copy.openRoom}{" "}
                    <ExternalLink className="w-3 h-3 stroke-[3]" />
                  </button>
                  <button
                    data-testid="popup-stop-room"
                    className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[10px] font-black uppercase tracking-wide text-red-600 transition-colors hover:bg-red-100 disabled:opacity-50 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-900/40"
                    disabled={scene.meta.isBusy || !scene.tabs.canStopRoom}
                    onClick={onStopRoom}
                    type="button"
                  >
                    {copy.endShare}
                  </button>
                </div>
              </div>
              <div className="p-3 flex flex-col gap-4">
                <div className="relative group">
                  <input
                    readOnly
                    type="text"
                    value={scene.roomTab.shareUrl ?? ""}
                    className="w-full bg-zinc-100 dark:bg-zinc-950 border border-border rounded-lg pl-3 pr-10 py-2.5 text-xs font-mono text-muted-foreground outline-none truncate transition-colors focus:bg-white dark:focus:bg-black"
                  />
                  <button
                    className="absolute right-1.5 top-1.5 p-1.5 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-800 text-muted-foreground transition-[background-color,transform] active:scale-90"
                    onClick={onCopyLink}
                    aria-label="Copy Room Link"
                    type="button"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <div className="size-7 flex items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800 shrink-0 border border-border shadow-sm">
                    <Key className="w-3.5 h-3.5 text-muted-foreground" />
                  </div>
                  <input
                    data-testid="popup-room-password-input"
                    type="text"
                    value={scene.roomTab.passwordDraft}
                    onChange={(event) => onPasswordChange(event.target.value)}
                    placeholder={copy.passwordPlaceholder}
                    className="flex-1 bg-transparent border-b border-border px-1 py-1.5 text-xs font-bold focus:border-blue-500 focus:outline-none transition-colors dark:text-zinc-200 placeholder:font-medium"
                  />
                  <button
                    data-testid="popup-room-password-save"
                    onClick={onSavePassword}
                    type="button"
                    className={cn(
                      "text-xs px-3 py-1.5 rounded-lg font-bold transition-[background-color,transform,box-shadow] shadow-sm whitespace-nowrap active:scale-95",
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

            <div
              className="bg-white dark:bg-zinc-900 border border-border rounded-xl shadow-sm text-sm overflow-hidden flex flex-col animate-in slide-in-from-bottom-3 duration-400"
              data-testid="popup-viewer-roster"
            >
              <div className="p-3 border-b border-border bg-zinc-50/50 dark:bg-zinc-950/50 flex justify-between items-center transition-colors">
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
              <div className="grid grid-cols-[1fr_70px_50px] gap-2 px-3 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-widest items-center border-b border-border/50 bg-zinc-50 dark:bg-zinc-900/30 transition-colors">
                <span>{copy.viewerName}</span>
                <span className="text-center">{copy.connType}</span>
                <span className="text-right flex items-center justify-end gap-1">
                  <Activity className="w-2.5 h-2.5" />
                  {copy.connPing}
                </span>
              </div>
              <div className="divide-y divide-border/50">
                {scene.roomTab.viewerDetails.map((viewer) => (
                  <div
                    key={viewer.id}
                    data-testid={`popup-viewer-row-${viewer.id}`}
                    data-online={viewer.online ? "true" : "false"}
                    className="grid grid-cols-[1fr_70px_50px] gap-2 px-3 py-2.5 items-center hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors group"
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
              </div>
            </div>
          </>
        )}
      </PopupScrollArea>
    </div>
  );
}
