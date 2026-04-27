import { describe, expect, it } from "vitest";
import { buildViewerSceneModel } from "../src/viewer-scene-adapter";
import { createViewerMockState } from "../src/viewer-mock-state";
import { initialViewerSessionState } from "../src/lib/session-state";

describe("buildViewerSceneModel", () => {
  it("uses fixed pre-join connection defaults before room activity exists", () => {
    const scene = buildViewerSceneModel({
      locale: "en",
      session: initialViewerSessionState,
      mock: createViewerMockState("en"),
    });

    expect(scene.connection.typeLabel).toBe("Direct (P2P)");
    expect(scene.connection.pingLabel).toBe("--");
  });

  it("keeps real session state and renders empty real activity after joining", () => {
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
    expect(scene.sidebar.messages).toEqual([]);
    expect(scene.connection.typeLabel).toBe("--");
  });

  it("uses real room activity after joining", () => {
    const scene = buildViewerSceneModel({
      locale: "en",
      session: {
        ...initialViewerSessionState,
        roomId: "room_demo",
        sessionId: "viewer_1",
        status: "connected",
        displayName: "Mina",
        localConnectionType: "relay",
        localPingMs: 24,
        localVideoCodec: "AV1",
        viewerRoster: [
          {
            viewerSessionId: "viewer_1",
            displayName: "Mina",
            online: true,
            connectionType: "relay",
            pingMs: 24,
            joinedAt: 1,
            profileUpdatedAt: 2,
            metricsUpdatedAt: 3,
          },
        ],
        chatMessages: [
          {
            messageId: "msg_1",
            senderSessionId: "host_1",
            senderRole: "host",
            senderName: "Presenter Mina",
            text: "Welcome",
            sentAt: 1_776_000_000_000,
          },
        ],
      },
      mock: createViewerMockState("en"),
    });

    expect(scene.sidebar.username).toBe("Mina");
    expect(scene.sidebar.viewerCount).toBe(1);
    expect(scene.connection.typeLabel).toBe("Relay");
    expect(scene.connection.pingLabel).toBe("24ms");
    expect(scene.connection.videoCodecLabel).toBe("AV1");
    expect(scene.sidebar.messages).toEqual([
      expect.objectContaining({
        id: "msg_1",
        senderKind: "host",
        sender: "Host",
        text: "Welcome",
      }),
    ]);
  });
});
