import { z } from "zod";
import { paginationSchema, sortParamSchema } from "../../schemas/common.schema.js";

export const applicationStatusSchema = z.enum([
  "SUBMITTED",
  "SCREENING",
  "IN_REVIEW",
  "SHORTLISTED",
  "INTERVIEW",
  "OFFER",
  "HIRED",
  "REJECTED",
  "WITHDRAWN"
]);

// Recruiter-driven transitions must target one of the in-flight stages or REJECTED.
export const recruiterStatusSchema = z.enum([
  "SCREENING",
  "IN_REVIEW",
  "SHORTLISTED",
  "INTERVIEW",
  "OFFER",
  "HIRED",
  "REJECTED"
]);

export const applyToJobSchema = z.object({
  resumeId: z.string().uuid(),
  coverLetter: z.string().trim().max(5000).optional()
});

export const publicJobParamsApplicationSchema = z.object({ jobId: z.string().uuid() });

export const applicationIdParamSchema = z.object({ applicationId: z.string().uuid() });

export const organizationApplicationParamsSchema = z.object({
  organizationId: z.string().uuid(),
  applicationId: z.string().uuid()
});

export const organizationJobApplicationsParamsSchema = z.object({
  organizationId: z.string().uuid(),
  jobId: z.string().uuid()
});

export const listMyApplicationsQuerySchema = paginationSchema.extend({
  status: applicationStatusSchema.optional()
});

export const listJobApplicationsQuerySchema = paginationSchema.extend({
  status: applicationStatusSchema.optional(),
  sort: sortParamSchema(["submittedAt", "status"])
});

export const changeApplicationStatusSchema = z
  .object({
    status: recruiterStatusSchema,
    reason: z.string().trim().max(1000).optional(),
    candidateVisible: z.boolean().optional()
  })
  .refine(
    (value) => value.status !== "REJECTED" || (value.reason !== undefined && value.reason.trim().length > 0),
    { message: "A reason is required when rejecting an application", path: ["reason"] }
  );

export const addNoteSchema = z.object({
  body: z.string().trim().min(1).max(5000)
});

export type ApplyToJobInput = z.infer<typeof applyToJobSchema>;
export type ChangeApplicationStatusInput = z.infer<typeof changeApplicationStatusSchema>;
export type AddNoteInput = z.infer<typeof addNoteSchema>;
export type ListMyApplicationsQuery = z.infer<typeof listMyApplicationsQuerySchema>;
export type ListJobApplicationsQuery = z.infer<typeof listJobApplicationsQuerySchema>;
