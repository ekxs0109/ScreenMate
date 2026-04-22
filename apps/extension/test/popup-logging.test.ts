import { describe, expect, it, vi } from "vitest";
import {
  createHostSnapshot,
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
