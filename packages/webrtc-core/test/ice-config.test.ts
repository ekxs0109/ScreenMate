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

  it("normalizes url shapes and removes blank or duplicate entries", () => {
    const servers = normalizeIceServers([
      {
        urls: [
          " stun:stun.cloudflare.com:3478 ",
          "",
          "turn:turn.screenmate.dev:3478",
          "turn:turn.screenmate.dev:3478",
          "https://example.com/not-ice",
          "   ",
        ],
        username: "viewer",
        credential: "secret",
      },
    ]);

    expect(servers).toEqual([
      {
        urls: [
          "stun:stun.cloudflare.com:3478",
          "turn:turn.screenmate.dev:3478",
        ],
        username: "viewer",
        credential: "secret",
      },
    ]);
  });

  it("dedupes semantically equivalent servers after normalization", () => {
    const servers = normalizeIceServers([
      {
        urls: " stun:stun.cloudflare.com:3478 ",
        username: "viewer",
        credential: "secret",
      },
      {
        urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:3478"],
        username: "viewer",
        credential: "secret",
      },
      {
        urls: ["turn:turn.screenmate.dev:3478?transport=udp"],
        username: "viewer",
        credential: "secret",
        credentialType: "password",
      },
    ]);

    expect(servers).toEqual([
      {
        urls: ["stun:stun.cloudflare.com:3478"],
        username: "viewer",
        credential: "secret",
      },
      {
        urls: ["turn:turn.screenmate.dev:3478?transport=udp"],
        username: "viewer",
        credential: "secret",
        credentialType: "password",
      },
    ]);
  });
});
