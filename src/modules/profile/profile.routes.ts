import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import { validateBody, validateParams } from "../../middlewares/validate-request.js";
import { uploadResume } from "../../middlewares/upload-resume.js";
import {
  deleteResumeController,
  getProfileController,
  getResumeController,
  listResumesController,
  updateProfileController,
  uploadResumeController
} from "./profile.controller.js";
import { resumeIdParamSchema, updateProfileSchema } from "./profile.schemas.js";

export const profileRouter = Router();

// All profile/resume routes are scoped to the authenticated candidate ("/me").
profileRouter.use(authenticate);

profileRouter.get("/profile", getProfileController);
profileRouter.patch("/profile", validateBody(updateProfileSchema), updateProfileController);

profileRouter.get("/resumes", listResumesController);
profileRouter.post("/resumes", uploadResume, uploadResumeController);
profileRouter.get("/resumes/:resumeId", validateParams(resumeIdParamSchema), getResumeController);
profileRouter.delete("/resumes/:resumeId", validateParams(resumeIdParamSchema), deleteResumeController);
