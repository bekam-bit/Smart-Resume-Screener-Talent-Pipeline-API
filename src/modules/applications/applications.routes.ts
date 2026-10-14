import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import {
  requireOrganizationApplicationPermission,
  requireOrganizationJobPermission
} from "../../middlewares/authorize-organization.js";
import { validateBody, validateParams } from "../../middlewares/validate-request.js";
import {
  addNoteController,
  changeApplicationStatusController,
  getOrgApplicationController,
  listApplicationEventsController,
  listJobApplicationsController
} from "./applications.controller.js";
import {
  addNoteSchema,
  changeApplicationStatusSchema,
  organizationApplicationParamsSchema,
  organizationJobApplicationsParamsSchema
} from "./applications.schemas.js";

/** Recruiter-facing application management, scoped to an organization. */
export const organizationApplicationsRouter = Router();

organizationApplicationsRouter.get(
  "/:organizationId/jobs/:jobId/applications",
  authenticate,
  validateParams(organizationJobApplicationsParamsSchema),
  requireOrganizationJobPermission("application:read"),
  listJobApplicationsController
);

organizationApplicationsRouter.get(
  "/:organizationId/applications/:applicationId",
  authenticate,
  validateParams(organizationApplicationParamsSchema),
  requireOrganizationApplicationPermission("application:read"),
  getOrgApplicationController
);

organizationApplicationsRouter.patch(
  "/:organizationId/applications/:applicationId/status",
  authenticate,
  validateParams(organizationApplicationParamsSchema),
  requireOrganizationApplicationPermission("application:advance"),
  validateBody(changeApplicationStatusSchema),
  changeApplicationStatusController
);

organizationApplicationsRouter.post(
  "/:organizationId/applications/:applicationId/notes",
  authenticate,
  validateParams(organizationApplicationParamsSchema),
  requireOrganizationApplicationPermission("application:advance"),
  validateBody(addNoteSchema),
  addNoteController
);

organizationApplicationsRouter.get(
  "/:organizationId/applications/:applicationId/events",
  authenticate,
  validateParams(organizationApplicationParamsSchema),
  requireOrganizationApplicationPermission("application:read"),
  listApplicationEventsController
);