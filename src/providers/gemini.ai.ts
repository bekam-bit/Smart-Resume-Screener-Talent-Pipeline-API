import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import type { DeterministicMatchResult } from "../modules/screening/deterministic-matcher.js";

export interface AiScreeningInput {
  jobTitle: string;
  jobDescription?: string | null;
  resumeText: string;
  deterministicResult: DeterministicMatchResult;
}

export interface AiScreeningResult {
  summary: string;
  strengths: string[];
  gaps: string[];
  recommendation: "ADVANCE" | "REVIEW" | "REJECT";
  suggestedQuestions: string[];
  advisoryScore: number;
  provider: string;
  model: string;
}

/**
 * Fallback synthesizer that generates structured, explainable advisory output
 * from deterministic match data when external AI services are unavailable or in test environments.
 */
export const generateDeterministicAdvisory = (
  input: AiScreeningInput
): AiScreeningResult => {
  const { deterministicResult, jobTitle } = input;
  const matched = deterministicResult.matches.filter((m) => m.matched);
  const unmet = deterministicResult.matches.filter((m) => !m.matched);

  const strengths = matched.map((m) =>
    `Demonstrated profile alignment with ${m.type.toLowerCase()} requirement: ${m.name}`
  );
  if (strengths.length === 0) {
    strengths.push("Candidate submitted resume with relevant career background.");
  }

  const gaps = unmet.map((m) =>
    `Unverified or missing explicit mention for ${m.type.toLowerCase()} requirement: ${m.name}`
  );
  if (gaps.length === 0) {
    gaps.push("No critical requirement gaps detected in profile text.");
  }

  const suggestedQuestions = unmet.slice(0, 3).map((m) =>
    `Can you describe your practical experience working with ${m.name}?`
  );
  if (suggestedQuestions.length === 0) {
    suggestedQuestions.push(`What specific achievements in ${jobTitle} are you most proud of?`);
  }

  let recommendation: "ADVANCE" | "REVIEW" | "REJECT" = "REVIEW";
  if (deterministicResult.allRequiredMet && deterministicResult.score >= 70) {
    recommendation = "ADVANCE";
  } else if (!deterministicResult.allRequiredMet && deterministicResult.score < 40) {
    recommendation = "REJECT";
  }

  return {
    summary: `Advisory screening completed for ${jobTitle}. Candidate satisfied ${deterministicResult.requiredPassed}/${deterministicResult.requiredTotal} required and ${deterministicResult.preferredPassed}/${deterministicResult.preferredTotal} preferred requirements with an overall deterministic alignment of ${deterministicResult.score}%.`,
    strengths,
    gaps,
    recommendation,
    suggestedQuestions,
    advisoryScore: deterministicResult.score,
    provider: "deterministic-fallback",
    model: "rules-engine-v1"
  };
};

/**
 * Calls Google Gemini API for explainable advisory screening.
 * Falls back safely to deterministic advisory if the API is offline or key is invalid.
 */
export const screenWithGemini = async (input: AiScreeningInput): Promise<AiScreeningResult> => {
  const apiKey = env.GEMINI_API_KEY;

  if (!apiKey || env.NODE_ENV === "test") {
    return generateDeterministicAdvisory(input);
  }

  const prompt = `You are an AI recruitment assistant providing explainable, unbiased, ADVISORY screening feedback for a candidate's resume relative to a job posting.
Hiring decisions remain solely with authorized human recruiters.

Job Title: ${input.jobTitle}
Job Description: ${input.jobDescription ?? "N/A"}

Requirements Evaluated:
${input.deterministicResult.matches
  .map((m) => `- [${m.type}] ${m.name}: ${m.matched ? "MATCHED (" + (m.snippet ?? "") + ")" : "NOT FOUND"}`)
  .join("\n")}

Resume Content (excerpt):
"""
${input.resumeText.slice(0, 3500)}
"""

Provide an explainable evaluation in valid JSON strictly matching this schema:
{
  "summary": string (2-3 concise sentences summarizing candidate fit),
  "strengths": string[] (2-4 key strengths),
  "gaps": string[] (1-3 potential gaps or unverified criteria),
  "recommendation": "ADVANCE" | "REVIEW" | "REJECT" (advisory recommendation),
  "suggestedQuestions": string[] (2-3 interview questions to probe gaps),
  "advisoryScore": number (0 to 100 integer score)
}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json"
        }
      }),
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      logger.warn("gemini_api_warning", {
        status: response.status,
        statusText: response.statusText,
        msg: "Falling back to deterministic advisory"
      });
      return generateDeterministicAdvisory(input);
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      return generateDeterministicAdvisory(input);
    }

    const parsed = JSON.parse(rawText) as Partial<AiScreeningResult>;

    return {
      summary: parsed.summary ?? `Candidate evaluated for ${input.jobTitle}`,
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths : ["Relevant domain experience"],
      gaps: Array.isArray(parsed.gaps) ? parsed.gaps : ["Verify specific technical requirements"],
      recommendation:
        parsed.recommendation === "ADVANCE" || parsed.recommendation === "REJECT"
          ? parsed.recommendation
          : "REVIEW",
      suggestedQuestions: Array.isArray(parsed.suggestedQuestions)
        ? parsed.suggestedQuestions
        : [`Can you detail your background in ${input.jobTitle}?`],
      advisoryScore: typeof parsed.advisoryScore === "number" ? parsed.advisoryScore : input.deterministicResult.score,
      provider: "google-gemini",
      model: "gemini-1.5-flash"
    };
  } catch (error) {
    logger.warn("gemini_api_error", {
      error: error instanceof Error ? error.message : String(error),
      msg: "Using deterministic advisory fallback"
    });
    return generateDeterministicAdvisory(input);
  }
};
