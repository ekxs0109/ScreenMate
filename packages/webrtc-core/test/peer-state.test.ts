import { describe, expect, it } from "vitest";
import { nextPeerState } from "../src";

describe("nextPeerState", () => {
  it("moves from connecting to connected on success", () => {
    expect(nextPeerState("connecting", "connect")).toBe("connected");
  });

  it("moves to failed after a failure event", () => {
    expect(nextPeerState("connecting", "fail")).toBe("failed");
  });
});
