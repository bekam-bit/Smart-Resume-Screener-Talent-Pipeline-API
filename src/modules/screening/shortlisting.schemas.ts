import { z } from "zod";

export const jobShortlistParamsSchema = z.object({
  organizationId: z.string().uuid(),
  jobId: z.string().uuid()
});

export const jobShortlistQuerySchema = z.object({
  topCount: z.coerce.number().int().min(1).max(100).default(5),
  minScore: z.coerce.number().min(0).max(100).default(60),
  autoAdvance: z.coerce.boolean().default(false),
  generateSummary: z.coerce.boolean().default(true)
});

export type JobShortlistQuery = z.infer<typeof jobShortlistQuerySchema>;
