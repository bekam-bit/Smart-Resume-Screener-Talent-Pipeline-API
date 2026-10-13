import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import {
  requireOrganizationJobPermission,
  requireOrganizationPermission
} from "../../middlewares/authorize-organization.js";
import { validateBody, validateParams } from "../../middlewares/validate-request.js";
import {
  addRequirementController,
  changeJobStatusController,
  createJobController,
  deleteJobController,
  getJobController,
  getPublicJobController,
  listOrgJobsController,
  listPublicJobsController,
  removeRequirementController,
  updateJobController,
  updateRequirementController
} from "./jobs.controller.js";
import {
  changeJobStatusSchema,
  createJobSchema,
  createRequirementSchema,
  jobRequirementParamsSchema,
  organizationJobParamsSchema,
  organizationJobsParamsSchema,
  publicJobParamsSchema,
  updateJobSchema,
  updateRequirementSchema
} from "./jobs.schemas.js";

export const jobsRouter = Router();

// ── Public job board (no authentication) ──
jobsRouter.get("/jobs", listPublicJobsController);
jobsRouter.get("/jobs/:jobId", validateParams(publicJobParamsSchema), getPublicJobController);

// ── Org-scoped job management ──
jobsRouter.post(
  "/organizations/:organizationId/jobs",
  authenticate,
  validateParams(organizationJobsParamsSchema),
  requireOrganizationPermission("job:create"),
  validateBody(createJobSchema),
  createJobController
);

jobsRouter.get(
  "/organizations/:organizationId/jobs",
  authenticate,
  validateParams(organizationJobsParamsSchema),
  requireOrganizationPermission("job:read"),
  listOrgJobsController
);

jobsRouter.get(
  "/organizations/:organizationId/jobs/:jobId",
  authenticate,
  validateParams(organizationJobParamsSchema),
  requireOrganizationJobPermission("job:read"),
  getJobController
);

jobsRouter.patch(
  "/organizations/:organizationId/jobs/:jobId",
  authenticate,
  validateParams(organizationJobParamsSchema),
  requireOrganizationJobPermission("job:update"),
  validateBody(updateJobSchema),
  updateJobController
);

jobsRouter.patch(
  "/organizations/:organizationId/jobs/:jobId/status",
  authenticate,
  validateParams(organizationJobParamsSchema),
  requireOrganizationJobPermission("job:publish"),
  validateBody(changeJobStatusSchema),
  changeJobStatusController
);

jobsRouter.delete(
  "/organizations/:organizationId/jobs/:jobId",
  authenticate,
  validateParams(organizationJobParamsSchema),
  requireOrganizationJobPermission("job:update"),
  deleteJobController
);

// ── Requirements ──
jobsRouter.post(
  "/organizations/:organizationId/jobs/:jobId/requirements",
  authenticate,
  validateParams(organizationJobParamsSchema),
  requireOrganizationJobPermission("job:update"),
  validateBody(createRequirementSchema),
  addRequirementController
);

jobsRouter.patch(
  "/organizations/:organizationId/jobs/:jobId/requirements/:requirementId",
  authenticate,
  validateParams(jobRequirementParamsSchema),
  requireOrganizationJobPermission("job:update"),
  validateBody(updateRequirementSchema),
  updateRequirementController
);

jobsRouter.delete(
  "/organizations/:organizationId/jobs/:jobId/requirements/:requirementId",
  authenticate,
  validateParams(jobRequirementParamsSchema),
  requireOrganizationJobPermission("job:update"),
  removeRequirementController
);