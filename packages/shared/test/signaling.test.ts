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

  it("rejects a viewer pretending to be host", () => {
    const result = signalEnvelopeSchema.safeParse({
      roomId: "room_123",
      sessionId: "viewer_1",
      role: "viewer",
      messageType: "host-left",
      timestamp: 1,
      payload: {},
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
