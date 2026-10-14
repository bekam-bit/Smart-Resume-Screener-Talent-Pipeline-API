import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import {
  requireOrganizationApplicationPermission,
  requireOrganizationJobPermission
} from "../../middlewares/authorize-organization.js";
import { validateBody, validateParams } from "../../middlewares/validate-request.js";
import {
  askResumeQuestionController,
  getScreeningRunController,
  listScreeningRunsController,
  triggerScreeningController
} from "./screening.controller.js";
import { compareCandidatesController } from "./shortlisting.controller.js";
import {
  askResumeQuestionSchema,
  screeningApplicationParamsSchema,
  screeningRunParamsSchema
} from "./screening.schemas.js";
import { jobShortlistParamsSchema } from "./shortlisting.schemas.js";

export const screeningRouter = Router();

screeningRouter.post(
  "/:organizationId/applications/:applicationId/screen",
  authenticate,
  validateParams(screeningApplicationParamsSchema),
  requireOrganizationApplicationPermission("application:advance"),
  triggerScreeningController
);

screeningRouter.get(
  "/:organizationId/applications/:applicationId/screening-runs",
  authenticate,
  validateParams(screeningApplicationParamsSchema),
  requireOrganizationApplicationPermission("screening:read"),
  listScreeningRunsController
);

screeningRouter.get(
  "/:organizationId/applications/:applicationId/screening-runs/:runId",
  authenticate,
  validateParams(screeningRunParamsSchema),
  requireOrganizationApplicationPermission("screening:read"),
  getScreeningRunController
);

screeningRouter.post(
  "/:organizationId/applications/:applicationId/ask",
  authenticate,
  validateParams(screeningApplicationParamsSchema),
  validateBody(askResumeQuestionSchema),
  requireOrganizationApplicationPermission("screening:read"),
  askResumeQuestionController
);

screeningRouter.get(
  "/:organizationId/jobs/:jobId/candidates/compare",
  authenticate,
  validateParams(jobShortlistParamsSchema),
  requireOrganizationJobPermission("application:read"),
  compareCandidatesController
);

screeningRouter.post(
  "/:organizationId/jobs/:jobId/shortlist",
  authenticate,
  validateParams(jobShortlistParamsSchema),
  requireOrganizationJobPermission("application:advance"),
  compareCandidatesController
);