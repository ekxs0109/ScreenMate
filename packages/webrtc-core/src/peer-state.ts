export type PeerState = "idle" | "connecting" | "connected" | "failed" | "closed";
export type PeerEvent = "begin" | "connect" | "fail" | "close";

const transitions: Record<PeerState, Partial<Record<PeerEvent, PeerState>>> = {
  idle: { begin: "connecting", close: "closed" },
  connecting: { connect: "connected", fail: "failed", close: "closed" },
  connected: { fail: "failed", close: "closed" },
  failed: { begin: "connecting", close: "closed" },
  closed: {},
};

export function nextPeerState(state: PeerState, event: PeerEvent): PeerState {
  return transitions[state][event] ?? state;
}
