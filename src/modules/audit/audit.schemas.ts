import { z } from "zod";
import { paginationSchema } from "../../schemas/common.schema.js";

export const organizationAuditParamsSchema = z.object({
  organizationId: z.string().uuid()
});

export const listAuditLogsQuerySchema = paginationSchema.extend({
  actorId: z.string().uuid().optional(),
  resourceType: z.string().trim().optional(),
  action: z.string().trim().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional()
});

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
