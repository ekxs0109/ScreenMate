import { describe, expect, it } from "vitest";
import {
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
        payload: { state: "streaming" },
      }).success,
    ).toBe(true);
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
});

describe("roomStateSchema", () => {
  it("accepts the approved room lifecycle states", () => {
    expect(roomStateSchema.parse("hosting")).toBe("hosting");
    expect(roomStateSchema.parse("streaming")).toBe("streaming");
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
