import type { RequirementType } from "@prisma/client";

export interface RequirementInput {
  id: string;
  name: string;
  description?: string | null;
  type: RequirementType;
  weight?: number | null;
}

export interface RequirementMatch {
  requirementId: string;
  name: string;
  type: RequirementType;
  weight: number;
  matched: boolean;
  snippet: string | null;
}

export interface DeterministicMatchResult {
  score: number;
  requiredTotal: number;
  requiredPassed: number;
  preferredTotal: number;
  preferredPassed: number;
  allRequiredMet: boolean;
  matches: RequirementMatch[];
}

/**
 * Escapes special regex characters in a query string.
 */
const escapeRegex = (str: string): string => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

/**
 * Extracts a snippet around the matched position in text for transparent audit evidence.
 */
const extractSnippet = (text: string, matchIndex: number, matchLength: number, contextRadius = 45): string => {
  const start = Math.max(0, matchIndex - contextRadius);
  const end = Math.min(text.length, matchIndex + matchLength + contextRadius);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  return `${prefix}${text.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`;
};

/**
 * Checks whether a requirement matches the resume text and extracts supporting snippet.
 */
export const matchSingleRequirement = (
  resumeText: string,
  req: RequirementInput
): { matched: boolean; snippet: string | null } => {
  if (!resumeText || !req.name) {
    return { matched: false, snippet: null };
  }

  // Normalize search tokens
  const cleanName = req.name.trim();
  // Match as whole word/phrase case-insensitively
  const regex = new RegExp(`(^|[^a-zA-Z0-9+#.-])${escapeRegex(cleanName)}([^a-zA-Z0-9+#.-]|$)`, "i");
  const match = regex.exec(resumeText);

  if (match) {
    const matchIndex = match.index + (match[1]?.length ?? 0);
    const snippet = extractSnippet(resumeText, matchIndex, cleanName.length);
    return { matched: true, snippet };
  }

  // Fallback: If requirement has multiple keywords, check if major terms are present
  const tokens = cleanName.split(/[\s,/]+/).filter((t) => t.length > 2);
  const firstToken = tokens[0];
  if (firstToken && tokens.length > 1) {
    const allTokensMatch = tokens.every((token) => {
      const tokenRegex = new RegExp(`(^|[^a-zA-Z0-9+#.-])${escapeRegex(token)}([^a-zA-Z0-9+#.-]|$)`, "i");
      return tokenRegex.test(resumeText);
    });

    if (allTokensMatch) {
      const firstTokenMatch = new RegExp(`(^|[^a-zA-Z0-9+#.-])${escapeRegex(firstToken)}([^a-zA-Z0-9+#.-]|$)`, "i").exec(resumeText);
      const idx = firstTokenMatch ? firstTokenMatch.index + (firstTokenMatch[1]?.length ?? 0) : 0;
      return {
        matched: true,
        snippet: extractSnippet(resumeText, idx, firstToken.length)
      };
    }
  }

  return { matched: false, snippet: null };
};

/**
 * Deterministically evaluates all job requirements against candidate resume text.
 */
export const runDeterministicMatcher = (
  resumeText: string,
  requirements: RequirementInput[]
): DeterministicMatchResult => {
  if (requirements.length === 0) {
    return {
      score: 100,
      requiredTotal: 0,
      requiredPassed: 0,
      preferredTotal: 0,
      preferredPassed: 0,
      allRequiredMet: true,
      matches: []
    };
  }

  let totalPointsPossible = 0;
  let pointsEarned = 0;
  let requiredTotal = 0;
  let requiredPassed = 0;
  let preferredTotal = 0;
  let preferredPassed = 0;

  const matches: RequirementMatch[] = [];

  for (const req of requirements) {
    const isRequired = req.type === "REQUIRED";
    const defaultWeight = isRequired ? 10 : 5;
    const weight = req.weight && req.weight > 0 ? req.weight : defaultWeight;

    totalPointsPossible += weight;

    if (isRequired) requiredTotal++;
    else preferredTotal++;

    const { matched, snippet } = matchSingleRequirement(resumeText, req);

    if (matched) {
      pointsEarned += weight;
      if (isRequired) requiredPassed++;
      else preferredPassed++;
    }

    matches.push({
      requirementId: req.id,
      name: req.name,
      type: req.type,
      weight,
      matched,
      snippet
    });
  }

  const calculatedScore = totalPointsPossible > 0
    ? Math.round((pointsEarned / totalPointsPossible) * 10000) / 100
    : 100;

  return {
    score: calculatedScore,
    requiredTotal,
    requiredPassed,
    preferredTotal,
    preferredPassed,
    allRequiredMet: requiredPassed === requiredTotal,
    matches
  };
};
