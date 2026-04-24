import { describe, expect, it } from "vitest";
import { createHostRoomSnapshot } from "../../entrypoints/background/host-room-snapshot";
import { buildExtensionSceneModel } from "../../entrypoints/popup/scene-adapter";
import { createExtensionMockState } from "../../entrypoints/popup/mock-state";

describe("buildExtensionSceneModel", () => {
  it("merges real host state with mock-backed popup sections", () => {
    const scene = buildExtensionSceneModel({
      snapshot: createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_demo",
        viewerCount: 2,
        sourceLabel: "Big Buck Bunny",
        activeTabId: 42,
        activeFrameId: 0,
      }),
      videos: [
        {
          id: "screenmate-video-1",
          tabId: 42,
          frameId: 0,
          label: "Big Buck Bunny",
        },
      ],
      selectedVideoId: "42:0:screenmate-video-1",
      isBusy: false,
      busyAction: null,
      viewerRoomUrl: "https://viewer.example/rooms/room_demo",
      mock: createExtensionMockState(),
    });

    expect(scene.header.statusText).toBe("Room open · attached");
    expect(scene.sourceTab.activeSourceType).toBe("sniff");
    expect(scene.sourceTab.sectionKinds).toEqual(["sniff", "screen", "upload"]);
    expect(scene.roomTab.roomId).toBe("room_demo");
    expect(scene.roomTab.viewerCount).toBe(2);
    expect(scene.roomTab.viewerDetails).toHaveLength(3);
    expect(scene.roomTab.shareUrl).toBe("https://viewer.example/rooms/room_demo");
    expect(scene.chatTab.messages[0]?.sender).toBe("System");
  });

  it("groups sniff videos by tab and hides blob URLs from card titles", () => {
    const scene = buildExtensionSceneModel({
      snapshot: createHostRoomSnapshot(),
      sniffTabs: [],
      videos: [
        {
          id: "screenmate-video-1",
          tabId: 42,
          frameId: 0,
          label: "blob:https://www.iqiyi.com/de338fda (not visible)",
          tabTitle: "爱奇艺 iQIYI-热门独播剧集在线观看",
          width: 1920,
          height: 1080,
        },
        {
          id: "screenmate-video-2",
          tabId: 84,
          frameId: 0,
          label: "https://example.com/movie.mp4",
          tabTitle: "Example",
        },
      ],
      selectedVideoId: null,
      isBusy: false,
      busyAction: null,
      viewerRoomUrl: null,
      mock: createExtensionMockState(),
    });

    expect(scene.sourceTab.sniffGroups).toEqual([
      expect.objectContaining({
        id: "tab-42",
        title: "标签 1 - 爱奇艺 iQIYI-热门独播剧集在线观看",
      }),
      expect.objectContaining({
        id: "tab-84",
        title: "标签 2 - Example",
      }),
    ]);
    expect(scene.sourceTab.sniffGroups[0]?.cards[0]?.title).toBe("视频 1");
    expect(scene.sourceTab.sniffGroups[0]?.cards[0]?.title).not.toContain("blob:");
  });

  it("does not invent a thumbnail when the page has no video poster", () => {
    const scene = buildExtensionSceneModel({
      snapshot: createHostRoomSnapshot(),
      sniffTabs: [],
      videos: [
        {
          id: "screenmate-video-1",
          tabId: 42,
          frameId: 0,
          label: "blob:https://www.iqiyi.com/de338fda (not visible)",
          tabTitle: "爱奇艺 iQIYI-热门独播剧集在线观看",
        },
      ],
      selectedVideoId: null,
      isBusy: false,
      busyAction: null,
      viewerRoomUrl: null,
      mock: createExtensionMockState(),
    });

    expect(scene.sourceTab.sniffCards[0]?.thumb).toBeNull();
  });

  it("uses the real page poster as the thumbnail when available", () => {
    const scene = buildExtensionSceneModel({
      snapshot: createHostRoomSnapshot(),
      sniffTabs: [],
      videos: [
        {
          id: "screenmate-video-1",
          tabId: 42,
          frameId: 0,
          label: "Video 1",
          posterUrl: "https://cdn.example.com/poster.jpg",
        },
      ],
      selectedVideoId: null,
      isBusy: false,
      busyAction: null,
      viewerRoomUrl: null,
      mock: createExtensionMockState(),
    });

    expect(scene.sourceTab.sniffCards[0]?.thumb).toBe("https://cdn.example.com/poster.jpg");
  });

  it("uses a captured frame thumbnail when the page has no poster", () => {
    const scene = buildExtensionSceneModel({
      snapshot: createHostRoomSnapshot(),
      sniffTabs: [],
      videos: [
        {
          id: "screenmate-video-1",
          tabId: 42,
          frameId: 0,
          label: "Video 1",
          thumbnailUrl: "data:image/webp;base64,frame",
        },
      ],
      selectedVideoId: null,
      isBusy: false,
      busyAction: null,
      viewerRoomUrl: null,
      mock: createExtensionMockState(),
    });

    expect(scene.sourceTab.sniffCards[0]?.thumb).toBe("data:image/webp;base64,frame");
  });

  it("keeps scanned tabs in the resource list even when they have no videos", () => {
    const scene = buildExtensionSceneModel({
      snapshot: createHostRoomSnapshot(),
      sniffTabs: [
        { tabId: 42, title: "Bilibili" },
        { tabId: 84, title: "No video tab" },
      ],
      videos: [
        {
          id: "screenmate-video-1",
          tabId: 42,
          frameId: 0,
          label: "Video 1",
          tabTitle: "Bilibili",
        },
      ],
      selectedVideoId: null,
      isBusy: false,
      busyAction: null,
      viewerRoomUrl: null,
      mock: createExtensionMockState(),
    });

    expect(scene.sourceTab.sniffGroups).toEqual([
      expect.objectContaining({
        tabId: 42,
        title: "标签 1 - Bilibili",
        cards: [expect.objectContaining({ title: "Video 1" })],
      }),
      expect.objectContaining({
        tabId: 84,
        title: "标签 2 - No video tab",
        cards: [],
      }),
    ]);
  });
});
