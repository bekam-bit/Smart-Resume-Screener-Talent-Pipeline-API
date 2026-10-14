import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { withDbRetry } from "../../utils/db-retry.js";
import { logger } from "../../utils/logger.js";
import { recordAudit } from "../audit/audit.service.js";
import { extractResumeText } from "./extraction.service.js";
import { runDeterministicMatcher } from "./deterministic-matcher.js";
import { screenWithGemini } from "../../providers/gemini.ai.js";
import { runRagScreening } from "./rag.service.js";
import { evaluateReviewFlags } from "./shortlisting.service.js";

export interface PublicScreeningRun {
  id: string;
  applicationId: string;
  status: string;
  score: number | null;
  scoreBreakdown: unknown;
  evidence: unknown;
  provider: string | null;
  model: string | null;
  errorCode: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}

const formatScreeningRun = (run: {
  id: string;
  applicationId: string;
  status: string;
  score: Prisma.Decimal | null;
  scoreBreakdown: Prisma.JsonValue | null;
  evidence: Prisma.JsonValue | null;
  provider: string | null;
  model: string | null;
  errorCode: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}): PublicScreeningRun => ({
  id: run.id,
  applicationId: run.applicationId,
  status: run.status,
  score: run.score !== null ? Number(run.score) : null,
  scoreBreakdown: run.scoreBreakdown,
  evidence: run.evidence,
  provider: run.provider,
  model: run.model,
  errorCode: run.errorCode,
  createdAt: run.createdAt,
  finishedAt: run.finishedAt
});

/**
 * Triggers or queues a new screening evaluation run for an organization's application.
 */
export const triggerScreening = async (
  organizationId: string,
  applicationId: string,
  actorId: string
): Promise<PublicScreeningRun> => {
  const application = await withDbRetry(() =>
    prisma.application.findFirst({
      where: { id: applicationId, job: { organizationId } },
      select: { id: true, status: true }
    })
  );

  if (!application) {
    throw new AppError("APPLICATION_NOT_FOUND", "Application not found", 404);
  }

  if (application.status === "WITHDRAWN" || application.status === "REJECTED" || application.status === "HIRED") {
    throw new AppError(
      "INVALID_APPLICATION_STATUS",
      `Cannot run screening for an application in ${application.status} status`,
      400
    );
  }

  const run = await withDbRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const created = await tx.screeningRun.create({
          data: {
            applicationId: application.id,
            status: "QUEUED"
          }
        });

        if (application.status === "SUBMITTED") {
          await tx.application.update({
            where: { id: application.id },
            data: { status: "SCREENING" }
          });

          await tx.applicationEvent.create({
            data: {
              applicationId: application.id,
              actorUserId: actorId,
              fromStatus: "SUBMITTED",
              toStatus: "SCREENING",
              reason: "Screening run queued",
              candidateVisible: false
            }
          });
        }

        return created;
      },
      { maxWait: 15000, timeout: 30000 }
    )
  );

  await recordAudit({
    actorId,
    organizationId,
    action: "application.screening.queued",
    resourceType: "ScreeningRun",
    resourceId: run.id,
    metadata: { applicationId }
  });

  return formatScreeningRun(run);
};

/**
 * Executes a single screening run end-to-end:
 * 1. Extraction of resume text
 * 2. Deterministic keyword and requirement scoring
 * 3. AI advisory synthesis (with resilient fallback)
 * 4. Composite scoring and application advancement to IN_REVIEW
 */
export const executeScreeningRun = async (screeningRunId: string): Promise<PublicScreeningRun> => {
  const run = await withDbRetry(() =>
    prisma.screeningRun.findUnique({
      where: { id: screeningRunId },
      include: {
        application: {
          include: {
            job: {
              include: {
                requirements: true
              }
            },
            resume: true
          }
        }
      }
    })
  );

  if (!run) {
    throw new AppError("SCREENING_RUN_NOT_FOUND", "Screening run not found", 404);
  }

  if (run.status === "COMPLETE") {
    return formatScreeningRun(run);
  }

  // Mark PROCESSING
  await withDbRetry(() =>
    prisma.screeningRun.update({
      where: { id: screeningRunId },
      data: { status: "PROCESSING" }
    })
  );

  try {
    const { application } = run;
    const { job, resume } = application;

    // 1. Extract resume text
    const extraction = await extractResumeText(resume.id);

    // 2. Deterministic matching
    const deterministic = runDeterministicMatcher(extraction.text, job.requirements);

    // 3. Grounded RAG Screening Evaluation (OpenRouter + pgvector)
    const rag = await runRagScreening({
      resumeId: resume.id,
      jobTitle: job.title,
      jobDescription: job.description,
      requirements: job.requirements,
      deterministicScore: deterministic.score
    });

    // 4. Combined score: 60% deterministic, 40% RAG advisory
    const combinedScore = Math.round((deterministic.score * 0.6 + rag.groundedScore * 0.4) * 100) / 100;

    // 5. Evaluate edge cases & review flags for this individual candidate
    const flagInfo = evaluateReviewFlags({
      compositeScore: combinedScore,
      deterministicScore: deterministic.score,
      aiAdvisoryScore: rag.groundedScore,
      allRequiredMet: deterministic.allRequiredMet,
      recommendation: rag.recommendation,
      unmetRequiredNames: deterministic.matches
        .filter((m) => !m.matched && m.type === "REQUIRED")
        .map((m) => m.name),
      minScore: 60,
      resumeWordCount: extraction.wordCount
    });

    const scoreBreakdown: Prisma.JsonObject = {
      deterministicScore: deterministic.score,
      aiAdvisoryScore: rag.groundedScore,
      combinedScore,
      requiredTotal: deterministic.requiredTotal,
      requiredPassed: deterministic.requiredPassed,
      preferredTotal: deterministic.preferredTotal,
      preferredPassed: deterministic.preferredPassed,
      allRequiredMet: deterministic.allRequiredMet,
      matches: deterministic.matches as unknown as Prisma.JsonArray
    };

    const evidence: Prisma.JsonObject = {
      summary: rag.summary,
      strengths: rag.strengths,
      gaps: rag.gaps,
      recommendation: rag.recommendation,
      suggestedQuestions: rag.suggestedQuestions,
      retrievedChunks: rag.retrievedChunks as unknown as Prisma.JsonArray,
      citedSources: rag.citedSources as unknown as Prisma.JsonArray,
      flagForReview: flagInfo.flagForReview,
      reviewSeverity: flagInfo.reviewSeverity,
      reviewReasons: flagInfo.reviewReasons as unknown as Prisma.JsonArray,
      extractedWordCount: extraction.wordCount,
      extractionSource: extraction.source
    };

    const updated = await withDbRetry(() =>
      prisma.$transaction(
        async (tx) => {
          const finished = await tx.screeningRun.update({
            where: { id: screeningRunId },
            data: {
              status: "COMPLETE",
              score: new Prisma.Decimal(combinedScore),
              scoreBreakdown,
              evidence,
              provider: rag.provider,
              model: rag.model,
              promptVersion: "1.0.0",
              finishedAt: new Date()
            }
          });

          // Transition application to IN_REVIEW if currently SCREENING or SUBMITTED
          if (application.status === "SCREENING" || application.status === "SUBMITTED") {
            await tx.application.update({
              where: { id: application.id },
              data: { status: "IN_REVIEW" }
            });

            await tx.applicationEvent.create({
              data: {
                applicationId: application.id,
                fromStatus: application.status,
                toStatus: "IN_REVIEW",
                reason: `Automated screening completed with score ${combinedScore}`,
                candidateVisible: false
              }
            });
          }

          return finished;
        },
        { maxWait: 15000, timeout: 30000 }
      )
    );

    logger.info("screening_run_completed", {
      screeningRunId,
      applicationId: application.id,
      score: combinedScore
    });

    return formatScreeningRun(updated);
  } catch (error) {
    logger.error("screening_run_failed", {
      screeningRunId,
      error: error instanceof Error ? error.message : String(error)
    });

    const failed = await withDbRetry(() =>
      prisma.screeningRun.update({
        where: { id: screeningRunId },
        data: {
          status: "FAILED",
          errorCode: error instanceof AppError ? error.code : "PROCESSING_ERROR",
          evidence: {
            error: error instanceof Error ? error.message : "Unknown error during screening execution"
          },
          finishedAt: new Date()
        }
      })
    );

    return formatScreeningRun(failed);
  }
};

/**
 * Lists all screening runs for an application.
 */
export const listScreeningRuns = async (
  organizationId: string,
  applicationId: string
): Promise<PublicScreeningRun[]> => {
  const application = await withDbRetry(() =>
    prisma.application.findFirst({
      where: { id: applicationId, job: { organizationId } },
      select: { id: true }
    })
  );

  if (!application) {
    throw new AppError("APPLICATION_NOT_FOUND", "Application not found", 404);
  }

  const runs = await withDbRetry(() =>
    prisma.screeningRun.findMany({
      where: { applicationId },
      orderBy: { createdAt: "desc" }
    })
  );

  return runs.map(formatScreeningRun);
};

/**
 * Retrieves details for a specific screening run.
 */
export const getScreeningRun = async (
  organizationId: string,
  applicationId: string,
  runId: string
): Promise<PublicScreeningRun> => {
  const application = await withDbRetry(() =>
    prisma.application.findFirst({
      where: { id: applicationId, job: { organizationId } },
      select: { id: true }
    })
  );

  if (!application) {
    throw new AppError("APPLICATION_NOT_FOUND", "Application not found", 404);
  }

  const run = await withDbRetry(() =>
    prisma.screeningRun.findFirst({
      where: { id: runId, applicationId }
    })
  );

  if (!run) {
    throw new AppError("SCREENING_RUN_NOT_FOUND", "Screening run not found", 404);
  }

  return formatScreeningRun(run);
};
