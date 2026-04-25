import { describe, expect, it } from "vitest";
import { getPopupViewModel } from "../../entrypoints/popup/view-model";

describe("getPopupViewModel", () => {
  it("shows attach copy when the room is open but no video is attached", () => {
    expect(
      getPopupViewModel({
        roomLifecycle: "open",
        sourceState: "missing",
        roomId: "room_123",
        viewerCount: 2,
        viewerRoster: [],
        chatMessages: [],
        sourceLabel: null,
        activeTabId: 42,
        activeFrameId: 0,
        recoverByTimestamp: null,
        message: "No video attached.",
      }),
    ).toEqual({
      primaryActionLabel: "Attach selected video",
      statusText: "Room open · No video attached",
      canStop: true,
    });
  });

  it("treats a closed room with a stale room id as restartable", () => {
    expect(
      getPopupViewModel({
        roomLifecycle: "closed",
        sourceState: "missing",
        roomId: "room_123",
        viewerCount: 0,
        viewerRoster: [],
        chatMessages: [],
        sourceLabel: null,
        activeTabId: 42,
        activeFrameId: 0,
        recoverByTimestamp: null,
        message: "Room closed.",
      }),
    ).toEqual({
      primaryActionLabel: "Start room",
      statusText: "Room closed · missing",
      canStop: false,
    });
  });
});
