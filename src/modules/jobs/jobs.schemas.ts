import { z } from "zod";
import { paginationSchema, sortParamSchema } from "../../schemas/common.schema.js";

const requirementTypeSchema = z.enum(["REQUIRED", "PREFERRED"]);
const remotePolicySchema = z.enum(["ONSITE", "HYBRID", "REMOTE"]);
const employmentTypeSchema = z.enum(["FULL_TIME", "PART_TIME", "CONTRACT", "INTERNSHIP", "TEMPORARY"]);
const jobStatusSchema = z.enum(["DRAFT", "PUBLISHED", "PAUSED", "CLOSED"]);

export const requirementInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).optional(),
  type: requirementTypeSchema,
  weight: z.number().int().min(0).max(100).optional()
});

export const createJobSchema = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().min(20).max(20_000),
  location: z.string().trim().max(120).optional(),
  remotePolicy: remotePolicySchema.optional(),
  employmentType: employmentTypeSchema.optional(),
  requirements: z.array(requirementInputSchema).max(50).optional()
});

export const updateJobSchema = z
  .object({
    title: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().min(20).max(20_000).optional(),
    location: z.string().trim().max(120).nullable().optional(),
    remotePolicy: remotePolicySchema.nullable().optional(),
    employmentType: employmentTypeSchema.nullable().optional(),
    // Replaces the whole requirement list when provided (only allowed while
    // the job is not published or closed).
    requirements: z.array(requirementInputSchema).max(50).optional()
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.description !== undefined ||
      value.location !== undefined ||
      value.remotePolicy !== undefined ||
      value.employmentType !== undefined ||
      value.requirements !== undefined,
    { message: "Provide at least one field to update" }
  );

export const createRequirementSchema = requirementInputSchema;

export const updateRequirementSchema = requirementInputSchema
  .partial()
  .refine(
    (value) => value.name !== undefined || value.description !== undefined || value.type !== undefined || value.weight !== undefined,
    { message: "Provide at least one field to update" }
  );

export const organizationJobsParamsSchema = z.object({ organizationId: z.string()});

export const organizationJobParamsSchema = z.object({
  organizationId: z.string(),
  jobId: z.string()
});

export const jobRequirementParamsSchema = z.object({
  organizationId: z.string(),
  jobId: z.string(),
  requirementId: z.string()
});

export const publicJobParamsSchema = z.object({ jobId: z.string()});

export const listOrgJobsQuerySchema = paginationSchema.extend({
  status: jobStatusSchema.optional(),
  q: z.string().trim().min(1).max(100).optional(),
  sort: sortParamSchema(["title", "createdAt", "publishedAt", "status"])
});

export const listPublicJobsQuerySchema = paginationSchema.extend({
  q: z.string().trim().min(1).max(100).optional(),
  location: z.string().trim().min(1).max(120).optional(),
  remotePolicy: remotePolicySchema.optional(),
  employmentType: employmentTypeSchema.optional(),
  sort: sortParamSchema(["publishedAt", "title"])
});

export const changeJobStatusSchema = z.object({ status: jobStatusSchema });

export type CreateJobInput = z.infer<typeof createJobSchema>;
export type ChangeJobStatusInput = z.infer<typeof changeJobStatusSchema>;
export type UpdateJobInput = z.infer<typeof updateJobSchema>;
export type CreateRequirementInput = z.infer<typeof createRequirementSchema>;
export type UpdateRequirementInput = z.infer<typeof updateRequirementSchema>;
export type ListOrgJobsQuery = z.infer<typeof listOrgJobsQuerySchema>;
export type ListPublicJobsQuery = z.infer<typeof listPublicJobsQuerySchema>;
export type RequirementInput = z.infer<typeof requirementInputSchema>;
