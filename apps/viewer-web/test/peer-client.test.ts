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
    });
  });
});
