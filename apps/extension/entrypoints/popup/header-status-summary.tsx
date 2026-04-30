import { cn } from "../../lib/utils";
import type { ExtensionDictionary } from "./i18n";
import type {
  ExtensionSceneModel,
  HeaderSourceDetail,
  SourceType,
} from "./scene-model";

export function PopupHeaderStatusSummary({
  copy,
  scene,
}: {
  copy: ExtensionDictionary;
  scene: ExtensionSceneModel;
}) {
  const roomLabel = formatRoomLabel(scene, copy);
  const sourceMode = scene.header.source.type ??
    (scene.sourceTab.followActiveTabVideo ? "auto" : null);
  const sourceModeLabel = sourceMode
    ? formatSourceModeLabel(sourceMode, copy)
    : "";
  const sourceDetailLabel = formatSourceDetailLabel(
    scene.header.source.detail,
    copy,
  );
  const labels = [roomLabel, sourceModeLabel, sourceDetailLabel].filter(Boolean);
  const isActive = scene.header.playback.state === "active";

  return (
    <>
      <div
        data-testid="popup-header-summary"
        className="flex items-center gap-1.5 px-1 min-w-0"
        title={labels.join(" · ")}
      >
        <span
          className={cn(
            "size-2 rounded-full shrink-0",
            isActive
              ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.45)]"
              : "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.35)]",
          )}
        />
        <span className="shrink-0 font-medium text-[12px] text-foreground">
          {roomLabel}
        </span>
        {sourceModeLabel ? (
          <>
            <StatusSeparator />
            <span
              className={cn(
                "shrink-0 font-medium text-[12px]",
                sourceMode === "auto"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-muted-foreground",
              )}
            >
              {sourceModeLabel}
            </span>
          </>
        ) : null}
        {sourceDetailLabel ? (
          <>
            <StatusSeparator />
            <span className="truncate text-[12px] text-muted-foreground">
              {sourceDetailLabel}
            </span>
          </>
        ) : null}
      </div>
      <span data-testid="popup-room-status" className="sr-only">
        {scene.header.statusText}
      </span>
    </>
  );
}

function StatusSeparator() {
  return (
    <span className="shrink-0 text-[12px] text-muted-foreground/30">·</span>
  );
}

function formatRoomLabel(
  scene: ExtensionSceneModel,
  copy: ExtensionDictionary,
) {
  if (scene.header.room.state === "closed" || scene.header.room.state === "idle") {
    return copy.roomStatusIdle;
  }

  return scene.header.playback.state === "active"
    ? copy.roomStatusStreaming
    : copy.roomStatusWaiting;
}

function formatSourceModeLabel(
  sourceType: SourceType,
  copy: ExtensionDictionary,
) {
  if (sourceType === "auto") {
    return copy.sourceAuto;
  }

  if (sourceType === "sniff") {
    return copy.sourceSniff;
  }

  if (sourceType === "screen") {
    return copy.sourceScreen;
  }

  return copy.sourceUpload;
}

function formatSourceDetailLabel(
  detail: HeaderSourceDetail | null,
  copy: ExtensionDictionary,
) {
  if (!detail) {
    return "";
  }

  if (detail.kind === "display-tab") {
    return copy.sourceShareBrowserTab;
  }

  if (detail.kind === "display-window") {
    return copy.sourceShareWindow;
  }

  if (detail.kind === "display-screen") {
    return copy.sourceShareScreen;
  }

  return detail.label.startsWith("blob:") ? copy.webVideoStream : detail.label;
}
