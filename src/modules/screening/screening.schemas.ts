import { z } from "zod";

export const screeningRunParamsSchema = z.object({
  organizationId: z.string().uuid(),
  applicationId: z.string().uuid(),
  runId: z.string().uuid()
});

export const screeningApplicationParamsSchema = z.object({
  organizationId: z.string().uuid(),
  applicationId: z.string().uuid()
});

export const askResumeQuestionSchema = z.object({
  question: z.string().trim().min(3).max(1000)
});

