import { describe, expect, it } from "vitest";
import { normalizeIceServers } from "../src";

describe("normalizeIceServers", () => {
  it("keeps a stable ordered pool", () => {
    const servers = normalizeIceServers([
      { urls: ["stun:stun.cloudflare.com:3478"] },
      { urls: ["stun:stun.cloudflare.com:3478"] },
      { urls: ["stun:stun.l.google.com:19302"] },
    ]);

    expect(servers).toEqual([
      { urls: ["stun:stun.cloudflare.com:3478"] },
      { urls: ["stun:stun.l.google.com:19302"] },
    ]);
  });
});
