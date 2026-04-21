import { nextPeerState, type PeerState } from "@screenmate/webrtc-core";

export type ManagedPeer<Connection> = {
  connection: Connection;
  state: PeerState;
};

export function createPeerRegistry<Connection extends { close(): void }>() {
  const peers = new Map<string, ManagedPeer<Connection>>();

  return {
    begin(sessionId: string, connection: Connection) {
      peers.set(sessionId, {
        connection,
        state: nextPeerState("idle", "begin"),
      });
    },
    connected(sessionId: string) {
      const peer = peers.get(sessionId);
      if (!peer) {
        return;
      }

      peers.set(sessionId, {
        ...peer,
        state: nextPeerState(peer.state, "connect"),
      });
    },
    failed(sessionId: string) {
      const peer = peers.get(sessionId);
      if (!peer) {
        return;
      }

      peers.set(sessionId, {
        ...peer,
        state: nextPeerState(peer.state, "fail"),
      });
    },
    get(sessionId: string) {
      return peers.get(sessionId);
    },
    remove(sessionId: string) {
      const peer = peers.get(sessionId);
      peer?.connection.close();
      peers.delete(sessionId);
    },
    closeAll() {
      for (const peer of peers.values()) {
        peer.connection.close();
      }

      peers.clear();
    },
    size() {
      return peers.size;
    },
    snapshot() {
      return Array.from(peers.entries()).map(([sessionId, peer]) => [
        sessionId,
        peer.state,
      ] as const);
    },
  };
}
