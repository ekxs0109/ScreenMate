import {
  Activity,
  Copy,
  ExternalLink,
  Hash,
  Info,
  Check,
  Key,
  Users,
  LogOut,
} from "lucide-react";
import { ROOM_PASSWORD_RULES } from "@screenmate/shared";
import { cn } from "../../lib/utils";
import type { ExtensionDictionary } from "./i18n";
import type { ExtensionSceneModel } from "./scene-model";
import { PopupScrollArea } from "./presenter";
import { ViewerList } from "../../components/viewer-list";

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
        contentClassName="p-4 flex flex-col gap-3"
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
                      className="h-8 px-3 rounded-lg bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200 font-bold text-xs flex items-center gap-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors border border-border/50"
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
                        autoComplete="off"
                        maxLength={ROOM_PASSWORD_RULES.maxLength}
                        pattern="[A-Za-z0-9_-]*"
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
                        "h-8 px-4 rounded-lg font-bold text-xs transition-all whitespace-nowrap border flex items-center justify-center",
                        scene.roomTab.passwordSaved
                          ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400 border-emerald-200/50 dark:border-emerald-500/20"
                          : "bg-zinc-100 text-zinc-800 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700 border-border/50 shadow-sm",
                      )}
                    >
                      {scene.roomTab.passwordSaved ? (
                        <span className="flex items-center gap-1.5">
                          <Check className="w-3.5 h-3.5" />
                          {copy.saved}
                        </span>
                      ) : (
                        copy.save
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl shadow-sm border border-border overflow-hidden animate-in slide-in-from-bottom-3 duration-400">
              <ViewerList
                viewers={scene.roomTab.viewerDetails}
                emptyMessage={copy.noViewers}
                title={copy.viewerList}
                className="max-h-[250px]"
              />
            </div>
          </>
        )}
      </PopupScrollArea>
    </div>
  );
}
