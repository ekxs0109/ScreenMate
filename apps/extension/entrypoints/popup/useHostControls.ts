import { browser } from "wxt/browser";
import { useEffect, useState } from "react";
import type { HostMessage, TabVideoSource } from "../background";
import {
  createHostRoomSnapshot,
  type HostRoomLifecycle,
  type HostRoomSnapshot,
  type HostSourceState,
} from "../background/host-room-snapshot";
import { createLogger } from "../../lib/logger";

const POLL_INTERVAL_MS = 2_000;
const popupLogger = createLogger("popup");

type BusyAction = "primary" | "stop" | null;

const ROOM_LIFECYCLES = new Set<HostRoomLifecycle>([
  "idle",
  "opening",
  "open",
  "degraded",
  "closed",
]);

const SOURCE_STATES = new Set<HostSourceState>([
  "unattached",
  "attaching",
  "attached",
  "recovering",
  "missing",
]);

export type PopupLogger = Pick<
  ReturnType<typeof createLogger>,
  "error" | "info" | "warn"
>;

export function buildSnapshotRequest(): Extract<
  HostMessage,
  { type: "screenmate:get-room-session" }
> {
  return { type: "screenmate:get-room-session" };
}

export function buildStartSharingRequests(
  snapshot: HostRoomSnapshot,
  selectedVideo: Pick<TabVideoSource, "frameId" | "id">,
): Array<
  | Extract<HostMessage, { type: "screenmate:start-room" }>
  | Extract<HostMessage, { type: "screenmate:attach-source" }>
> {
  const attachRequest: Extract<HostMessage, { type: "screenmate:attach-source" }> = {
    type: "screenmate:attach-source",
    frameId: selectedVideo.frameId,
    videoId: selectedVideo.id,
  };

  if (snapshot.roomId && snapshot.roomLifecycle !== "closed") {
    return [attachRequest];
  }

  return [
    {
      type: "screenmate:start-room",
      frameId: selectedVideo.frameId,
    },
    attachRequest,
  ];
}

export function buildStopSharingRequest(): Extract<
  HostMessage,
  { type: "screenmate:stop-room" }
> {
  return { type: "screenmate:stop-room" };
}

export function useHostControls() {
  const [snapshot, setSnapshot] = useState<HostRoomSnapshot>(
    createHostRoomSnapshot(),
  );
  const [videos, setVideos] = useState<TabVideoSource[]>([]);
  const [selectedVideoKey, setSelectedVideoKey] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);

  useEffect(() => {
    let isCancelled = false;

    const syncSnapshot = () =>
      browser.runtime
        .sendMessage(buildSnapshotRequest())
        .then((nextSnapshot) => {
          if (!isCancelled) {
            const normalizedSnapshot = normalizeSnapshot(nextSnapshot);
            popupLogger.debug("Synced host room snapshot.", normalizedSnapshot);
            setSnapshot(normalizedSnapshot);
          }
        })
        .catch(() => {
          if (!isCancelled) {
            setSnapshot((current) =>
              createHostRoomSnapshot({
                ...current,
                message: "Could not load popup state.",
              }),
            );
          }
        });

    const syncVideos = () =>
      browser.runtime
        .sendMessage({ type: "screenmate:list-videos" })
        .then((nextVideos) => {
          if (isCancelled) {
            return;
          }

          const normalizedVideos = normalizeVideos(nextVideos);
          popupLogger.info("Synced page videos.", {
            firstRawVideo:
              Array.isArray(nextVideos) && nextVideos.length > 0
                ? nextVideos[0]
                : null,
            normalizedFirstVideo:
              normalizedVideos.length > 0 ? normalizedVideos[0] : null,
            rawIsArray: Array.isArray(nextVideos),
            rawLength: Array.isArray(nextVideos) ? nextVideos.length : null,
            selectedVideoKey,
            totalVideos: normalizedVideos.length,
          });
          if (
            Array.isArray(nextVideos) &&
            nextVideos.length > 0 &&
            normalizedVideos.length === 0
          ) {
            popupLogger.warn(
              "Video list response was dropped during normalization.",
              {
                nextVideos,
              },
            );
          }
          setVideos(normalizedVideos);
          setSelectedVideoKey((current) => {
            if (
              current &&
              normalizedVideos.some(
                (video) => getVideoSelectionKey(video) === current,
              )
            ) {
              return current;
            }

            return normalizedVideos[0]
              ? getVideoSelectionKey(normalizedVideos[0])
              : null;
          });
        })
        .catch(() => {
          if (!isCancelled) {
            setVideos([]);
            setSelectedVideoKey(null);
          }
        });

    const syncAll = () => {
      void syncSnapshot();
      void syncVideos();
    };

    const handleTabActivated = () => {
      popupLogger.info("Active tab changed. Refreshing popup state.");
      syncAll();
    };

    const handleTabUpdated = () => {
      popupLogger.info("Tab updated. Refreshing popup state.");
      syncAll();
    };

    const handleWindowFocus = () => {
      popupLogger.info("Popup window focus changed. Refreshing popup state.");
      syncAll();
    };

    syncAll();
    const intervalId = window.setInterval(() => {
      syncAll();
    }, POLL_INTERVAL_MS);
    browser.tabs.onActivated.addListener(handleTabActivated);
    browser.tabs.onUpdated.addListener(handleTabUpdated);
    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleWindowFocus);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
      browser.tabs.onActivated.removeListener(handleTabActivated);
      browser.tabs.onUpdated.removeListener(handleTabUpdated);
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleWindowFocus);
    };
  }, []);

  useEffect(() => {
    const selectedVideo = videos.find(
      (video) => getVideoSelectionKey(video) === selectedVideoKey,
    );
    const previewMessage = selectedVideo
      ? {
          type: "screenmate:preview-video" as const,
          frameId: selectedVideo.frameId,
          label: selectedVideo.label,
          videoId: selectedVideo.id,
        }
      : ({ type: "screenmate:clear-preview" } as const);

    popupLogger.info("Updating page preview selection.", previewMessage);
    void browser.runtime.sendMessage(previewMessage).catch(() => {
      popupLogger.warn("Could not update page preview selection.");
    });

    return () => {
      void browser.runtime
        .sendMessage({ type: "screenmate:clear-preview" })
        .catch(() => {
          popupLogger.warn("Could not clear page preview on popup cleanup.");
        });
    };
  }, [selectedVideoKey, videos]);

  const startOrAttach = async () => {
    const selectedVideo = videos.find(
      (video) => getVideoSelectionKey(video) === selectedVideoKey,
    );
    const hasActiveRoom =
      snapshot.roomId !== null && snapshot.roomLifecycle !== "closed";

    popupLogger.info("Room action requested.", {
      selectedVideoKey,
    });

    if (!selectedVideo) {
      setSnapshot((current) =>
        createHostRoomSnapshot({
          ...current,
          message: "No video elements found on this page.",
        }),
      );
      return;
    }

    setBusyAction("primary");
    setSnapshot((current) =>
      createHostRoomSnapshot({
        ...current,
        roomLifecycle:
          current.roomId !== null && current.roomLifecycle !== "closed"
            ? current.roomLifecycle
            : "opening",
        sourceState:
          current.roomId !== null && current.roomLifecycle !== "closed"
            ? "attaching"
            : current.sourceState,
        activeFrameId: selectedVideo.frameId,
        message: null,
      }),
    );

    try {
      let nextSnapshot = snapshot;

      if (!hasActiveRoom) {
        const startedRoom = await browser.runtime.sendMessage({
          type: "screenmate:start-room",
          frameId: selectedVideo.frameId,
        });
        nextSnapshot = normalizeSnapshot(startedRoom);
        reportRoomActionResult(popupLogger, nextSnapshot, startedRoom);
        setSnapshot(nextSnapshot);

        if (!nextSnapshot.roomId) {
          return;
        }
      }

      const attachedSource = await browser.runtime.sendMessage({
        type: "screenmate:attach-source",
        frameId: selectedVideo.frameId,
        videoId: selectedVideo.id,
      });
      nextSnapshot = normalizeSnapshot(attachedSource);
      reportRoomActionResult(popupLogger, nextSnapshot, attachedSource);
      setSnapshot(nextSnapshot);
    } catch (error) {
      popupLogger.error("Room action runtime request failed.", {
        error: error instanceof Error ? error.message : String(error),
      });
      setSnapshot((current) =>
        createHostRoomSnapshot({
          ...current,
          message:
            error instanceof Error && error.message
              ? error.message
              : "Could not update the room in the active tab.",
        }),
      );
    } finally {
      setBusyAction(null);
    }
  };

  const stopRoom = async () => {
    setBusyAction("stop");

    try {
      const nextSnapshot = normalizeSnapshot(
        await browser.runtime.sendMessage(buildStopSharingRequest()),
      );
      popupLogger.info("Stop room returned a snapshot.", {
        message: nextSnapshot.message,
        roomId: nextSnapshot.roomId,
        roomLifecycle: nextSnapshot.roomLifecycle,
        sourceState: nextSnapshot.sourceState,
      });
      setSnapshot(nextSnapshot);
    } catch {
      setSnapshot((current) =>
        createHostRoomSnapshot({
          ...current,
          message: "Could not stop the room in the active tab.",
        }),
      );
    } finally {
      setBusyAction(null);
    }
  };

  return {
    snapshot,
    videos,
    selectedVideoId: selectedVideoKey,
    setSelectedVideoId: setSelectedVideoKey,
    startOrAttach,
    stopRoom,
    isBusy: busyAction !== null,
    busyAction,
  };
}

export function normalizeSnapshot(value: unknown): HostRoomSnapshot {
  if (!value || typeof value !== "object") {
    return createHostRoomSnapshot();
  }

  const candidate = value as Partial<HostRoomSnapshot>;

  return createHostRoomSnapshot({
    roomLifecycle: ROOM_LIFECYCLES.has(candidate.roomLifecycle as HostRoomLifecycle)
      ? (candidate.roomLifecycle as HostRoomLifecycle)
      : "idle",
    sourceState: SOURCE_STATES.has(candidate.sourceState as HostSourceState)
      ? (candidate.sourceState as HostSourceState)
      : "unattached",
    roomId: typeof candidate.roomId === "string" ? candidate.roomId : null,
    viewerCount:
      typeof candidate.viewerCount === "number" ? candidate.viewerCount : 0,
    sourceLabel:
      typeof candidate.sourceLabel === "string" ? candidate.sourceLabel : null,
    activeTabId:
      typeof candidate.activeTabId === "number" ? candidate.activeTabId : null,
    activeFrameId:
      typeof candidate.activeFrameId === "number"
        ? candidate.activeFrameId
        : null,
    recoverByTimestamp:
      typeof candidate.recoverByTimestamp === "number"
        ? candidate.recoverByTimestamp
        : null,
    message: typeof candidate.message === "string" ? candidate.message : null,
  });
}

function normalizeVideos(value: unknown): TabVideoSource[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (item): item is TabVideoSource =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as TabVideoSource).id === "string" &&
        typeof (item as TabVideoSource).label === "string" &&
        typeof (item as TabVideoSource).frameId === "number",
    )
    .map((item) => ({
      id: item.id,
      label: item.label,
      frameId: item.frameId,
    }));
}

function getVideoSelectionKey(video: TabVideoSource): string {
  return `${video.frameId}:${video.id}`;
}

export function reportRoomActionResult(
  logger: PopupLogger,
  normalizedSnapshot: HostRoomSnapshot,
  rawSnapshot: unknown,
) {
  const details = {
    message: normalizedSnapshot.message,
    normalizedSnapshot,
    rawSnapshot,
    roomId: normalizedSnapshot.roomId,
    roomLifecycle: normalizedSnapshot.roomLifecycle,
    sourceLabel: normalizedSnapshot.sourceLabel,
    sourceState: normalizedSnapshot.sourceState,
  };

  if (normalizedSnapshot.message && normalizedSnapshot.sourceState !== "attached") {
    logger.error("Room action returned an error snapshot.", details);
    return;
  }

  logger.info("Room action returned a snapshot.", details);
}
