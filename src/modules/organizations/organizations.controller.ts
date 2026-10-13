import type { Request, Response } from "express";
import { AppError } from "../../utils/app-error.js";
import { parseOrThrow } from "../../middlewares/validate-request.js";
import { respondList } from "../../schemas/common.schema.js";
import {
  addMemberSchema,
  createOrganizationSchema,
  listMembersQuerySchema,
  memberParamsSchema,
  organizationParamsSchema,
  updateMemberSchema,
  updateOrganizationSchema
} from "./organizations.schemas.js";
import {
  addMember,
  createOrganization,
  getOrganization,
  listMembers,
  removeMember,
  updateMember,
  updateOrganization
} from "./organizations.service.js";

const actorId = (request: Request) => {
  if (!request.userId) throw new AppError("UNAUTHENTICATED", "Authentication is required", 401);
  return request.userId;
};

export const createOrganizationController = async (request: Request, response: Response) => {
  const organization = await createOrganization(actorId(request), parseOrThrow(createOrganizationSchema, request.body));
  response.status(201).json({ organization });
};

export const getOrganizationController = async (request: Request, response: Response) => {
  const { organizationId } = parseOrThrow(organizationParamsSchema, request.params);
  const organization = await getOrganization(organizationId, actorId(request));
  response.json({ organization });
};

export const updateOrganizationController = async (request: Request, response: Response) => {
  const { organizationId } = parseOrThrow(organizationParamsSchema, request.params);
  const organization = await updateOrganization(
    organizationId,
    actorId(request),
    parseOrThrow(updateOrganizationSchema, request.body)
  );
  response.json({ organization });
};

export const listMembersController = async (request: Request, response: Response) => {
  const { organizationId } = parseOrThrow(organizationParamsSchema, request.params);
  const pagination = parseOrThrow(listMembersQuerySchema, request.query);
  const { total, members } = await listMembers(organizationId, pagination);
  respondList(response, members, pagination, total);
};

export const addMemberController = async (request: Request, response: Response) => {
  const { organizationId } = parseOrThrow(organizationParamsSchema, request.params);
  const member = await addMember(organizationId, actorId(request), parseOrThrow(addMemberSchema, request.body));
  response.status(201).json({ member });
};

export const updateMemberController = async (request: Request, response: Response) => {
  const { organizationId, userId } = parseOrThrow(memberParamsSchema, request.params);
  const member = await updateMember(
    organizationId,
    actorId(request),
    userId,
    parseOrThrow(updateMemberSchema, request.body)
  );
  response.json({ member });
};

export const removeMemberController = async (request: Request, response: Response) => {
  const { organizationId, userId } = parseOrThrow(memberParamsSchema, request.params);
  await removeMember(organizationId, actorId(request), userId);
  response.status(204).send();
};
