import { describe, expect, it } from "vitest";
import {
  roomSourceStateSchema,
  roomStateSchema,
  signalEnvelopeSchema,
  tokenPayloadSchema,
} from "../src";

describe("signalEnvelopeSchema", () => {
  it("accepts a host offer envelope", () => {
    const result = signalEnvelopeSchema.safeParse({
      roomId: "room_123",
      sessionId: "host_1",
      role: "host",
      messageType: "offer",
      timestamp: 1,
      payload: { targetSessionId: "viewer_1", sdp: "v=0" },
    });

    expect(result.success).toBe(true);
  });

  it("accepts the required presence, negotiation, and health message families", () => {
    expect(
      signalEnvelopeSchema.safeParse({
        roomId: "room_123",
        sessionId: "host_1",
        role: "host",
        messageType: "host-connected",
        timestamp: 1,
        payload: { viewerCount: 0 },
      }).success,
    ).toBe(true);

    expect(
      signalEnvelopeSchema.safeParse({
        roomId: "room_123",
        sessionId: "viewer_1",
        role: "viewer",
        messageType: "viewer-joined",
        timestamp: 2,
        payload: { viewerSessionId: "viewer_1" },
      }).success,
    ).toBe(true);

    expect(
      signalEnvelopeSchema.safeParse({
        roomId: "room_123",
        sessionId: "viewer_1",
        role: "viewer",
        messageType: "viewer-left",
        timestamp: 3,
        payload: { viewerSessionId: "viewer_1" },
      }).success,
    ).toBe(true);

    expect(
      signalEnvelopeSchema.safeParse({
        roomId: "room_123",
        sessionId: "host_1",
        role: "host",
        messageType: "host-left",
        timestamp: 4,
        payload: { reason: "stopped-sharing" },
      }).success,
    ).toBe(true);

    expect(
      signalEnvelopeSchema.safeParse({
        roomId: "room_123",
        sessionId: "host_1",
        role: "host",
        messageType: "room-closed",
        timestamp: 5,
        payload: { reason: "host-left" },
      }).success,
    ).toBe(true);

    expect(
      signalEnvelopeSchema.safeParse({
        roomId: "room_123",
        sessionId: "viewer_1",
        role: "viewer",
        messageType: "answer",
        timestamp: 6,
        payload: { targetSessionId: "host_1", sdp: "v=0" },
      }).success,
    ).toBe(true);

    expect(
      signalEnvelopeSchema.safeParse({
        roomId: "room_123",
        sessionId: "host_1",
        role: "host",
        messageType: "ice-candidate",
        timestamp: 7,
        payload: { targetSessionId: "viewer_1", candidate: "candidate:1" },
      }).success,
    ).toBe(true);

    expect(
      signalEnvelopeSchema.safeParse({
        roomId: "room_123",
        sessionId: "host_1",
        role: "host",
        messageType: "negotiation-failed",
        timestamp: 8,
        payload: { targetSessionId: "viewer_1", code: "sdp-timeout" },
      }).success,
    ).toBe(true);

    expect(
      signalEnvelopeSchema.safeParse({
        roomId: "room_123",
        sessionId: "viewer_1",
        role: "viewer",
        messageType: "heartbeat",
        timestamp: 9,
        payload: { sequence: 1 },
      }).success,
    ).toBe(true);

    expect(
      signalEnvelopeSchema.safeParse({
        roomId: "room_123",
        sessionId: "viewer_2",
        role: "viewer",
        messageType: "reconnect",
        timestamp: 10,
        payload: { previousSessionId: "viewer_1" },
      }).success,
    ).toBe(true);

    expect(
      signalEnvelopeSchema.safeParse({
        roomId: "room_123",
        sessionId: "host_1",
        role: "host",
        messageType: "room-state",
        timestamp: 11,
        payload: {
          state: "streaming",
          sourceState: "attached",
          viewerCount: 0,
        },
      }).success,
    ).toBe(true);
  });

  it("accepts room activity envelopes", () => {
    expect(
      signalEnvelopeSchema.safeParse({
        roomId: "room_123",
        sessionId: "viewer_1",
        role: "viewer",
        messageType: "viewer-profile",
        timestamp: 1,
        payload: {
          viewerSessionId: "viewer_1",
          displayName: "Mina",
        },
      }).success,
    ).toBe(true);

    expect(
      signalEnvelopeSchema.safeParse({
        roomId: "room_123",
        sessionId: "viewer_1",
        role: "viewer",
        messageType: "viewer-metrics",
        timestamp: 2,
        payload: {
          viewerSessionId: "viewer_1",
          connectionType: "relay",
          pingMs: 142,
        },
      }).success,
    ).toBe(true);

    expect(
      signalEnvelopeSchema.safeParse({
        roomId: "room_123",
        sessionId: "viewer_1",
        role: "viewer",
        messageType: "chat-message",
        timestamp: 3,
        payload: {
          text: "hello room",
        },
      }).success,
    ).toBe(true);

    expect(
      signalEnvelopeSchema.safeParse({
        roomId: "room_123",
        sessionId: "host_1",
        role: "host",
        messageType: "viewer-roster",
        timestamp: 4,
        payload: {
          viewers: [
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
          ],
        },
      }).success,
    ).toBe(true);

    expect(
      signalEnvelopeSchema.safeParse({
        roomId: "room_123",
        sessionId: "host_1",
        role: "host",
        messageType: "chat-history",
        timestamp: 5,
        payload: {
          messages: [
            {
              messageId: "msg_1",
              senderSessionId: "viewer_1",
              senderRole: "viewer",
              senderName: "Mina",
              text: "hello room",
              sentAt: 3,
            },
          ],
        },
      }).success,
    ).toBe(true);

    expect(
      signalEnvelopeSchema.safeParse({
        roomId: "room_123",
        sessionId: "host_1",
        role: "host",
        messageType: "chat-message-created",
        timestamp: 6,
        payload: {
          messageId: "msg_1",
          senderSessionId: "viewer_1",
          senderRole: "viewer",
          senderName: "Mina",
          text: "hello room",
          sentAt: 3,
        },
      }).success,
    ).toBe(true);
  });

  it("rejects invalid room activity payloads", () => {
    expect(
      signalEnvelopeSchema.safeParse({
        roomId: "room_123",
        sessionId: "viewer_1",
        role: "viewer",
        messageType: "viewer-profile",
        timestamp: 1,
        payload: {
          viewerSessionId: "",
          displayName: "",
        },
      }).success,
    ).toBe(false);

    expect(
      signalEnvelopeSchema.safeParse({
        roomId: "room_123",
        sessionId: "viewer_1",
        role: "viewer",
        messageType: "viewer-metrics",
        timestamp: 2,
        payload: {
          viewerSessionId: "viewer_1",
          connectionType: "satellite",
          pingMs: -1,
        },
      }).success,
    ).toBe(false);

    expect(
      signalEnvelopeSchema.safeParse({
        roomId: "room_123",
        sessionId: "host_1",
        role: "host",
        messageType: "chat-message",
        timestamp: 3,
        payload: {
          text: "x".repeat(501),
        },
      }).success,
    ).toBe(false);

    expect(
      signalEnvelopeSchema.safeParse({
        roomId: "room_123",
        sessionId: "host_1",
        role: "host",
        messageType: "chat-message-created",
        timestamp: 4,
        payload: {
          messageId: "msg_1",
          text: "missing sender fields",
        },
      }).success,
    ).toBe(false);
  });

  it("rejects a viewer pretending to send a host-only message", () => {
    const result = signalEnvelopeSchema.safeParse({
      roomId: "room_123",
      sessionId: "viewer_1",
      role: "viewer",
      messageType: "host-left",
      timestamp: 1,
      payload: { reason: "stopped-sharing" },
    });

    expect(result.success).toBe(false);
  });

  it("requires sourceState and viewerCount in room-state envelopes", () => {
    const result = signalEnvelopeSchema.safeParse({
      roomId: "room_123",
      sessionId: "host_1",
      role: "host",
      messageType: "room-state",
      timestamp: 11,
      payload: {
        state: "degraded",
        sourceState: "recovering",
        viewerCount: 2,
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects room-state envelopes missing sourceState", () => {
    const result = signalEnvelopeSchema.safeParse({
      roomId: "room_123",
      sessionId: "host_1",
      role: "host",
      messageType: "room-state",
      timestamp: 11,
      payload: {
        state: "degraded",
        viewerCount: 2,
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects room-state envelopes missing viewerCount", () => {
    const result = signalEnvelopeSchema.safeParse({
      roomId: "room_123",
      sessionId: "host_1",
      role: "host",
      messageType: "room-state",
      timestamp: 11,
      payload: {
        state: "degraded",
        sourceState: "recovering",
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects invalid room-state viewer counts", () => {
    expect(
      signalEnvelopeSchema.safeParse({
        roomId: "room_123",
        sessionId: "host_1",
        role: "host",
        messageType: "room-state",
        timestamp: 11,
        payload: {
          state: "degraded",
          sourceState: "recovering",
          viewerCount: -1,
        },
      }).success,
    ).toBe(false);

    expect(
      signalEnvelopeSchema.safeParse({
        roomId: "room_123",
        sessionId: "host_1",
        role: "host",
        messageType: "room-state",
        timestamp: 11,
        payload: {
          state: "degraded",
          sourceState: "recovering",
          viewerCount: 1.5,
        },
      }).success,
    ).toBe(false);
  });

  it("rejects invalid room source states in room-state envelopes", () => {
    const result = signalEnvelopeSchema.safeParse({
      roomId: "room_123",
      sessionId: "host_1",
      role: "host",
      messageType: "room-state",
      timestamp: 11,
      payload: {
        state: "degraded",
        sourceState: "reattaching",
        viewerCount: 2,
      },
    });

    expect(result.success).toBe(false);
  });
});

describe("roomStateSchema", () => {
  it("accepts the approved room lifecycle states", () => {
    expect(roomStateSchema.parse("hosting")).toBe("hosting");
    expect(roomStateSchema.parse("streaming")).toBe("streaming");
  });
});

describe("roomSourceStateSchema", () => {
  it("exports the approved room source states", () => {
    expect(roomSourceStateSchema.parse("attached")).toBe("attached");
    expect(roomSourceStateSchema.parse("recovering")).toBe("recovering");
    expect(roomSourceStateSchema.parse("missing")).toBe("missing");
  });
});

describe("tokenPayloadSchema", () => {
  it("requires room and role scope", () => {
    const result = tokenPayloadSchema.safeParse({
      roomId: "room_123",
      role: "viewer",
      sessionId: "viewer_1",
      exp: 100,
    });

    expect(result.success).toBe(true);
  });
});
