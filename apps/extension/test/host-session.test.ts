import { describe, expect, it } from "vitest";
import { createHostSessionStore } from "../entrypoints/content/host-session";

describe("createHostSessionStore", () => {
  it("starts idle with zero viewers", () => {
    const store = createHostSessionStore();
    expect(store.getSnapshot()).toEqual({
      status: "idle",
      roomId: null,
      viewerCount: 0,
      errorMessage: null,
      sourceLabel: null,
    });
  });

  it("tracks room, viewer count, source label, and errors", () => {
    const store = createHostSessionStore();

    store.beginStarting("Big Buck Bunny");
    store.setRoom("room_123");
    store.setViewerCount(2);
    store.setError("Signaling disconnected", "degraded");

    expect(store.getSnapshot()).toEqual({
      status: "degraded",
      roomId: "room_123",
      viewerCount: 2,
      errorMessage: "Signaling disconnected",
      sourceLabel: "Big Buck Bunny",
    });
  });
});
