import type { HostRoomSnapshot } from "../background/host-room-snapshot";

export type PopupViewModel = {
  primaryActionLabel: string;
  statusText: string;
  canStop: boolean;
};

export function getPopupViewModel(
  snapshot: HostRoomSnapshot,
): PopupViewModel {
  return {
    primaryActionLabel: getPrimaryActionLabel(snapshot),
    statusText: getStatusText(snapshot),
    canStop: snapshot.roomId !== null,
  };
}

function getPrimaryActionLabel(snapshot: HostRoomSnapshot): string {
  if (snapshot.roomId === null) {
    return "Start room";
  }

  if (snapshot.sourceState === "attached") {
    return "Replace attached video";
  }

  if (snapshot.sourceState === "attaching") {
    return "Attaching...";
  }

  return "Attach selected video";
}

function getStatusText(snapshot: HostRoomSnapshot): string {
  if (
    snapshot.roomLifecycle === "open" &&
    snapshot.sourceState === "missing"
  ) {
    return "Room open · No video attached";
  }

  if (
    snapshot.roomLifecycle === "degraded" &&
    snapshot.sourceState === "recovering"
  ) {
    return "Recovering video source...";
  }

  return `Room ${snapshot.roomLifecycle} · ${snapshot.sourceState}`;
}
