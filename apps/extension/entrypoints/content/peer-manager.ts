import { nextPeerState, type PeerState } from "@screenmate/webrtc-core";

export function createPeerRegistry() {
  const peers = new Map<string, PeerState>();

  return {
    begin(sessionId: string) {
      peers.set(sessionId, nextPeerState("idle", "begin"));
    },
    connected(sessionId: string) {
      peers.set(sessionId, nextPeerState("connecting", "connect"));
    },
    snapshot() {
      return Array.from(peers.entries());
    },
  };
}
