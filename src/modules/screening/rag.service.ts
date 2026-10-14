import { prisma } from "../../config/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { withDbRetry } from "../../utils/db-retry.js";
import { completeChat } from "../../providers/openrouter.ai.js";
import { retrieveSimilarResumeChunks, type RetrievedChunk } from "./embedding.service.js";

export interface RagScreeningResult {
  summary: string;
  strengths: string[];
  gaps: string[];
  recommendation: "ADVANCE" | "REVIEW" | "REJECT";
  suggestedQuestions: string[];
  groundedScore: number;
  retrievedChunks: RetrievedChunk[];
  citedSources: string[];
  provider: string;
  model: string;
}

/**
 * Conducts Retrieval-Augmented Generation (RAG) screening by retrieving relevant
 * resume chunks via pgvector and prompting OpenRouter for a grounded evaluation.
 */
export const runRagScreening = async (params: {
  resumeId: string;
  jobTitle: string;
  jobDescription?: string | null;
  requirements: Array<{ id: string; name: string; type: string }>;
  deterministicScore: number;
}): Promise<RagScreeningResult> => {
  const { resumeId, jobTitle, jobDescription, requirements, deterministicScore } = params;

  // 1. Retrieve top matching chunks across all job requirements
  const query = `${jobTitle}. ${requirements.map((r) => r.name).join(", ")}. ${jobDescription ?? ""}`.trim();
  const retrievedChunks = await retrieveSimilarResumeChunks(resumeId, query, 5);

  const contextText = retrievedChunks
    .map(
      (c, idx) =>
        `[Source Chunk ${idx + 1}] (Index ${c.chunkIndex}, Similarity ${c.similarity}):\n"${c.content}"`
    )
    .join("\n\n");

  const prompt = `You are an AI recruitment assistant providing explainable, unbiased, ADVISORY screening evaluation for a candidate's resume relative to a job posting.
Hiring decisions remain solely with authorized human recruiters.

Job Title: ${jobTitle}
Job Description: ${jobDescription ?? "N/A"}

Requirements:
${requirements.map((r) => `- [${r.type}] ${r.name}`).join("\n")}

Retrieved Evidence Chunks from Candidate Resume:
${contextText || "No matching chunks found in resume."}

Instructions:
1. Answer ONLY using the provided evidence chunks.
2. Cite the source chunk labels (e.g. [Source Chunk 1]) in your strengths and gaps.
3. If an essential requirement is not verified by the chunks, explicitly state it in gaps.

Respond strictly in valid JSON matching this schema:
{
  "summary": string (2-3 concise sentences grounded in the evidence),
  "strengths": string[] (2-4 key strengths citing source chunk labels),
  "gaps": string[] (1-3 gaps or unverified criteria),
  "recommendation": "ADVANCE" | "REVIEW" | "REJECT",
  "suggestedQuestions": string[] (2-3 interview questions to probe gaps),
  "groundedScore": number (0 to 100 integer score),
  "citedSources": string[] (e.g. ["Source Chunk 1", "Source Chunk 2"])
}`;

  const completion = await completeChat(
    [
      { role: "system", content: "You are an explainable recruitment screening assistant that answers only from supplied evidence." },
      { role: "user", content: prompt }
    ],
    { responseFormatJson: true }
  );

  if (completion) {
    try {
      const parsed = JSON.parse(completion) as Partial<RagScreeningResult>;
      const recommendation =
        parsed.recommendation === "ADVANCE" || parsed.recommendation === "REJECT"
          ? parsed.recommendation
          : "REVIEW";

      // Suggested interview questions are only applicable for qualifying candidates, not rejected ones
      const suggestedQuestions =
        recommendation === "REJECT"
          ? []
          : Array.isArray(parsed.suggestedQuestions)
            ? parsed.suggestedQuestions
            : [`How does your background fit the responsibilities of ${jobTitle}?`];

      return {
        summary: parsed.summary ?? `Candidate evaluated for ${jobTitle} via RAG.`,
        strengths: Array.isArray(parsed.strengths) ? parsed.strengths : ["Profile aligns with required experience"],
        gaps: Array.isArray(parsed.gaps) ? parsed.gaps : ["Verify specific domain tooling"],
        recommendation,
        suggestedQuestions,
        groundedScore: typeof parsed.groundedScore === "number" ? parsed.groundedScore : deterministicScore,
        retrievedChunks,
        citedSources: Array.isArray(parsed.citedSources) ? parsed.citedSources : ["[Source Chunk 1]"],
        provider: "openrouter",
        model: "rag-grounded-evaluator"
      };
    } catch {
      // Fall through to deterministic fallback if JSON parsing fails
    }
  }

  // Fallback: Synthesize grounded advisory using retrieved chunks and deterministic score
  const avgSimilarity =
    retrievedChunks.length > 0
      ? retrievedChunks.reduce((sum, c) => sum + c.similarity, 0) / retrievedChunks.length
      : 0;

  const fallbackScore = Math.round((deterministicScore * 0.7 + avgSimilarity * 100 * 0.3) * 100) / 100;
  const recommendation = fallbackScore >= 70 ? "ADVANCE" : fallbackScore >= 45 ? "REVIEW" : "REJECT";

  return {
    summary: `Grounded RAG screening completed for ${jobTitle}. Evaluated ${retrievedChunks.length} vector-retrieved resume passages with an average semantic alignment of ${Math.round(avgSimilarity * 100)}%.`,
    strengths: retrievedChunks.slice(0, 3).map((c, i) => `[Source Chunk ${i + 1}] Relevant background: "${c.content.slice(0, 100)}..."`),
    gaps: ["Verify specific operational practices during interview stage."],
    recommendation,
    suggestedQuestions:
      recommendation === "REJECT"
        ? []
        : [`Can you detail your hands-on experience with the requirements of ${jobTitle}?`],
    groundedScore: fallbackScore,
    retrievedChunks,
    citedSources: retrievedChunks.map((_, i) => `[Source Chunk ${i + 1}]`),
    provider: "openrouter-pgvector-hybrid",
    model: "hybrid-rag-v1"
  };
};

/**
 * RAG Question-Answering & Evaluation Reasoning:
 * Allows authorized recruiters and organization admins to query candidate resume content
 * OR challenge selection process checkpoints and scoring decisions with grounded reasoning and evidence.
 */
export const askResumeQuestion = async (
  organizationId: string,
  applicationId: string,
  question: string
): Promise<{
  question: string;
  answer: string;
  sources: Array<{ chunkIndex: number; snippet: string; similarity: number }>;
  checkpointContext?: {
    score: number | null;
    recommendation: string;
    matchedRequirements: string[];
    unmetRequirements: string[];
  };
}> => {
  const application = await withDbRetry(() =>
    prisma.application.findFirst({
      where: { id: applicationId, job: { organizationId } },
      select: {
        id: true,
        resumeId: true,
        job: {
          select: {
            title: true,
            description: true,
            requirements: {
              select: { id: true, name: true, type: true, weight: true }
            }
          }
        },
        screeningRuns: {
          where: { status: "COMPLETE" },
          orderBy: { createdAt: "desc" },
          take: 1
        }
      }
    })
  );

  if (!application) {
    throw new AppError("APPLICATION_NOT_FOUND", "Application not found", 404);
  }

  // 1. Retrieve top-4 most relevant chunks
  const chunks = await retrieveSimilarResumeChunks(application.resumeId, question, 4);

  const contextText = chunks
    .map((c, i) => `[Passage ${i + 1}] (Similarity ${c.similarity}):\n"${c.content}"`)
    .join("\n\n");

  // 2. Parse latest screening evaluation checkpoints
  const latestRun = application.screeningRuns[0];
  const breakdown = (latestRun?.scoreBreakdown as Record<string, unknown>) ?? {};
  const evidence = (latestRun?.evidence as Record<string, unknown>) ?? {};
  const matches = (breakdown.matches as Array<{ name: string; matched: boolean; type: string }>) ?? [];
  const matchedRequirements = matches.filter((m) => m.matched).map((m) => m.name);
  const unmetRequirements = matches.filter((m) => !m.matched).map((m) => m.name);
  const evalScore = latestRun?.score !== null && latestRun?.score !== undefined ? Number(latestRun.score) : null;
  const evalRecommendation = typeof evidence.recommendation === "string" ? evidence.recommendation : "REVIEW";
  const evalSummary = typeof evidence.summary === "string" ? evidence.summary : "No automated screening summary recorded.";
  const evalStrengths = Array.isArray(evidence.strengths) ? (evidence.strengths as string[]) : [];
  const evalGaps = Array.isArray(evidence.gaps) ? (evidence.gaps as string[]) : [];

  const requirementsSummary = application.job.requirements.length > 0
    ? application.job.requirements.map((r) => `- [${r.type}] ${r.name} (weight: ${r.weight})`).join("\n")
    : "No explicit requirements configured.";

  const checkpointsSummary = matches.length > 0
    ? matches.map((m) => `- ${m.name} [${m.type}]: ${m.matched ? "VERIFIED/MATCHED" : "UNMET/GAP"}`).join("\n")
    : "No automated checkpoint evaluation available.";

  const prompt = `You are a Principal Talent Acquisition Partner & Evaluation Reasoning Advisor for the position of "${application.job.title}".
A recruiter or organization admin is asking a question about the candidate's background OR challenging the automated selection checkpoints, scoring, or qualification verdicts.

ROLE REQUIREMENTS:
${requirementsSummary}

AUTOMATED SCREENING CHECKPOINTS & EVALUATION STATE:
- Overall Score: ${evalScore !== null ? `${evalScore}%` : "Not evaluated yet"}
- Recommendation: ${evalRecommendation}
- Checkpoint Match Verification:
${checkpointsSummary}
- Identified Strengths: ${evalStrengths.join("; ") || "None"}
- Identified Gaps / Unverified: ${evalGaps.join("; ") || "None"}
- Screening Rationale: ${evalSummary}

CANDIDATE RESUME PASSAGES (Retrieved by semantic search):
${contextText || "No relevant resume passages retrieved."}

RECRUITER QUESTION / CHALLENGE:
${question}

INSTRUCTIONS:
1. When the recruiter asks about candidate resume facts: answer accurately and concisely based on the resume passages, citing [Passage X].
2. When the recruiter challenges, probes, or questions the selection process, checkpoints, score, or reasoning:
   - Provide efficient, tailored reasoning explaining the checkpoint criteria and why the automated process assigned that status or score.
   - Ground your answer in concrete evidence: contrast the screening criteria with what is actually stated (or omitted) in the candidate's resume passages (cite [Passage X]).
   - If the candidate's resume shows related experience that partially satisfies an unmet checkpoint, highlight that nuance and explain why the checkpoint was conservative.
3. If neither the resume passages nor the evaluation records contain relevant information, state: "The candidate's resume and screening records do not contain enough information to answer this question."
4. Be concise, objective, transparent, and always reference evidence (e.g. [Passage 1] or checkpoint names).`;

  const completion = await completeChat([
    { role: "system", content: "You are an objective recruitment evaluation advisor synthesizing candidate resume evidence with screening checkpoints." },
    { role: "user", content: prompt }
  ]);

  let answer = completion;
  if (!answer) {
    const isChallengeOrReviewQuestion = /why|score|checkpoint|require|evaluat|fail|miss|unmet|reason|gap|reject|shortlist|challenge|tradeoff/i.test(question);
    if (isChallengeOrReviewQuestion && latestRun) {
      const parts: string[] = [];
      parts.push(`The candidate received an overall screening score of ${evalScore}%, with an automated recommendation of '${evalRecommendation}'.`);
      if (evalGaps.length > 0) {
        parts.push(`Identified gaps: ${evalGaps.join("; ")}.`);
      }
      if (unmetRequirements.length > 0) {
        parts.push(`Unmet checkpoints: ${unmetRequirements.join(", ")}.`);
      }
      if (chunks.length > 0) {
        parts.push(`Supporting resume evidence from [Passage 1]: "${chunks[0]!.content.slice(0, 160)}...".`);
      }
      answer = parts.join(" ");
    } else if (chunks.length > 0) {
      answer = `Based on [Passage 1] (${Math.round(chunks[0]!.similarity * 100)}% match): "${chunks[0]!.content.slice(0, 200)}..."`;
    } else {
      answer = "The candidate's resume does not contain relevant passages for this question.";
    }
  }

  return {
    question,
    answer,
    sources: chunks.map((c) => ({
      chunkIndex: c.chunkIndex,
      snippet: c.content.slice(0, 250),
      similarity: c.similarity
    })),
    checkpointContext: latestRun
      ? {
          score: evalScore,
          recommendation: evalRecommendation,
          matchedRequirements,
          unmetRequirements
        }
      : undefined
  };
};
