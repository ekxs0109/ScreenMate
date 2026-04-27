import { describe, expect, it } from "vitest";
import {
  collectViewerPeerMetrics,
  type PeerConnectionLike,
} from "../src/lib/peer-client";

function createPeerConnectionWithStats(reports: Array<Record<string, unknown>>) {
  return {
    async getStats() {
      return new Map(reports.map((report) => [String(report.id), report]));
    },
  } as unknown as PeerConnectionLike;
}

describe("collectViewerPeerMetrics", () => {
  it("reports relay metrics from the selected candidate pair", async () => {
    await expect(
      collectViewerPeerMetrics(
        createPeerConnectionWithStats([
          {
            id: "local_1",
            type: "local-candidate",
            candidateType: "relay",
          },
          {
            id: "pair_1",
            type: "candidate-pair",
            selected: true,
            localCandidateId: "local_1",
            currentRoundTripTime: 0.024,
          },
        ]),
      ),
    ).resolves.toEqual({
      connectionType: "relay",
      pingMs: 24,
      videoCodec: null,
    });
  });

  it("treats a succeeded candidate pair as selected", async () => {
    await expect(
      collectViewerPeerMetrics(
        createPeerConnectionWithStats([
          {
            id: "local_1",
            type: "local-candidate",
            candidateType: "relay",
          },
          {
            id: "pair_1",
            type: "candidate-pair",
            state: "succeeded",
            localCandidateId: "local_1",
            currentRoundTripTime: 0.024,
          },
        ]),
      ),
    ).resolves.toEqual({
      connectionType: "relay",
      pingMs: 24,
      videoCodec: null,
    });
  });

  it("prefers an explicitly selected pair over an earlier succeeded pair", async () => {
    await expect(
      collectViewerPeerMetrics(
        createPeerConnectionWithStats([
          {
            id: "local_relay",
            type: "local-candidate",
            candidateType: "relay",
          },
          {
            id: "local_host",
            type: "local-candidate",
            candidateType: "host",
          },
          {
            id: "pair_succeeded",
            type: "candidate-pair",
            state: "succeeded",
            localCandidateId: "local_relay",
            currentRoundTripTime: 0.024,
          },
          {
            id: "pair_selected",
            type: "candidate-pair",
            selected: true,
            localCandidateId: "local_host",
            currentRoundTripTime: 0.012,
          },
        ]),
      ),
    ).resolves.toEqual({
      connectionType: "direct",
      pingMs: 12,
      videoCodec: null,
    });
  });

  it("reports direct metrics for a non-relay selected local candidate", async () => {
    await expect(
      collectViewerPeerMetrics(
        createPeerConnectionWithStats([
          {
            id: "local_1",
            type: "local-candidate",
            candidateType: "srflx",
          },
          {
            id: "pair_1",
            type: "candidate-pair",
            selected: true,
            localCandidateId: "local_1",
            currentRoundTripTime: 0.018,
          },
        ]),
      ),
    ).resolves.toEqual({
      connectionType: "direct",
      pingMs: 18,
      videoCodec: null,
    });
  });

  it("reports unknown when no selected candidate pair exists", async () => {
    await expect(
      collectViewerPeerMetrics(
        createPeerConnectionWithStats([
          {
            id: "local_1",
            type: "local-candidate",
            candidateType: "host",
          },
          {
            id: "pair_1",
            type: "candidate-pair",
            selected: false,
            localCandidateId: "local_1",
            currentRoundTripTime: 0.018,
          },
        ]),
      ),
    ).resolves.toEqual({
      connectionType: "unknown",
      pingMs: null,
      videoCodec: null,
    });
  });

  it("keeps ping null when the selected pair has no RTT", async () => {
    await expect(
      collectViewerPeerMetrics(
        createPeerConnectionWithStats([
          {
            id: "local_1",
            type: "local-candidate",
            candidateType: "host",
          },
          {
            id: "pair_1",
            type: "candidate-pair",
            selected: true,
            localCandidateId: "local_1",
          },
        ]),
      ),
    ).resolves.toEqual({
      connectionType: "direct",
      pingMs: null,
      videoCodec: null,
    });
  });

  it("reports the negotiated inbound video codec", async () => {
    await expect(
      collectViewerPeerMetrics(
        createPeerConnectionWithStats([
          {
            id: "codec_1",
            type: "codec",
            mimeType: "video/VP9",
          },
          {
            id: "inbound_1",
            type: "inbound-rtp",
            kind: "video",
            codecId: "codec_1",
          },
          {
            id: "local_1",
            type: "local-candidate",
            candidateType: "host",
          },
          {
            id: "pair_1",
            type: "candidate-pair",
            selected: true,
            localCandidateId: "local_1",
            currentRoundTripTime: 0.018,
          },
        ]),
      ),
    ).resolves.toEqual({
      connectionType: "direct",
      pingMs: 18,
      videoCodec: "VP9",
    });
  });
});
