import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import { requireOrganizationPermission } from "../../middlewares/authorize-organization.js";
import { validateBody, validateParams } from "../../middlewares/validate-request.js";
import {
  addMemberController,
  createOrganizationController,
  getOrganizationController,
  listMembersController,
  removeMemberController,
  updateMemberController,
  updateOrganizationController
} from "./organizations.controller.js";
import {
  addMemberSchema,
  createOrganizationSchema,
  memberParamsSchema,
  organizationParamsSchema,
  updateMemberSchema,
  updateOrganizationSchema
} from "./organizations.schemas.js";

export const organizationsRouter = Router();

organizationsRouter.post("/", authenticate, validateBody(createOrganizationSchema), createOrganizationController);

organizationsRouter.get(
  "/:organizationId",
  authenticate,
  validateParams(organizationParamsSchema),
  requireOrganizationPermission("organization:read"),
  getOrganizationController
);

organizationsRouter.patch(
  "/:organizationId",
  authenticate,
  validateParams(organizationParamsSchema),
  requireOrganizationPermission("organization:update"),
  validateBody(updateOrganizationSchema),
  updateOrganizationController
);

organizationsRouter.get(
  "/:organizationId/members",
  authenticate,
  validateParams(organizationParamsSchema),
  requireOrganizationPermission("organization:read"),
  listMembersController
);

organizationsRouter.post(
  "/:organizationId/members",
  authenticate,
  validateParams(organizationParamsSchema),
  requireOrganizationPermission("organization:members:manage"),
  validateBody(addMemberSchema),
  addMemberController
);

organizationsRouter.patch(
  "/:organizationId/members/:userId",
  authenticate,
  validateParams(memberParamsSchema),
  requireOrganizationPermission("organization:members:manage"),
  validateBody(updateMemberSchema),
  updateMemberController
);

organizationsRouter.delete(
  "/:organizationId/members/:userId",
  authenticate,
  validateParams(memberParamsSchema),
  requireOrganizationPermission("organization:members:manage"),
  removeMemberController
);