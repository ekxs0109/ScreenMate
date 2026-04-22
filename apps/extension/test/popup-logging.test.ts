import { describe, expect, it, vi } from "vitest";
import {
  buildStartSharingRequests,
  buildStopSharingRequest,
  createHostSnapshot,
  normalizeSnapshot,
  reportStartSharingResult,
  type HostSnapshot,
  type PopupLogger,
} from "../entrypoints/popup/useHostControls";

function createLoggerDouble(): PopupLogger {
  return {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
}

describe("reportStartSharingResult", () => {
  it("logs error snapshots with error severity", () => {
    const logger = createLoggerDouble();
    const snapshot: HostSnapshot = createHostSnapshot({
      errorMessage: "Failed to fetch",
      sourceLabel: "blob:https://example.com/video",
    });

    reportStartSharingResult(logger, snapshot, snapshot);

    expect(logger.error).toHaveBeenCalledWith(
      "Start sharing returned an error snapshot.",
      expect.objectContaining({
        errorMessage: "Failed to fetch",
        status: "idle",
      }),
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("logs successful snapshots with info severity", () => {
    const logger = createLoggerDouble();
    const snapshot: HostSnapshot = createHostSnapshot({
      roomId: "room_123",
      sourceLabel: "Video 1",
      status: "hosting",
    });

    reportStartSharingResult(logger, snapshot, snapshot);

    expect(logger.info).toHaveBeenCalledWith(
      "Start sharing returned a snapshot.",
      expect.objectContaining({
        roomId: "room_123",
        status: "hosting",
      }),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe("normalizeSnapshot", () => {
  it("maps room-runtime snapshots into popup compatibility state", () => {
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
      status: "streaming",
      roomId: "room_123",
      viewerCount: 2,
      errorMessage: null,
      sourceLabel: "Video 1",
    });
  });
});

describe("popup compatibility messages", () => {
  it("builds room-start then attach requests when no room exists yet", () => {
    expect(
      buildStartSharingRequests(createHostSnapshot(), {
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
        createHostSnapshot({
          roomId: "room_123",
          status: "hosting",
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
});
