import { describe, expect, it } from "vitest";
import { buildViewerSceneModel } from "../src/viewer-scene-adapter";
import { createViewerMockState } from "../src/viewer-mock-state";
import { initialViewerSessionState } from "../src/lib/session-state";

describe("buildViewerSceneModel", () => {
  it("keeps real session state while filling sidebar data from mock state", () => {
    const scene = buildViewerSceneModel({
      locale: "ja",
      session: {
        ...initialViewerSessionState,
        roomId: "room_demo",
        status: "waiting",
        roomState: "hosting",
        sourceState: "recovering",
      },
      mock: createViewerMockState("ja"),
    });

    expect(scene.header.roomId).toBe("room_demo");
    expect(scene.player.waitingText).toBe("ホストの再接続を待っています");
    expect(scene.sidebar.messages.length).toBeGreaterThan(0);
    expect(scene.connection.typeLabel).toBe("直接接続 (P2P)");
  });
});
