import { z } from "zod";
import { paginationSchema } from "../../schemas/common.schema.js";

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(slugPattern, "slug must be lowercase words separated by single hyphens")
    .min(2)
    .max(60)
    .optional()
});

export const updateOrganizationSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(slugPattern, "slug must be lowercase words separated by single hyphens")
      .min(2)
      .max(60)
      .optional()
  })
  .refine((value) => value.name !== undefined || value.slug !== undefined, {
    message: "Provide at least one field to update"
  });

export const organizationParamsSchema = z.object({ organizationId: z.string().uuid() });

export const memberParamsSchema = z.object({
  organizationId: z.string().uuid(),
  userId: z.string().uuid()
});

export const addMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(["ADMIN", "RECRUITER"]).default("RECRUITER")
});

export const updateMemberSchema = z
  .object({
    role: z.enum(["ADMIN", "RECRUITER"]).optional(),
    status: z.enum(["ACTIVE", "INVITED", "REMOVED"]).optional()
  })
  .refine((value) => value.role !== undefined || value.status !== undefined, {
    message: "Provide role and/or status to update"
  });

export const listMembersQuerySchema = paginationSchema;

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
export type AddMemberInput = z.infer<typeof addMemberSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;