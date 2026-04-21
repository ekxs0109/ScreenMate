import { describe, expect, it } from "vitest";
import { nextPeerState } from "../src";

describe("nextPeerState", () => {
  it("moves from connecting to connected on success", () => {
    expect(nextPeerState("connecting", "connect")).toBe("connected");
  });

  it("moves to failed after a failure event", () => {
    expect(nextPeerState("connecting", "fail")).toBe("failed");
  });

  it("keeps the current state for unsupported transitions", () => {
    expect(nextPeerState("idle", "connect")).toBe("idle");
    expect(nextPeerState("closed", "begin")).toBe("closed");
  });
});
