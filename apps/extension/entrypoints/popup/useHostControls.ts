import { browser } from "wxt/browser";
import { useEffect, useState } from "react";
import type { HostMessage, TabVideoSource } from "../background";
import { createLogger } from "../../lib/logger";

export type HostStatus =
  | "idle"
  | "starting"
  | "hosting"
  | "streaming"
  | "degraded"
  | "closed";

export type HostSnapshot = {
  status: HostStatus;
  roomId: string | null;
  viewerCount: number;
  errorMessage: string | null;
  sourceLabel: string | null;
};

type RoomSessionSnapshot = {
  roomLifecycle?: "idle" | "opening" | "open" | "degraded" | "closed";
  sourceState?:
    | "unattached"
    | "attaching"
    | "attached"
    | "recovering"
    | "missing";
  roomId?: string | null;
  viewerCount?: number;
  sourceLabel?: string | null;
  message?: string | null;
};

export function createHostSnapshot(
  overrides: Partial<HostSnapshot> = {},
): HostSnapshot {
  return {
    status: "idle",
    roomId: null,
    viewerCount: 0,
    errorMessage: null,
    sourceLabel: null,
    ...overrides,
  };
}

const POLL_INTERVAL_MS = 2_000;
const popupLogger = createLogger("popup");

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
  snapshot: HostSnapshot,
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

  if (snapshot.roomId && snapshot.status !== "closed") {
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
  const [snapshot, setSnapshot] = useState<HostSnapshot>(createHostSnapshot());
  const [videos, setVideos] = useState<TabVideoSource[]>([]);
  const [selectedVideoKey, setSelectedVideoKey] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    const syncSnapshot = () =>
      browser.runtime
        .sendMessage(buildSnapshotRequest())
        .then((nextSnapshot) => {
          if (!isCancelled) {
            const normalizedSnapshot = normalizeSnapshot(nextSnapshot);
            popupLogger.debug("Synced host snapshot.", normalizedSnapshot);
            setSnapshot(normalizedSnapshot);
          }
        })
        .catch(() => {
          if (!isCancelled) {
            setSnapshot(
              createHostSnapshot({
                errorMessage: "Could not load popup state.",
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
          if (Array.isArray(nextVideos) && nextVideos.length > 0 && normalizedVideos.length === 0) {
            popupLogger.warn("Video list response was dropped during normalization.", {
              nextVideos,
            });
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

  return {
    snapshot,
    videos,
    selectedVideoId: selectedVideoKey,
    setSelectedVideoId: setSelectedVideoKey,
    startSharing: () => {
      const selectedVideo = videos.find(
        (video) => getVideoSelectionKey(video) === selectedVideoKey,
      );

      popupLogger.info("Start sharing requested.", {
        selectedVideoKey,
      });
      if (!selectedVideo) {
        setSnapshot(
          createHostSnapshot({
            errorMessage: "No video elements found on this page.",
          }),
        );
        return;
      }

      setSnapshot((current) =>
        createHostSnapshot({
          ...current,
          status: "starting",
          errorMessage: null,
        }),
      );

      return buildStartSharingRequests(snapshot, selectedVideo)
        .reduce<Promise<unknown>>(
          (chain, message) =>
            chain.then((previousResponse) => {
              if (
                message.type === "screenmate:attach-source" &&
                previousResponse &&
                typeof previousResponse === "object" &&
                "roomId" in (previousResponse as Record<string, unknown>) &&
                typeof (previousResponse as { roomId?: unknown }).roomId !== "string"
              ) {
                return previousResponse;
              }

              return browser.runtime.sendMessage(message);
            }),
          Promise.resolve(undefined),
        )
        .then((nextSnapshot) => {
          const normalizedSnapshot = normalizeSnapshot(nextSnapshot);
          reportStartSharingResult(
            popupLogger,
            normalizedSnapshot,
            nextSnapshot,
          );
          setSnapshot(normalizedSnapshot);
        })
        .catch((error) => {
          popupLogger.error("Start sharing runtime request failed.", {
            error: error instanceof Error ? error.message : String(error),
          });
          setSnapshot(
            createHostSnapshot({
              errorMessage:
                error instanceof Error && error.message
                  ? error.message
                  : "Could not start sharing in the active tab.",
            }),
          );
        });
    },
    stopSharing: () =>
      browser.runtime
        .sendMessage(buildStopSharingRequest())
        .then((nextSnapshot) => {
          const normalizedSnapshot = normalizeSnapshot(nextSnapshot);
          popupLogger.info("Stop sharing returned a snapshot.", {
            errorMessage: normalizedSnapshot.errorMessage,
            roomId: normalizedSnapshot.roomId,
            status: normalizedSnapshot.status,
          });
          setSnapshot(normalizedSnapshot);
        })
        .catch(() => {
          setSnapshot(
            createHostSnapshot({
              errorMessage: "Could not stop sharing in the active tab.",
            }),
          );
        }),
  };
}

export function normalizeSnapshot(value: unknown): HostSnapshot {
  if (!value || typeof value !== "object") {
    return createHostSnapshot();
  }

  const candidate = value as Partial<HostSnapshot> & RoomSessionSnapshot;

  if (
    typeof candidate.roomLifecycle === "string" ||
    typeof candidate.sourceState === "string"
  ) {
    const viewerCount =
      typeof candidate.viewerCount === "number" ? candidate.viewerCount : 0;
    return createHostSnapshot({
      status: normalizeStatus(candidate),
      roomId: typeof candidate.roomId === "string" ? candidate.roomId : null,
      viewerCount,
      errorMessage:
        typeof candidate.message === "string" ? candidate.message : null,
      sourceLabel:
        typeof candidate.sourceLabel === "string" ? candidate.sourceLabel : null,
    });
  }

  return createHostSnapshot({
    status: candidate.status,
    roomId: typeof candidate.roomId === "string" ? candidate.roomId : null,
    viewerCount:
      typeof candidate.viewerCount === "number" ? candidate.viewerCount : 0,
    errorMessage:
      typeof candidate.errorMessage === "string" ? candidate.errorMessage : null,
    sourceLabel:
      typeof candidate.sourceLabel === "string" ? candidate.sourceLabel : null,
  });
}

function normalizeStatus(
  snapshot: Partial<HostSnapshot> & RoomSessionSnapshot,
): HostStatus {
  switch (snapshot.roomLifecycle) {
    case "opening":
      return "starting";
    case "closed":
      return "closed";
    case "degraded":
      return "degraded";
    case "open":
      if (snapshot.sourceState === "attached") {
        return (snapshot.viewerCount ?? 0) > 0 ? "streaming" : "hosting";
      }

      if (
        snapshot.sourceState === "recovering" ||
        snapshot.sourceState === "missing"
      ) {
        return "degraded";
      }

      return "hosting";
    case "idle":
    default:
      return "idle";
  }
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

export function reportStartSharingResult(
  logger: PopupLogger,
  normalizedSnapshot: HostSnapshot,
  rawSnapshot: unknown,
) {
  const details = {
    errorMessage: normalizedSnapshot.errorMessage,
    normalizedSnapshot,
    rawSnapshot,
    roomId: normalizedSnapshot.roomId,
    sourceLabel: normalizedSnapshot.sourceLabel,
    status: normalizedSnapshot.status,
  };

  if (normalizedSnapshot.errorMessage) {
    logger.error("Start sharing returned an error snapshot.", details);
    return;
  }

  logger.info("Start sharing returned a snapshot.", details);
}
