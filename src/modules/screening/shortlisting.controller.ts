import type { Request, Response } from "express";
import { compareAndShortlistJobApplications } from "./shortlisting.service.js";

export const compareCandidatesController = async (request: Request, response: Response) => {
  const organizationId = request.params.organizationId as string;
  const jobId = request.params.jobId as string;
  const actorUserId = request.userId;

  // Supports parameters from either query string (GET) or request body (POST)
  const topCount = request.body?.topCount ?? request.query.topCount;
  const minScore = request.body?.minScore ?? request.query.minScore;
  const autoAdvance = request.body?.autoAdvance ?? (request.query.autoAdvance === "true");
  const generateSummary =
    request.body?.generateSummary !== undefined
      ? Boolean(request.body.generateSummary)
      : request.query.generateSummary !== undefined
        ? request.query.generateSummary !== "false"
        : true;

  const result = await compareAndShortlistJobApplications({
    organizationId,
    jobId,
    topCount: topCount !== undefined ? Number(topCount) : undefined,
    minScore: minScore !== undefined ? Number(minScore) : undefined,
    autoAdvance: Boolean(autoAdvance),
    generateSummary,
    actorUserId
  });

  response.status(200).json({
    success: true,
    data: result
  });
};
