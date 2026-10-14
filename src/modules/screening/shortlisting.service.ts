import { ApplicationStatus, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { withDbRetry } from "../../utils/db-retry.js";
import { logger } from "../../utils/logger.js";
import { recordAudit } from "../audit/audit.service.js";
import { completeChat } from "../../providers/openrouter.ai.js";
import { notifyRecruitersShortlistReady } from "../notifications/applicant-notifications.service.js";
import { runDeterministicMatcher } from "./deterministic-matcher.js";

export type ReviewSeverity = "NONE" | "INFO" | "WARNING" | "CRITICAL";

export interface CandidateComparisonEntry {
  candidateName: string;
  rank: number;
  standoutAdvantage: string;
  potentialTradeoff: string;
}

export interface ExecutiveSummary {
  overview: string;
  candidateComparisons: CandidateComparisonEntry[];
  hiringGuidance: string;
}

export interface RankedCandidateItem {
  rank: number;
  applicationId: string;
  candidateId: string;
  candidateName: string;
  candidateEmail: string;
  status: ApplicationStatus;
  submittedAt: Date;
  compositeScore: number;
  deterministicScore: number;
  aiAdvisoryScore: number;
  allRequiredMet: boolean;
  recommendation: "ADVANCE" | "REVIEW" | "REJECT";
  shortlisted: boolean;
  flagForReview: boolean;
  reviewSeverity: ReviewSeverity;
  reviewReasons: string[];
  matchedRequirements: string[];
  unmetRequirements: string[];
  summary: string;
  strengths: string[];
  gaps: string[];
  suggestedQuestions: string[];
}

export interface JobShortlistResult {
  job: {
    id: string;
    title: string;
    organizationId: string;
    requirementsCount: number;
  };
  metrics: {
    totalApplications: number;
    evaluatedCount: number;
    shortlistCapacity: number;
    shortlistedCount: number;
    flaggedForReviewCount: number;
    averageScore: number;
    cutoffScore: number;
    autoAdvancedCount: number;
  };
  executiveSummary?: ExecutiveSummary;
  shortlisted: RankedCandidateItem[];
  otherCandidates: RankedCandidateItem[];
}

export interface CompareCandidatesOptions {
  organizationId: string;
  jobId: string;
  topCount?: number;
  minScore?: number;
  autoAdvance?: boolean;
  generateSummary?: boolean;
  actorUserId?: string;
}

/**
 * Detects edge cases that warrant human recruiter attention.
 * Flags candidates when:
 * 1. High score or AI ADVANCE recommendation, but a mandatory requirement is unverified
 * 2. Score is borderline near the cutoff threshold
 * 3. High divergence between rule-based score and AI advisory score
 * 4. AI advisory flagged REVIEW or REJECT despite passing numerical threshold
 * 5. Resume extraction length was minimal/sparse
 */
export const evaluateReviewFlags = (params: {
  compositeScore: number;
  deterministicScore: number;
  aiAdvisoryScore: number;
  allRequiredMet: boolean;
  recommendation: "ADVANCE" | "REVIEW" | "REJECT";
  unmetRequiredNames: string[];
  minScore: number;
  resumeWordCount?: number;
}): { flagForReview: boolean; reviewSeverity: ReviewSeverity; reviewReasons: string[] } => {
  const {
    compositeScore,
    deterministicScore,
    aiAdvisoryScore,
    allRequiredMet,
    recommendation,
    unmetRequiredNames,
    minScore,
    resumeWordCount
  } = params;

  const reviewReasons: string[] = [];
  let reviewSeverity: ReviewSeverity = "NONE";

  // Edge Case 1: High potential but missed mandatory requirement keyword
  if (!allRequiredMet && unmetRequiredNames.length > 0 && compositeScore >= minScore) {
    reviewReasons.push(
      `Strong candidate score (${compositeScore}%) but unverified mandatory requirement(s): ${unmetRequiredNames.join(", ")}`
    );
    reviewSeverity = "CRITICAL";
  }

  // Edge Case 2: Borderline score near the threshold (within +/- 4 points)
  if (Math.abs(compositeScore - minScore) <= 4) {
    reviewReasons.push(
      `Score (${compositeScore}%) is borderline close to the cutoff threshold (${minScore}%); human verification recommended.`
    );
    if (reviewSeverity !== "CRITICAL") reviewSeverity = "WARNING";
  }

  // Edge Case 3: Score discrepancy between deterministic and AI evaluation
  const scoreDiff = Math.abs(deterministicScore - aiAdvisoryScore);
  if (scoreDiff >= 25) {
    reviewReasons.push(
      `Score discrepancy detected (Deterministic: ${deterministicScore}%, AI Advisory: ${aiAdvisoryScore}%). Possible non-traditional background or terminology divergence.`
    );
    if (reviewSeverity !== "CRITICAL") reviewSeverity = "WARNING";
  }

  // Edge Case 4: Ambiguous AI recommendation
  if (compositeScore >= minScore && recommendation !== "ADVANCE") {
    reviewReasons.push(
      `AI evaluation issued '${recommendation}' advisory despite qualifying composite score (${compositeScore}%).`
    );
    if (reviewSeverity !== "CRITICAL") reviewSeverity = "WARNING";
  }

  // Edge Case 5: Thin profile / low word count
  if (typeof resumeWordCount === "number" && resumeWordCount > 0 && resumeWordCount < 50) {
    reviewReasons.push(
      `Short resume extract (${resumeWordCount} words); automated analysis has reduced confidence.`
    );
    if (reviewSeverity === "NONE") reviewSeverity = "INFO";
  }

  return {
    flagForReview: reviewReasons.length > 0,
    reviewSeverity,
    reviewReasons
  };
};

/**
 * Detects score proximity, ties, and cutoff boundary contention across the ranked pool.
 * If multiple applicants have tightly clustered scores or if candidates on either side
 * of the shortlist cutoff have closely related scores (<= 3.0 points), flags them for
 * human recruiter review so that arbitrary algorithmic cutoffs or tie-breakers do not
 * exclude viable talent without human contextual evaluation.
 */
export const evaluateScoreContentionAndClustering = (
  rankedItems: RankedCandidateItem[],
  topCount: number,
  minScore: number,
  contentionMargin = 3.0
): void => {
  if (rankedItems.length === 0) return;

  // 1. Cutoff boundary contention:
  // If the score difference between the last shortlisted candidate (Rank #topCount)
  // and the first candidate outside the shortlist (Rank #topCount + 1) is <= contentionMargin,
  // both sides of the boundary are in active contention.
  if (rankedItems.length > topCount && topCount > 0) {
    const lastShortlisted = rankedItems[topCount - 1]!;
    const firstExcluded = rankedItems[topCount]!;

    if (lastShortlisted.compositeScore >= minScore) {
      const cutoffDelta = Math.abs(lastShortlisted.compositeScore - firstExcluded.compositeScore);
      if (cutoffDelta <= contentionMargin) {
        // Find all contenders clustered within contentionMargin of the cutoff score
        const boundaryContenders = rankedItems.filter(
          (c) => Math.abs(c.compositeScore - lastShortlisted.compositeScore) <= contentionMargin
        );

        for (const cand of boundaryContenders) {
          cand.flagForReview = true;
          if (cand.reviewSeverity === "NONE" || cand.reviewSeverity === "INFO") {
            cand.reviewSeverity = "WARNING";
          }
          const reason = `Shortlist cutoff score contention: Rank #${cand.rank} (${cand.compositeScore}%) is within ${cutoffDelta.toFixed(1)} pts of the cutoff boundary (Rank #${topCount} vs #${topCount + 1}). Human recruiter review recommended to compare qualitative background before finalizing selection.`;
          if (!cand.reviewReasons.some((r) => r.includes("cutoff score contention"))) {
            cand.reviewReasons.push(reason);
          }
        }
      }
    }
  }

  // 2. Dense score ties and micro-clusters across adjacent applicants (score difference <= 1.0 point)
  for (let i = 0; i < rankedItems.length - 1; i++) {
    const curr = rankedItems[i]!;
    const next = rankedItems[i + 1]!;
    if (curr.compositeScore >= minScore && Math.abs(curr.compositeScore - next.compositeScore) <= 1.0) {
      const tieReason = `Score tie / proximity: Rank #${curr.rank} (${curr.compositeScore}%) and Rank #${next.rank} (${next.compositeScore}%) have virtually identical scores (diff ≤ 1.0 pt). Recruiter review recommended for differentiating context.`;
      if (!curr.reviewReasons.some((r) => r.includes("Score tie / proximity"))) {
        curr.reviewReasons.push(tieReason);
        if (curr.reviewSeverity === "NONE") curr.reviewSeverity = "INFO";
        curr.flagForReview = true;
      }
      if (!next.reviewReasons.some((r) => r.includes("Score tie / proximity"))) {
        next.reviewReasons.push(tieReason);
        if (next.reviewSeverity === "NONE") next.reviewSeverity = "INFO";
        next.flagForReview = true;
      }
    }
  }
};

/**
 * Deterministic fallback synthesis for test environments or offline resilience.
 */
export const generateFallbackExecutiveSummary = (
  jobTitle: string,
  shortlisted: RankedCandidateItem[]
): ExecutiveSummary => {
  const top = shortlisted.slice(0, 5);
  const avgScore = Math.round(top.reduce((sum, c) => sum + c.compositeScore, 0) / top.length);
  const cleanCount = top.filter((c) => !c.flagForReview).length;

  const overview = `Evaluated top ${top.length} contender(s) for ${jobTitle} with an average qualification score of ${avgScore}%. ${
    cleanCount > 0
      ? `${cleanCount} candidate(s) meet all primary requirements without critical flags.`
      : "Candidates exhibit promising attributes but require targeted verification."
  }`;

  const candidateComparisons: CandidateComparisonEntry[] = top.map((cand) => {
    const primaryStrength = cand.strengths[0] ?? `Scored ${cand.compositeScore}% composite alignment`;
    const primaryGap = cand.gaps[0] ?? (cand.unmetRequirements[0] ? `Missing requirement: ${cand.unmetRequirements[0]}` : "No critical gaps identified");

    return {
      candidateName: cand.candidateName,
      rank: cand.rank,
      standoutAdvantage: `Rank #${cand.rank} (${cand.compositeScore}%). ${primaryStrength}.`,
      potentialTradeoff: cand.flagForReview
        ? `Flagged for human review: ${cand.reviewReasons.join("; ")}.`
        : `${primaryGap}.`
    };
  });

  const topCand = top[0];
  const hiringGuidance = topCand
    ? `Prioritize first-round technical interview with #${topCand.rank} ${topCand.candidateName} (${topCand.compositeScore}%). For flagged candidates, probe unverified requirements before extending an offer.`
    : "Review all candidates against job requirements.";

  return {
    overview,
    candidateComparisons,
    hiringGuidance
  };
};

/**
 * Generates an Executive AI Comparative Summary comparing the top candidates side-by-side
 * using OpenRouter text models (e.g. google/gemma-4-26b-a4b-it:free).
 */
export const generateComparativeSummary = async (params: {
  jobTitle: string;
  jobDescription?: string | null;
  requirements: Array<{ name: string; type: string }>;
  shortlisted: RankedCandidateItem[];
}): Promise<ExecutiveSummary | undefined> => {
  const { jobTitle, jobDescription, requirements, shortlisted } = params;
  if (shortlisted.length === 0) {
    return undefined;
  }

  const candidateSummaries = shortlisted.slice(0, 5).map((c) => ({
    rank: c.rank,
    name: c.candidateName,
    compositeScore: c.compositeScore,
    deterministicScore: c.deterministicScore,
    aiAdvisoryScore: c.aiAdvisoryScore,
    allRequiredMet: c.allRequiredMet,
    strengths: c.strengths.slice(0, 3),
    gaps: c.gaps.slice(0, 2),
    flagForReview: c.flagForReview,
    reviewReasons: c.reviewReasons
  }));

  const prompt = `You are a Principal Talent Acquisition Partner providing an Executive Comparative Summary of top candidate applicants for a role.
Analyze the relative advantages, trade-offs, and key distinctions between the top candidates to advise the hiring manager.

Role: ${jobTitle}
Description: ${jobDescription ?? "N/A"}
Key Requirements: ${requirements.map((r) => `[${r.type}] ${r.name}`).join(", ")}

Top Shortlisted Candidates:
${JSON.stringify(candidateSummaries, null, 2)}

Respond strictly in valid JSON matching this schema:
{
  "overview": string (2-3 sentences synthesizing the caliber of the applicant pool and key differentiators),
  "candidateComparisons": [
    {
      "candidateName": string,
      "rank": number,
      "standoutAdvantage": string (1-2 sentences highlighting what makes this candidate uniquely compelling),
      "potentialTradeoff": string (1-2 sentences on risks, missing skills, or areas to probe)
    }
  ],
  "hiringGuidance": string (2-3 actionable sentences advising the recruiter on interview priority and interview focus)
}`;

  const completion = await completeChat(
    [
      { role: "system", content: "You are an executive talent acquisition advisor synthesizing comparative candidate intelligence." },
      { role: "user", content: prompt }
    ],
    { responseFormatJson: true, temperature: 0.3 }
  );

  if (completion) {
    try {
      const parsed = JSON.parse(completion) as ExecutiveSummary;
      if (parsed && typeof parsed.overview === "string" && Array.isArray(parsed.candidateComparisons)) {
        return {
          overview: parsed.overview,
          candidateComparisons: parsed.candidateComparisons.map((c, idx) => ({
            candidateName: c.candidateName || shortlisted[idx]?.candidateName || `Candidate ${idx + 1}`,
            rank: typeof c.rank === "number" ? c.rank : idx + 1,
            standoutAdvantage: c.standoutAdvantage || "Demonstrates strong alignment with core role qualifications.",
            potentialTradeoff: c.potentialTradeoff || "Validate technical depth in primary stack during interview."
          })),
          hiringGuidance: parsed.hiringGuidance || "Sequence technical interviews starting with top-ranked candidates."
        };
      }
    } catch (err) {
      logger.warn("executive_summary_parse_fallback", {
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  return generateFallbackExecutiveSummary(jobTitle, shortlisted);
};

/**
 * Compares all candidate applications for a job posting, ranks them by fit,
 * selects the top shortlist, flags edge cases requiring human recruiter review,
 * and optionally advances qualified candidates to SHORTLISTED status.
 */
export const compareAndShortlistJobApplications = async (
  options: CompareCandidatesOptions
): Promise<JobShortlistResult> => {
  const {
    organizationId,
    jobId,
    topCount = 5,
    minScore = 60,
    autoAdvance = false,
    generateSummary = true,
    actorUserId
  } = options;

  // 1. Verify job exists within the organization
  const job = await withDbRetry(() =>
    prisma.job.findFirst({
      where: { id: jobId, organizationId },
      include: {
        requirements: true,
        applications: {
          where: {
            status: { notIn: ["WITHDRAWN", "REJECTED"] }
          },
          include: {
            candidate: {
              select: {
                id: true,
                email: true,
                candidateProfile: {
                  select: {
                    name: true
                  }
                }
              }
            },
            resume: {
              include: {
                profile: true
              }
            },
            screeningRuns: {
              orderBy: { createdAt: "desc" },
              take: 1
            }
          }
        }
      }
    })
  );

  if (!job) {
    throw new AppError("JOB_NOT_FOUND", "Job not found in this organization", 404);
  }

  const applications = job.applications;
  const rankedItems: RankedCandidateItem[] = [];

  for (const app of applications) {
    const latestRun = app.screeningRuns[0];

    let compositeScore = 0;
    let deterministicScore = 0;
    let aiAdvisoryScore = 0;
    let allRequiredMet = false;
    let recommendation: "ADVANCE" | "REVIEW" | "REJECT" = "REVIEW";
    let matchedRequirements: string[] = [];
    let unmetRequirements: string[] = [];
    let unmetRequiredNames: string[] = [];
    let summary = "Candidate application under review.";
    let strengths: string[] = [];
    let gaps: string[] = [];
    let suggestedQuestions: string[] = [];
    let wordCount = 0;

    if (latestRun && latestRun.status === "COMPLETE" && latestRun.score !== null) {
      compositeScore = Number(latestRun.score);

      const breakdown = (latestRun.scoreBreakdown as Record<string, unknown>) ?? {};
      deterministicScore = typeof breakdown.deterministicScore === "number" ? breakdown.deterministicScore : compositeScore;
      aiAdvisoryScore = typeof breakdown.aiAdvisoryScore === "number" ? breakdown.aiAdvisoryScore : compositeScore;
      allRequiredMet = Boolean(breakdown.allRequiredMet);

      if (Array.isArray(breakdown.matches)) {
        for (const m of breakdown.matches as Array<{ name: string; matched: boolean; type: string }>) {
          if (m.matched) {
            matchedRequirements.push(m.name);
          } else {
            unmetRequirements.push(m.name);
            if (m.type === "REQUIRED") unmetRequiredNames.push(m.name);
          }
        }
      }

      const evidence = (latestRun.evidence as Record<string, unknown>) ?? {};
      if (typeof evidence.summary === "string") summary = evidence.summary;
      if (Array.isArray(evidence.strengths)) strengths = evidence.strengths as string[];
      if (Array.isArray(evidence.gaps)) gaps = evidence.gaps as string[];
      if (Array.isArray(evidence.suggestedQuestions)) suggestedQuestions = evidence.suggestedQuestions as string[];
      if (typeof evidence.extractedWordCount === "number") wordCount = evidence.extractedWordCount;

      if (evidence.recommendation === "ADVANCE" || evidence.recommendation === "REJECT") {
        recommendation = evidence.recommendation;
      }
    } else {
      // Fallback: evaluate deterministically from extracted resume text
      const extractedData = app.resume.profile?.extractedData as { text?: string; wordCount?: number } | undefined;
      const text = extractedData?.text ?? "";
      wordCount = extractedData?.wordCount ?? text.split(/\s+/).filter(Boolean).length;

      const deterministic = runDeterministicMatcher(text, job.requirements);
      deterministicScore = deterministic.score;
      compositeScore = deterministic.score;
      aiAdvisoryScore = deterministic.score;
      allRequiredMet = deterministic.allRequiredMet;

      matchedRequirements = deterministic.matches.filter((m) => m.matched).map((m) => m.name);
      unmetRequirements = deterministic.matches.filter((m) => !m.matched).map((m) => m.name);
      unmetRequiredNames = deterministic.matches
        .filter((m) => !m.matched && m.type === "REQUIRED")
        .map((m) => m.name);

      if (allRequiredMet && deterministic.score >= 70) {
        recommendation = "ADVANCE";
      } else if (!allRequiredMet && deterministic.score < 40) {
        recommendation = "REJECT";
      }

      summary = `Evaluated against ${job.requirements.length} job requirements with score of ${deterministic.score}%.`;
      strengths = matchedRequirements.map((r) => `Aligned with requirement: ${r}`);
      gaps = unmetRequirements.map((r) => `Missing mention: ${r}`);
      if (unmetRequiredNames.length > 0) {
        suggestedQuestions = unmetRequiredNames.slice(0, 2).map((r) => `Can you explain your experience with ${r}?`);
      } else if (matchedRequirements.length > 0) {
        suggestedQuestions = [
          `Can you detail a complex challenge you solved using ${matchedRequirements.slice(0, 2).join(" and ")} in production?`
        ];
      }
    }

    // 2. Evaluate Edge Cases & Review Flags
    const flagInfo = evaluateReviewFlags({
      compositeScore,
      deterministicScore,
      aiAdvisoryScore,
      allRequiredMet,
      recommendation,
      unmetRequiredNames,
      minScore,
      resumeWordCount: wordCount
    });

    rankedItems.push({
      rank: 0, // Assigned after sorting
      applicationId: app.id,
      candidateId: app.candidate.id,
      candidateName: app.candidate.candidateProfile?.name || app.candidate.email.split("@")[0] || "Candidate",
      candidateEmail: app.candidate.email,
      status: app.status,
      submittedAt: app.submittedAt,
      compositeScore,
      deterministicScore,
      aiAdvisoryScore,
      allRequiredMet,
      recommendation,
      shortlisted: false,
      flagForReview: flagInfo.flagForReview,
      reviewSeverity: flagInfo.reviewSeverity,
      reviewReasons: flagInfo.reviewReasons,
      matchedRequirements,
      unmetRequirements,
      summary,
      strengths,
      gaps,
      suggestedQuestions
    });
  }

  // 3. Multi-factor Sorting for Best Fit:
  // - Composite score desc
  // - All required requirements met first
  // - Deterministic score desc
  // - Earlier submission asc (tie-breaker)
  rankedItems.sort((a, b) => {
    if (b.compositeScore !== a.compositeScore) {
      return b.compositeScore - a.compositeScore;
    }
    if (a.allRequiredMet !== b.allRequiredMet) {
      return a.allRequiredMet ? -1 : 1;
    }
    if (b.deterministicScore !== a.deterministicScore) {
      return b.deterministicScore - a.deterministicScore;
    }
    return a.submittedAt.getTime() - b.submittedAt.getTime();
  });

  // Assign 1-indexed ranks
  rankedItems.forEach((item, index) => {
    item.rank = index + 1;
  });

  // Evaluate candidate score clustering and cutoff boundary contention
  evaluateScoreContentionAndClustering(rankedItems, topCount, minScore);

  // 4. Partition into Shortlist vs Others based on topCount and minScore
  const shortlisted: RankedCandidateItem[] = [];
  const otherCandidates: RankedCandidateItem[] = [];

  for (const item of rankedItems) {
    if (shortlisted.length < topCount && item.compositeScore >= minScore) {
      item.shortlisted = true;
      if (item.suggestedQuestions.length === 0) {
        item.suggestedQuestions = [
          `Can you describe how you applied ${item.matchedRequirements.slice(0, 2).join(" and ") || "your technical skills"} to deliver measurable impact in production?`
        ];
      }
      shortlisted.push(item);
    } else {
      item.shortlisted = false;
      // Tailored interview questions are solely for shortlisted contenders; clear for non-shortlisted
      item.suggestedQuestions = [];
      otherCandidates.push(item);
    }
  }

  // 5. Auto-advance feature:
  // If autoAdvance is enabled, advance shortlisted candidates who have no critical review flags to SHORTLISTED status
  let autoAdvancedCount = 0;
  if (autoAdvance && shortlisted.length > 0) {
    const candidatesToAdvance = shortlisted.filter(
      (c) => !c.flagForReview && (c.status === "SUBMITTED" || c.status === "SCREENING" || c.status === "IN_REVIEW")
    );

    if (candidatesToAdvance.length > 0) {
      await withDbRetry(() =>
        prisma.$transaction(async (tx) => {
          for (const cand of candidatesToAdvance) {
            await tx.application.update({
              where: { id: cand.applicationId },
              data: { status: "SHORTLISTED" }
            });

            await tx.applicationEvent.create({
              data: {
                applicationId: cand.applicationId,
                actorUserId: actorUserId ?? null,
                fromStatus: cand.status,
                toStatus: "SHORTLISTED",
                reason: `Auto-advanced to shortlist (Rank #${cand.rank}, Score: ${cand.compositeScore}%)`,
                candidateVisible: false
              }
            });

            cand.status = "SHORTLISTED";
            autoAdvancedCount++;
            // NOTE: No candidate-facing email is sent at the SHORTLISTED stage.
            // Shortlisting is an internal talent pipeline milestone for recruiter review.
            // Candidate notification is sent at the INTERVIEW invitation step to avoid
            // duplicate or premature disclosure before the recruiter has confirmed next steps.
          }
        })
      );

      if (actorUserId) {
        await recordAudit({
          actorId: actorUserId,
          organizationId,
          action: "job.applications.shortlisted",
          resourceType: "Job",
          resourceId: jobId,
          metadata: {
            shortlistedApplicationIds: candidatesToAdvance.map((c) => c.applicationId),
            autoAdvancedCount
          }
        });
      }
    }
  }

  // 6. Generate Executive AI Comparative Summary across top shortlisted candidates
  let executiveSummary: ExecutiveSummary | undefined;
  if (generateSummary && shortlisted.length > 0) {
    executiveSummary = await generateComparativeSummary({
      jobTitle: job.title,
      jobDescription: job.description,
      requirements: job.requirements,
      shortlisted
    });
  }

  const flaggedCount = rankedItems.filter((i) => i.flagForReview).length;
  const avgScore =
    rankedItems.length > 0
      ? Math.round((rankedItems.reduce((sum, i) => sum + i.compositeScore, 0) / rankedItems.length) * 100) / 100
      : 0;

  // 7. Notify recruiters/admins when shortlist is ready
  if (shortlisted.length > 0) {
    await notifyRecruitersShortlistReady({
      organizationId,
      jobId: job.id,
      jobTitle: job.title,
      shortlistedCount: shortlisted.length,
      averageScore: avgScore,
      executiveSummaryOverview: executiveSummary?.overview
    });
  }

  logger.info("job_applications_compared", {
    jobId,
    total: rankedItems.length,
    shortlisted: shortlisted.length,
    flagged: flaggedCount,
    autoAdvanced: autoAdvancedCount
  });

  return {
    job: {
      id: job.id,
      title: job.title,
      organizationId: job.organizationId,
      requirementsCount: job.requirements.length
    },
    metrics: {
      totalApplications: rankedItems.length,
      evaluatedCount: rankedItems.length,
      shortlistCapacity: topCount,
      shortlistedCount: shortlisted.length,
      flaggedForReviewCount: flaggedCount,
      averageScore: avgScore,
      cutoffScore: minScore,
      autoAdvancedCount
    },
    ...(executiveSummary ? { executiveSummary } : {}),
    shortlisted,
    otherCandidates
  };
};
