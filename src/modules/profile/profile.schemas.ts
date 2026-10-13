import { z } from "zod";

const urlSchema = z.string().trim().url("must be a valid URL").max(2048);

export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    phone: z.string().trim().min(3).max(40).nullable().optional(),
    portfolioUrl: urlSchema.nullable().optional(),
    location: z.string().trim().max(120).nullable().optional()
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.phone !== undefined ||
      value.portfolioUrl !== undefined ||
      value.location !== undefined,
    { message: "Provide at least one field to update" }
  );

export const resumeIdParamSchema = z.object({ resumeId: z.string().uuid() });

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
