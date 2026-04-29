import type { HostRoomSnapshot } from "../background/host-room-snapshot";
import type { SourceType } from "./scene-model";

const SILENT_AUTO_MESSAGES = new Set(["No video attached."]);

export function shouldShowSnapshotToast(
  snapshot: Pick<HostRoomSnapshot, "message">,
  context: {
    activeSourceType: SourceType;
    followActiveTabVideo: boolean;
  },
) {
  const message = snapshot.message?.trim();
  if (!message) {
    return false;
  }

  if (
    SILENT_AUTO_MESSAGES.has(message) &&
    (context.followActiveTabVideo || context.activeSourceType === "auto")
  ) {
    return false;
  }

  return true;
}
