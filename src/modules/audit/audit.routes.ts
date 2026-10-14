import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import { requireOrganizationPermission } from "../../middlewares/authorize-organization.js";
import { validateParams, validateQuery } from "../../middlewares/validate-request.js";
import { listAuditLogsController } from "./audit.controller.js";
import {
  listAuditLogsQuerySchema,
  organizationAuditParamsSchema
} from "./audit.schemas.js";

export const auditRouter = Router();

auditRouter.get(
  "/:organizationId/audit-logs",
  authenticate,
  validateParams(organizationAuditParamsSchema),
  requireOrganizationPermission("audit:read"),
  validateQuery(listAuditLogsQuerySchema),
  listAuditLogsController
);