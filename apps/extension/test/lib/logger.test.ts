import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../../lib/logger";

describe("createLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints log details as copyable JSON", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createLogger("popup");

    logger.info("Synced page videos.", {
      firstRawVideo: { id: "video-1", tabId: 42 },
      rawLength: 1,
    });

    expect(log).toHaveBeenCalledWith(
      "[ScreenMate:popup] Synced page videos.",
      '{"firstRawVideo":{"id":"video-1","tabId":42},"rawLength":1}',
    );
  });

  it("serializes circular details without throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logger = createLogger("background");
    const details: { self?: unknown } = {};
    details.self = details;

    logger.warn("Could not list videos in frame.", details);

    expect(warn).toHaveBeenCalledWith(
      "[ScreenMate:background] Could not list videos in frame.",
      '{"self":"[Circular]"}',
    );
  });

  it("truncates data URLs and long strings in JSON details", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createLogger("popup");
    const dataUrl = `data:image/webp;base64,${"a".repeat(800)}`;

    logger.info("Synced video sniff state.", {
      thumbnailUrl: dataUrl,
      label: "x".repeat(600),
    });

    expect(log).toHaveBeenCalledWith(
      "[ScreenMate:popup] Synced video sniff state.",
      expect.stringContaining("[truncated:823]"),
    );
    expect(log).toHaveBeenCalledWith(
      "[ScreenMate:popup] Synced video sniff state.",
      expect.stringContaining("...[truncated:600]"),
    );
    expect(log.mock.calls[0]?.[1]).not.toContain("a".repeat(600));
  });
});
