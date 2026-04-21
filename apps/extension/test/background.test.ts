import { describe, expect, it, vi } from "vitest";
import {
  createHostMessageHandler,
  createHostRuntimeMessageListener,
  type HostMessage,
} from "../entrypoints/background";

describe("createHostMessageHandler", () => {
  it("aggregates video lists from all reachable frames in the active tab", async () => {
    const queryActiveTabId = vi.fn().mockResolvedValue(42);
    const queryFrameIds = vi.fn().mockResolvedValue([0, 5]);
    const sendTabMessage = vi
      .fn()
      .mockImplementation(
        async (
          _tabId: number,
          message: HostMessage,
          options?: { frameId?: number },
        ) => {
          if (message.type !== "screenmate:list-videos") {
            return [];
          }

          if (options?.frameId === 5) {
            return [
              { id: "screenmate-video-1", label: "https://example.com/a.mp4" },
            ];
          }

          return [];
        },
      );
    const handler = createHostMessageHandler({
      queryActiveTabId,
      queryFrameIds,
      sendTabMessage,
    });

    const result = await handler({ type: "screenmate:list-videos" });

    expect(queryActiveTabId).toHaveBeenCalledTimes(1);
    expect(queryFrameIds).toHaveBeenCalledWith(42);
    expect(sendTabMessage).toHaveBeenCalledWith(
      42,
      { type: "screenmate:list-videos" },
      { frameId: 0 },
    );
    expect(sendTabMessage).toHaveBeenCalledWith(
      42,
      { type: "screenmate:list-videos" },
      { frameId: 5 },
    );
    expect(result).toEqual([
      {
        id: "screenmate-video-1",
        label: "https://example.com/a.mp4 [iframe #5]",
        frameId: 5,
      },
    ]);
  });

  it("returns the active hosting snapshot from the frame that owns the stream", async () => {
    const queryActiveTabId = vi.fn().mockResolvedValue(42);
    const queryFrameIds = vi.fn().mockResolvedValue([0, 3]);
    const sendTabMessage = vi
      .fn()
      .mockImplementation(
        async (
          _tabId: number,
          message: HostMessage,
          options?: { frameId?: number },
        ) => {
          if (message.type !== "screenmate:get-host-state") {
            return undefined;
          }

          if (options?.frameId === 3) {
            return {
              status: "hosting",
              roomId: "room_123",
              viewerCount: 0,
              errorMessage: null,
              sourceLabel: "Sample video",
            };
          }

          return {
            status: "idle",
            roomId: null,
            viewerCount: 0,
            errorMessage: null,
            sourceLabel: null,
          };
        },
      );
    const handler = createHostMessageHandler({
      queryActiveTabId,
      queryFrameIds,
      sendTabMessage,
    });

    const result = await handler({ type: "screenmate:get-host-state" });

    expect(queryActiveTabId).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      status: "hosting",
      roomId: "room_123",
      viewerCount: 0,
      errorMessage: null,
      sourceLabel: "Sample video",
    });
  });

  it("returns an explicit error when there is no active tab to start from", async () => {
    const handler = createHostMessageHandler({
      queryActiveTabId: vi.fn().mockResolvedValue(null),
      queryFrameIds: vi.fn(),
      sendTabMessage: vi.fn(),
    });

    const result = await handler({
      type: "screenmate:start-sharing",
      videoId: "screenmate-video-1",
      frameId: 0,
    });

    expect(result).toBeDefined();
    if (!result || Array.isArray(result) || "ok" in result) {
      throw new Error("Expected a snapshot result");
    }

    expect(result.status).toBe("idle");
    expect(result.errorMessage).toContain("active tab");
    expect(result.roomId).toBeNull();
  });

  it("ignores unrelated runtime messages", async () => {
    const handler = createHostMessageHandler({
      queryActiveTabId: vi.fn(),
      queryFrameIds: vi.fn(),
      sendTabMessage: vi.fn(),
    });

    const result = await handler({ type: "screenmate:other" } as unknown as HostMessage);

    expect(result).toBeUndefined();
  });

  it("routes start-sharing to the selected frame", async () => {
    const queryActiveTabId = vi.fn().mockResolvedValue(42);
    const queryFrameIds = vi.fn().mockResolvedValue([0, 7]);
    const sendTabMessage = vi.fn().mockResolvedValue({
      status: "starting",
      roomId: null,
      viewerCount: 0,
      errorMessage: null,
      sourceLabel: "Video in iframe",
    });
    const handler = createHostMessageHandler({
      queryActiveTabId,
      queryFrameIds,
      sendTabMessage,
    });

    const result = await handler({
      type: "screenmate:start-sharing",
      videoId: "screenmate-video-1",
      frameId: 7,
    });

    expect(sendTabMessage).toHaveBeenCalledWith(
      42,
      {
        type: "screenmate:start-sharing",
        videoId: "screenmate-video-1",
        frameId: 7,
      },
      { frameId: 7 },
    );
    expect(result).toEqual({
      status: "starting",
      roomId: null,
      viewerCount: 0,
      errorMessage: null,
      sourceLabel: "Video in iframe",
    });
  });

  it("broadcasts preview updates to every reachable frame", async () => {
    const queryActiveTabId = vi.fn().mockResolvedValue(42);
    const queryFrameIds = vi.fn().mockResolvedValue([0, 7]);
    const sendTabMessage = vi.fn().mockResolvedValue({ ok: true });
    const handler = createHostMessageHandler({
      queryActiveTabId,
      queryFrameIds,
      sendTabMessage,
    });

    const result = await handler({
      type: "screenmate:preview-video",
      videoId: "screenmate-video-1",
      frameId: 7,
      label: "Video in iframe",
    } as HostMessage);

    expect(sendTabMessage).toHaveBeenCalledWith(
      42,
      {
        type: "screenmate:preview-video",
        active: false,
        videoId: "screenmate-video-1",
        frameId: 7,
        label: "Video in iframe",
      },
      { frameId: 0 },
    );
    expect(sendTabMessage).toHaveBeenCalledWith(
      42,
      {
        type: "screenmate:preview-video",
        active: true,
        videoId: "screenmate-video-1",
        frameId: 7,
        label: "Video in iframe",
      },
      { frameId: 7 },
    );
    expect(result).toEqual({ ok: true });
  });

  it("broadcasts preview clearing to every reachable frame", async () => {
    const queryActiveTabId = vi.fn().mockResolvedValue(42);
    const queryFrameIds = vi.fn().mockResolvedValue([0, 7]);
    const sendTabMessage = vi.fn().mockResolvedValue({ ok: true });
    const handler = createHostMessageHandler({
      queryActiveTabId,
      queryFrameIds,
      sendTabMessage,
    });

    const result = await handler({ type: "screenmate:clear-preview" } as HostMessage);

    expect(sendTabMessage).toHaveBeenCalledWith(
      42,
      { type: "screenmate:clear-preview" },
      { frameId: 0 },
    );
    expect(sendTabMessage).toHaveBeenCalledWith(
      42,
      { type: "screenmate:clear-preview" },
      { frameId: 7 },
    );
    expect(result).toEqual({ ok: true });
  });

  it("surfaces an explicit error when no content-script frame responds", async () => {
    const handler = createHostMessageHandler({
      queryActiveTabId: vi.fn().mockResolvedValue(42),
      queryFrameIds: vi.fn().mockResolvedValue([0, 4]),
      sendTabMessage: vi.fn().mockRejectedValue(new Error("Receiving end does not exist.")),
    });

    const result = await handler({ type: "screenmate:get-host-state" });

    expect(result).toEqual({
      status: "idle",
      roomId: null,
      viewerCount: 0,
      errorMessage:
        "Could not reach the ScreenMate content script in the active tab: Receiving end does not exist.",
      sourceLabel: null,
    });
  });

  it("keeps the runtime message channel open and replies asynchronously", async () => {
    const handler = vi.fn().mockResolvedValue([
      {
        id: "screenmate-video-1",
        label: "https://example.com/a.mp4 [iframe #0]",
        frameId: 0,
      },
    ]);
    const listener = createHostRuntimeMessageListener(handler);
    const sendResponse = vi.fn();

    const keepChannelOpen = listener(
      { type: "screenmate:list-videos" },
      {} as never,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(sendResponse).toHaveBeenCalledWith([
      {
        id: "screenmate-video-1",
        label: "https://example.com/a.mp4 [iframe #0]",
        frameId: 0,
      },
    ]);
  });
});
