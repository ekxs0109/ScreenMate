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
    expect(scene.sourceTab.activeSourceType).toBe("auto");
    expect(scene.sourceTab.activeSourceIndicator).toBe("sniff");
    expect(scene.sourceTab.sectionKinds).toEqual(["auto", "sniff", "screen", "upload"]);
    expect(scene.roomTab.roomId).toBe("room_demo");
    expect(scene.roomTab.viewerCount).toBe(2);
    expect(scene.roomTab.viewerDetails).toHaveLength(0);
    expect(scene.roomTab.shareUrl).toBe("https://viewer.example/rooms/room_demo");
    expect(scene.chatTab.messages).toHaveLength(0);
  });

  it("reports automatic follow state and unblocks the primary action in sniff mode", () => {
    const scene = buildExtensionSceneModel({
      snapshot: createHostRoomSnapshot(),
      videos: [],
      selectedVideoId: null,
      isBusy: false,
      busyAction: null,
      viewerRoomUrl: null,
      followActiveTabVideo: true,
      mock: { ...createExtensionMockState(), activeSourceType: "sniff" },
    });

    expect(scene.sourceTab.followActiveTabVideo).toBe(true);
    expect(scene.header.playback.mode).toBe("auto");
    expect(scene.footer).toEqual({
      variant: "start-room",
      disabled: false,
      busy: false,
    });
  });

  it("marks auto as the active source indicator only after an auto-follow source is attached", () => {
    const scene = buildExtensionSceneModel({
      snapshot: createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_demo",
        activeTabId: 42,
        activeFrameId: 0,
        sourceLabel: "Active tab video",
      }),
      videos: [],
      selectedVideoId: null,
      isBusy: false,
      busyAction: null,
      viewerRoomUrl: "https://viewer.example/rooms/room_demo",
      followActiveTabVideo: true,
      mock: createExtensionMockState(),
    });

    expect(scene.sourceTab.activeSourceIndicator).toBe("auto");
  });

  it("marks offscreen screen as active only when the attached source is offscreen", () => {
    const scene = buildExtensionSceneModel({
      snapshot: createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_demo",
        activeTabId: -1,
        activeFrameId: -1,
        sourceLabel: "Shared screen",
      }),
      videos: [],
      selectedVideoId: null,
      isBusy: false,
      busyAction: null,
      viewerRoomUrl: "https://viewer.example/rooms/room_demo",
      preparedSourceState: {
        status: "prepared-source",
        kind: "screen",
        ready: true,
        label: "Shared screen",
        metadata: null,
        captureType: "screen",
        error: null,
      },
      mock: { ...createExtensionMockState(), activeSourceType: "upload" },
    });

    expect(scene.sourceTab.activeSourceType).toBe("upload");
    expect(scene.sourceTab.activeSourceIndicator).toBe("screen");
  });

  it("keeps the offscreen indicator on the attached screen source when another source is only prepared", () => {
    const scene = buildExtensionSceneModel({
      snapshot: createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_demo",
        activeTabId: -1,
        activeFrameId: -1,
        sourceLabel: "Shared screen",
      }),
      videos: [],
      selectedVideoId: null,
      isBusy: false,
      busyAction: null,
      viewerRoomUrl: "https://viewer.example/rooms/room_demo",
      preparedSourceState: {
        status: "prepared-source",
        kind: "upload",
        ready: true,
        label: "next-video.mp4",
        metadata: {
          id: "local-next",
          name: "next-video.mp4",
          size: 12,
          type: "video/mp4",
          updatedAt: 123,
        },
        fileId: "local-next",
        error: null,
      },
      mock: { ...createExtensionMockState(), activeSourceType: "upload" },
    });

    expect(scene.sourceTab.uploadReady).toBe(true);
    expect(scene.sourceTab.activeSourceIndicator).toBe("screen");
  });

  it("keeps manual sniff mode disabled until a video is selected", () => {
    const scene = buildExtensionSceneModel({
      snapshot: createHostRoomSnapshot(),
      videos: [],
      selectedVideoId: null,
      isBusy: false,
      busyAction: null,
      viewerRoomUrl: null,
      mock: { ...createExtensionMockState(), activeSourceType: "sniff" },
    });

    expect(scene.footer).toEqual({
      variant: "start-room",
      disabled: true,
      busy: false,
    });
  });

  it("does not treat stale popup screenReady mock state as a prepared screen source", () => {
    const scene = buildExtensionSceneModel({
      snapshot: createHostRoomSnapshot(),
      videos: [],
      selectedVideoId: null,
      isBusy: false,
      busyAction: null,
      viewerRoomUrl: null,
      mock: {
        ...createExtensionMockState(),
        activeSourceType: "screen",
        screenReady: true,
      },
    });

    expect(scene.sourceTab.screenReady).toBe(false);
    expect(scene.footer).toEqual({
      variant: "start-room",
      disabled: true,
      busy: false,
    });
  });

  it("prefers real room roster and chat over popup mock activity", () => {
    const scene = buildExtensionSceneModel({
      snapshot: createHostRoomSnapshot({
        roomLifecycle: "open",
        sourceState: "attached",
        roomId: "room_demo",
        viewerCount: 1,
        viewerRoster: [
          {
            viewerSessionId: "viewer_1",
            displayName: "Mina",
            online: true,
            connectionType: "direct",
            pingMs: 24,
            joinedAt: 1,
            profileUpdatedAt: 2,
            metricsUpdatedAt: 3,
          },
          {
            viewerSessionId: "viewer_2",
            displayName: "Noor",
            online: true,
            connectionType: "relay",
            pingMs: 119,
            joinedAt: 4,
            profileUpdatedAt: null,
            metricsUpdatedAt: 5,
          },
          {
            viewerSessionId: "viewer_3",
            displayName: "Sol",
            online: true,
            connectionType: "unknown",
            pingMs: null,
            joinedAt: 6,
            profileUpdatedAt: null,
            metricsUpdatedAt: null,
          },
          {
            viewerSessionId: "viewer_4",
            displayName: "Noor",
            online: false,
            connectionType: "relay",
            pingMs: null,
            joinedAt: 4,
            profileUpdatedAt: null,
            metricsUpdatedAt: null,
          },
        ],
        chatMessages: [
          {
            messageId: "msg_1",
            senderSessionId: "viewer_1",
            senderRole: "viewer",
            senderName: "Mina",
            text: "hello room",
            sentAt: 10,
          },
          {
            messageId: "msg_2",
            senderSessionId: "host_1",
            senderRole: "host",
            senderName: "Ignored",
            text: "hello back",
            sentAt: 11,
          },
        ],
      }),
      videos: [],
      selectedVideoId: null,
      isBusy: false,
      busyAction: null,
      viewerRoomUrl: "https://viewer.example/rooms/room_demo",
      mock: createExtensionMockState(),
    });

    expect(scene.roomTab.viewerCount).toBe(1);
    expect(scene.roomTab.viewerDetails).toEqual([
      {
        id: "viewer_1",
        name: "Mina",
        online: true,
        connType: "P2P",
        ping: "24ms",
        isGood: true,
      },
      {
        id: "viewer_2",
        name: "Noor",
        online: true,
        connType: "Relay",
        ping: "119ms",
        isGood: true,
      },
      {
        id: "viewer_3",
        name: "Sol",
        online: true,
        connType: "--",
        ping: "--",
        isGood: true,
      },
      {
        id: "viewer_4",
        name: "Noor",
        online: false,
        connType: "Offline",
        ping: "--",
        isGood: false,
      },
    ]);
    expect(scene.chatTab.messages).toEqual([
      {
        id: "msg_1",
        sender: "Mina",
        text: "hello room",
      },
      {
        id: "msg_2",
        sender: "Host",
        text: "hello back",
      },
    ]);
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
