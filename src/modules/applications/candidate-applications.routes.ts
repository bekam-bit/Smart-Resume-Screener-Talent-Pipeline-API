import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import { validateBody, validateParams } from "../../middlewares/validate-request.js";
import {
  applyToJobController,
  getMyApplicationController,
  listMyApplicationsController,
  withdrawApplicationController
} from "./applications.controller.js";
import { applyToJobSchema, applicationIdParamSchema, publicJobParamsApplicationSchema } from "./applications.schemas.js";

/** Candidate-facing application actions. Every route is authenticated individually
 *  (this router is mounted at the API root, so a global auth guard would also
 *  block the public job board routes that fall through to the jobs router). */
export const candidateApplicationsRouter = Router();

// Apply to a published job.
candidateApplicationsRouter.post(
  "/jobs/:jobId/applications",
  authenticate,
  validateParams(publicJobParamsApplicationSchema),
  validateBody(applyToJobSchema),
  applyToJobController
);

// The candidate's own applications.
candidateApplicationsRouter.get("/applications", authenticate, listMyApplicationsController);
candidateApplicationsRouter.get(
  "/applications/:applicationId",
  authenticate,
  validateParams(applicationIdParamSchema),
  getMyApplicationController
);
candidateApplicationsRouter.post(
  "/applications/:applicationId/withdraw",
  authenticate,
  validateParams(applicationIdParamSchema),
  withdrawApplicationController
);
