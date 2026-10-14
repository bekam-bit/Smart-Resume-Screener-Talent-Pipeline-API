import type { Request, Response } from "express";
import {
  getScreeningRun,
  listScreeningRuns,
  triggerScreening
} from "./screening.service.js";
import { askResumeQuestion } from "./rag.service.js";

export const triggerScreeningController = async (request: Request, response: Response) => {
  const organizationId = request.params.organizationId as string;
  const applicationId = request.params.applicationId as string;
  const actorId = request.userId!;

  const run = await triggerScreening(organizationId, applicationId, actorId);

  response.status(202).json({
    success: true,
    data: run
  });
};

export const listScreeningRunsController = async (request: Request, response: Response) => {
  const organizationId = request.params.organizationId as string;
  const applicationId = request.params.applicationId as string;

  const runs = await listScreeningRuns(organizationId, applicationId);

  response.status(200).json({
    success: true,
    data: { runs }
  });
};

export const getScreeningRunController = async (request: Request, response: Response) => {
  const organizationId = request.params.organizationId as string;
  const applicationId = request.params.applicationId as string;
  const runId = request.params.runId as string;

  const run = await getScreeningRun(organizationId, applicationId, runId);

  response.status(200).json({
    success: true,
    data: run
  });
};

export const askResumeQuestionController = async (request: Request, response: Response) => {
  const organizationId = request.params.organizationId as string;
  const applicationId = request.params.applicationId as string;
  const { question } = request.body as { question: string };

  const result = await askResumeQuestion(organizationId, applicationId, question);

  response.status(200).json({
    success: true,
    data: result
  });
};

