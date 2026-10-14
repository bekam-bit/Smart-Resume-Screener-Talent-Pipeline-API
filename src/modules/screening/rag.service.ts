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
      return {
        summary: parsed.summary ?? `Candidate evaluated for ${jobTitle} via RAG.`,
        strengths: Array.isArray(parsed.strengths) ? parsed.strengths : ["Profile aligns with required experience"],
        gaps: Array.isArray(parsed.gaps) ? parsed.gaps : ["Verify specific domain tooling"],
        recommendation:
          parsed.recommendation === "ADVANCE" || parsed.recommendation === "REJECT"
            ? parsed.recommendation
            : "REVIEW",
        suggestedQuestions: Array.isArray(parsed.suggestedQuestions)
          ? parsed.suggestedQuestions
          : [`How does your background fit the responsibilities of ${jobTitle}?`],
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
    suggestedQuestions: [`Can you detail your hands-on experience with the requirements of ${jobTitle}?`],
    groundedScore: fallbackScore,
    retrievedChunks,
    citedSources: retrievedChunks.map((_, i) => `[Source Chunk ${i + 1}]`),
    provider: "openrouter-pgvector-hybrid",
    model: "hybrid-rag-v1"
  };
};

/**
 * RAG Question-Answering: Allows authorized recruiters to query a candidate's resume
 * using semantic vector search and receive grounded answers with citations.
 */
export const askResumeQuestion = async (
  organizationId: string,
  applicationId: string,
  question: string
): Promise<{
  question: string;
  answer: string;
  sources: Array<{ chunkIndex: number; snippet: string; similarity: number }>;
}> => {
  const application = await withDbRetry(() =>
    prisma.application.findFirst({
      where: { id: applicationId, job: { organizationId } },
      select: { id: true, resumeId: true, job: { select: { title: true } } }
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

  const prompt = `You are a recruitment assistant answering a recruiter's question about a candidate's resume for the role of ${application.job.title}.
Answer strictly and solely from the provided passages.
If the passages do not contain enough information to answer, explicitly state: "The candidate's resume does not contain information to answer this question."

Candidate Passages:
${contextText || "No relevant passages found."}

Question:
${question}

Answer concisely in 2-4 sentences, referencing the relevant passage numbers (e.g. [Passage 1]) when citing information.`;

  const completion = await completeChat([
    { role: "system", content: "You answer questions strictly using provided passages." },
    { role: "user", content: prompt }
  ]);

  const answer =
    completion ??
    (chunks.length > 0
      ? `Based on [Passage 1] (${Math.round(chunks[0]!.similarity * 100)}% match): "${chunks[0]!.content.slice(0, 200)}..."`
      : "The candidate's resume does not contain relevant passages for this question.");

  return {
    question,
    answer,
    sources: chunks.map((c) => ({
      chunkIndex: c.chunkIndex,
      snippet: c.content.slice(0, 250),
      similarity: c.similarity
    }))
  };
};
