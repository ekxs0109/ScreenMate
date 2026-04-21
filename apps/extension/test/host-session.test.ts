import { describe, expect, it } from "vitest";
import { createHostSessionStore } from "../entrypoints/content/host-session";

describe("createHostSessionStore", () => {
  it("starts idle with zero viewers", () => {
    const store = createHostSessionStore();
    expect(store.getSnapshot()).toEqual({
      status: "idle",
      roomId: null,
      viewerCount: 0,
    });
  });
});
