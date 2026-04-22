import { describe, expect, it, vi } from "vitest";
import {
  buildStartSharingRequests,
  buildStopSharingRequest,
  normalizeSnapshot,
  reportRoomActionResult,
  type PopupLogger,
} from "../entrypoints/popup/useHostControls";
import { createHostRoomSnapshot } from "../entrypoints/background/host-room-snapshot";

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
      sourceLabel: "Video 1",
      activeTabId: null,
      activeFrameId: null,
      recoverByTimestamp: null,
      message: null,
    });
  });
});

describe("popup room action messages", () => {
  it("builds room-start then attach requests when no room exists yet", () => {
    expect(
      buildStartSharingRequests(createHostRoomSnapshot(), {
        id: "screenmate-video-1",
        frameId: 7,
      }),
    ).toEqual([
      {
        type: "screenmate:start-room",
        frameId: 7,
      },
      {
        type: "screenmate:attach-source",
        videoId: "screenmate-video-1",
        frameId: 7,
      },
    ]);
  });

  it("builds attach-only and stop-room requests for an existing room", () => {
    expect(
      buildStartSharingRequests(
        createHostRoomSnapshot({
          roomLifecycle: "open",
          roomId: "room_123",
        }),
        {
          id: "screenmate-video-1",
          frameId: 0,
        },
      ),
    ).toEqual([
      {
        type: "screenmate:attach-source",
        videoId: "screenmate-video-1",
        frameId: 0,
      },
    ]);
    expect(buildStopSharingRequest()).toEqual({
      type: "screenmate:stop-room",
    });
  });

  it("restarts a closed room before attaching a source", () => {
    expect(
      buildStartSharingRequests(
        createHostRoomSnapshot({
          roomLifecycle: "closed",
          roomId: "room_123",
        }),
        {
          id: "screenmate-video-1",
          frameId: 0,
        },
      ),
    ).toEqual([
      {
        type: "screenmate:start-room",
        frameId: 0,
      },
      {
        type: "screenmate:attach-source",
        videoId: "screenmate-video-1",
        frameId: 0,
      },
    ]);
  });
});
