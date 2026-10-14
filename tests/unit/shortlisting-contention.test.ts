import { describe, expect, it } from "vitest";
import {
  evaluateScoreContentionAndClustering,
  RankedCandidateItem
} from "../../src/modules/screening/shortlisting.service.js";

const makeCandidate = (
  rank: number,
  compositeScore: number,
  name = `Candidate ${rank}`
): RankedCandidateItem => ({
  rank,
  applicationId: `app-${rank}`,
  candidateId: `cand-${rank}`,
  candidateName: name,
  candidateEmail: `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`,
  status: "SUBMITTED",
  submittedAt: new Date(Date.now() - rank * 1000),
  compositeScore,
  deterministicScore: compositeScore,
  aiAdvisoryScore: compositeScore,
  allRequiredMet: true,
  recommendation: "ADVANCE",
  shortlisted: false,
  flagForReview: false,
  reviewSeverity: "NONE",
  reviewReasons: [],
  matchedRequirements: ["Kubernetes", "Go"],
  unmetRequirements: [],
  summary: "Strong candidate",
  strengths: ["Strong experience"],
  gaps: [],
  suggestedQuestions: []
});

describe("Feature: Edge Case - Score Contention & Cluster Closeness in Shortlisting", () => {
  it("flags both sides of the shortlist cutoff when candidates have closely related scores within margin", () => {
    // topCount = 2
    // Rank 1: 92% (clear top)
    // Rank 2: 85.2% (last shortlisted candidate)
    // Rank 3: 84.8% (first excluded candidate - delta is 0.4 pts <= 3.0 pts margin)
    // Rank 4: 65% (distant candidate)
    const items: RankedCandidateItem[] = [
      makeCandidate(1, 92, "Alice Top"),
      makeCandidate(2, 85.2, "Bob Contender"),
      makeCandidate(3, 84.8, "Carol Contender"),
      makeCandidate(4, 65, "David Distant")
    ];

    evaluateScoreContentionAndClustering(items, 2, 60, 3.0);

    // Rank 1 has clear margin, should not have cutoff contention flag
    expect(items[0]!.flagForReview).toBe(false);
    expect(items[0]!.reviewReasons.some((r) => r.includes("cutoff score contention"))).toBe(false);

    // Rank 2 and Rank 3 are in active contention near the boundary
    expect(items[1]!.flagForReview).toBe(true);
    expect(items[1]!.reviewSeverity).toBe("WARNING");
    expect(items[1]!.reviewReasons.some((r) => r.includes("cutoff score contention"))).toBe(true);

    expect(items[2]!.flagForReview).toBe(true);
    expect(items[2]!.reviewSeverity).toBe("WARNING");
    expect(items[2]!.reviewReasons.some((r) => r.includes("cutoff score contention"))).toBe(true);

    // Rank 4 is far below margin, should not have cutoff contention
    expect(items[3]!.reviewReasons.some((r) => r.includes("cutoff score contention"))).toBe(false);
  });

  it("detects tight score ties / micro-clusters (difference <= 1.0 pt) across contiguous candidates", () => {
    // Rank 1: 88.0%
    // Rank 2: 87.5% (difference is 0.5 <= 1.0)
    // Rank 3: 75.0% (difference is 12.5)
    const items: RankedCandidateItem[] = [
      makeCandidate(1, 88.0, "Eve Tied"),
      makeCandidate(2, 87.5, "Frank Tied"),
      makeCandidate(3, 75.0, "Grace Isolated")
    ];

    evaluateScoreContentionAndClustering(items, 3, 60, 3.0);

    expect(items[0]!.flagForReview).toBe(true);
    expect(items[0]!.reviewReasons.some((r) => r.includes("Score tie / proximity"))).toBe(true);

    expect(items[1]!.flagForReview).toBe(true);
    expect(items[1]!.reviewReasons.some((r) => r.includes("Score tie / proximity"))).toBe(true);

    expect(items[2]!.reviewReasons.some((r) => r.includes("Score tie / proximity"))).toBe(false);
  });

  it("does not flag candidates when there is wide, clear score separation", () => {
    // topCount = 2
    // Rank 1: 95%
    // Rank 2: 88%
    // Rank 3: 70% (18 pts gap across cutoff boundary)
    const items: RankedCandidateItem[] = [
      makeCandidate(1, 95, "Separated Leader"),
      makeCandidate(2, 88, "Separated RunnerUp"),
      makeCandidate(3, 70, "Separated Third")
    ];

    evaluateScoreContentionAndClustering(items, 2, 60, 3.0);

    expect(items[0]!.flagForReview).toBe(false);
    expect(items[1]!.flagForReview).toBe(false);
    expect(items[2]!.flagForReview).toBe(false);
  });
});
