import { describe, expect, it, vi } from "vitest";
import {
  buildStartSharingRequest,
  buildStopSourceRequest,
  buildStopSharingRequest,
  buildSetRoomPasswordRequest,
  getRoomPasswordValidationMessage,
  normalizeSnapshot,
  parseVideoSelectionKey,
  resolvePopupSelectedVideoKey,
  reportRoomActionResult,
  resolveSelectedVideoKey,
  shouldRunQueuedSync,
  shouldRetryEmptyVideoList,
  waitForMinimumRefreshDuration,
  type PopupLogger,
} from "../../entrypoints/popup/useHostControls";
import { shouldShowSnapshotToast } from "../../entrypoints/popup/popup-toast";
import { createHostRoomSnapshot } from "../../entrypoints/background/host-room-snapshot";

function createLoggerDouble(): PopupLogger {
  return {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
}

describe("reportRoomActionResult", () => {
  it("logs error snapshots with error severity", () => {
    const logger = createLoggerDouble();
    const snapshot = createHostRoomSnapshot({
      message: "Failed to fetch",
      sourceLabel: "blob:https://example.com/video",
    });

    reportRoomActionResult(logger, snapshot, snapshot);

    expect(logger.error).toHaveBeenCalledWith(
      "Room action returned an error snapshot.",
      expect.objectContaining({
        message: "Failed to fetch",
        roomLifecycle: "idle",
      }),
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("logs room attach success snapshots with info severity", () => {
    const logger = createLoggerDouble();
    const snapshot = createHostRoomSnapshot({
      roomLifecycle: "open",
      sourceState: "attached",
      roomId: "room_123",
      viewerCount: 1,
      sourceLabel: "Video 2",
      activeTabId: 42,
      activeFrameId: 0,
      recoverByTimestamp: null,
      message: null,
    });

    reportRoomActionResult(logger, snapshot, snapshot);

    expect(logger.info).toHaveBeenCalledWith(
      "Room action returned a snapshot.",
      expect.objectContaining({
        roomId: "room_123",
        sourceState: "attached",
      }),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe("normalizeSnapshot", () => {
  it("maps room-runtime snapshots into popup room state", () => {
    expect(
      normalizeSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_123",
        viewerCount: 2,
        sourceLabel: "Video 1",
        message: null,
      }),
    ).toEqual({
      roomLifecycle: "open",
      sourceState: "attached",
      roomId: "room_123",
      viewerCount: 2,
      viewerRoster: [],
      chatMessages: [],
      sourceLabel: "Video 1",
      activeTabId: null,
      activeFrameId: null,
      recoverByTimestamp: null,
      message: null,
    });
  });
});

describe("popup snapshot toasts", () => {
  it("does not toast the automatic no-video state", () => {
    expect(
      shouldShowSnapshotToast(
        { message: "No video attached." },
        { activeSourceType: "auto", followActiveTabVideo: true },
      ),
    ).toBe(false);
  });

  it("still toasts actionable errors and manual missing-source states", () => {
    expect(
      shouldShowSnapshotToast(
        { message: "Failed to fetch" },
        { activeSourceType: "auto", followActiveTabVideo: true },
      ),
    ).toBe(true);
    expect(
      shouldShowSnapshotToast(
        { message: "No video attached." },
        { activeSourceType: "sniff", followActiveTabVideo: false },
      ),
    ).toBe(true);
  });
});

describe("popup room action messages", () => {
  it("parses cached video selection keys when the sniff cache is stale", () => {
    expect(parseVideoSelectionKey("42:7:screenmate-video-1")).toEqual({
      tabId: 42,
      frameId: 7,
      id: "screenmate-video-1",
    });
    expect(parseVideoSelectionKey("bad:key")).toBeNull();
  });

  it("builds one tab-video start-sharing request when no room exists yet", () => {
    expect(
      buildStartSharingRequest(createHostRoomSnapshot(), {
        id: "screenmate-video-1",
        tabId: 42,
        frameId: 7,
      }),
    ).toEqual(
      {
        type: "screenmate:start-sharing",
        source: {
          kind: "tab-video",
          videoId: "screenmate-video-1",
          tabId: 42,
          frameId: 7,
        },
      },
    );
  });

  it("builds one active-tab start-sharing request when automatic follow is enabled", () => {
    expect(
      buildStartSharingRequest(createHostRoomSnapshot(), null, {
        autoAttach: true,
        sourceType: "auto",
      }),
    ).toEqual(
      {
        type: "screenmate:start-sharing",
        source: { kind: "active-tab-video" },
      },
    );
  });

  it("does not build source-less start requests for manual sniff mode", () => {
    expect(buildStartSharingRequest(createHostRoomSnapshot(), null)).toBeNull();
  });

  it("builds the same single tab-video request for an existing room", () => {
    expect(
      buildStartSharingRequest(
        createHostRoomSnapshot({
          roomLifecycle: "open",
          roomId: "room_123",
        }),
        {
          id: "screenmate-video-1",
          tabId: 42,
          frameId: 0,
        },
      ),
    ).toEqual(
      {
        type: "screenmate:start-sharing",
        source: {
          kind: "tab-video",
          videoId: "screenmate-video-1",
          tabId: 42,
          frameId: 0,
        },
      },
    );
    expect(buildStopSharingRequest()).toEqual({
      type: "screenmate:stop-room",
    });
    expect(buildStopSourceRequest()).toEqual({
      type: "screenmate:stop-source",
    });
  });

  it("trims room password requests before sending them to background", () => {
    expect(buildSetRoomPasswordRequest("  room_123  ")).toEqual({
      type: "screenmate:set-room-password",
      password: "room_123",
    });
  });

  it("reports invalid room password drafts before they are sent", () => {
    const message = "Contraseña inválida";

    expect(getRoomPasswordValidationMessage("abc", message)).toBe(message);
    expect(getRoomPasswordValidationMessage("bad password", message)).toBe(message);
    expect(getRoomPasswordValidationMessage("room_123", message)).toBeNull();
    expect(getRoomPasswordValidationMessage("   ", message)).toBeNull();
  });

  it("lets background restart a closed room through the same start-sharing request", () => {
    expect(
      buildStartSharingRequest(
        createHostRoomSnapshot({
          roomLifecycle: "closed",
          roomId: "room_123",
        }),
        {
          id: "screenmate-video-1",
          tabId: 42,
          frameId: 0,
        },
      ),
    ).toEqual(
      {
        type: "screenmate:start-sharing",
        source: {
          kind: "tab-video",
          videoId: "screenmate-video-1",
          tabId: 42,
          frameId: 0,
        },
      },
    );
  });

  it("builds prepared offscreen start-sharing requests", () => {
    expect(
      buildStartSharingRequest(createHostRoomSnapshot(), null, {
        sourceType: "screen",
        preparedSourceState: {
          status: "prepared-source",
          kind: "screen",
          ready: true,
          label: "Shared screen",
          metadata: null,
          captureType: "screen",
          error: null,
        },
      }),
    ).toEqual({
      type: "screenmate:start-sharing",
      source: {
        kind: "prepared-offscreen",
        sourceType: "screen",
      },
    });

    const uploadMetadata = {
      id: "local-demo",
      name: "demo.mp4",
      size: 4,
      type: "video/mp4",
      updatedAt: 123,
    };
    expect(
      buildStartSharingRequest(createHostRoomSnapshot(), null, {
        sourceType: "upload",
        preparedSourceState: {
          status: "prepared-source",
          kind: "upload",
          ready: true,
          label: "demo.mp4",
          fileId: "local-demo",
          metadata: uploadMetadata,
          error: null,
        },
      }),
    ).toEqual({
      type: "screenmate:start-sharing",
      source: {
        kind: "prepared-offscreen",
        sourceType: "upload",
        label: "demo.mp4",
        fileId: "local-demo",
        metadata: uploadMetadata,
      },
    });
  });
});

describe("waitForMinimumRefreshDuration", () => {
  it("waits for the remaining minimum refresh spinner time", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);

    await waitForMinimumRefreshDuration({
      elapsedMs: 120,
      minimumMs: 500,
      sleep,
    });

    expect(sleep).toHaveBeenCalledWith(380);
  });

  it("does not wait when refresh already exceeded the minimum spinner time", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);

    await waitForMinimumRefreshDuration({
      elapsedMs: 700,
      minimumMs: 500,
      sleep,
    });

    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("shouldRetryEmptyVideoList", () => {
  it("retries an empty video list only while there are scannable tabs and retry budget remains", () => {
    expect(
      shouldRetryEmptyVideoList({
        retryCount: 0,
        retryLimit: 5,
        scannableTabCount: 1,
      }),
    ).toBe(true);
  });

  it("does not retry when every browser tab was skipped as non-scannable", () => {
    expect(
      shouldRetryEmptyVideoList({
        retryCount: 0,
        retryLimit: 5,
        scannableTabCount: 0,
      }),
    ).toBe(false);
  });

  it("does not retry after the retry budget is exhausted", () => {
    expect(
      shouldRetryEmptyVideoList({
        retryCount: 5,
        retryLimit: 5,
        scannableTabCount: 1,
      }),
    ).toBe(false);
  });
});

describe("shouldRunQueuedSync", () => {
  it("does not rerun a queued refresh after the current run already forced a live scan", () => {
    expect(
      shouldRunQueuedSync({
        currentForceRefresh: true,
        hasQueuedSync: true,
        queuedForceRefresh: true,
      }),
    ).toBe(false);
  });

  it("runs a queued forced refresh after a non-forced sync", () => {
    expect(
      shouldRunQueuedSync({
        currentForceRefresh: false,
        hasQueuedSync: true,
        queuedForceRefresh: true,
      }),
    ).toBe(true);
  });

  it("does not run when no sync was queued", () => {
    expect(
      shouldRunQueuedSync({
        currentForceRefresh: false,
        hasQueuedSync: false,
        queuedForceRefresh: false,
      }),
    ).toBe(false);
  });
});

describe("resolveSelectedVideoKey", () => {
  const videos = [
    { id: "video-1", tabId: 42, frameId: 0, label: "Video 1" },
    { id: "video-2", tabId: 84, frameId: 0, label: "Video 2" },
  ];

  it("keeps a persisted selected video when it is still present", () => {
    expect(resolveSelectedVideoKey("84:0:video-2", videos)).toBe("84:0:video-2");
  });

  it("falls back to the first video when the selected video is missing", () => {
    expect(resolveSelectedVideoKey("99:0:missing", videos)).toBe("42:0:video-1");
  });
});

describe("resolvePopupSelectedVideoKey", () => {
  const videos = [
    { id: "video-1", tabId: 42, frameId: 0, label: "Video 1" },
    { id: "video-2", tabId: 84, frameId: 0, label: "Video 2" },
  ];

  it("keeps a desired selected video id even while the sniff list is temporarily missing it", () => {
    expect(
      resolvePopupSelectedVideoKey({
        currentSelectedVideoKey: "42:0:video-1",
        desiredSelectedVideoKey: "99:0:video-3",
        videos,
      }),
    ).toBe("99:0:video-3");
  });

  it("falls back to the first available video when there is no desired selection", () => {
    expect(
      resolvePopupSelectedVideoKey({
        currentSelectedVideoKey: "99:0:missing",
        desiredSelectedVideoKey: null,
        videos,
      }),
    ).toBe("42:0:video-1");
  });
});
