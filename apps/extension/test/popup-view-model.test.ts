import { describe, expect, it } from "vitest";
import { getPopupViewModel } from "../entrypoints/popup/view-model";

describe("getPopupViewModel", () => {
  it("shows attach copy when the room is open but no video is attached", () => {
    expect(
      getPopupViewModel({
        roomLifecycle: "open",
        sourceState: "missing",
        roomId: "room_123",
        viewerCount: 2,
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
});
