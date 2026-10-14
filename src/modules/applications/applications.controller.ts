import type { Request, Response } from "express";
import { AppError } from "../../utils/app-error.js";
import { parseOrThrow } from "../../middlewares/validate-request.js";
import { respondList } from "../../schemas/common.schema.js";
import {
  addNoteSchema,
  applicationIdParamSchema,
  applyToJobSchema,
  changeApplicationStatusSchema,
  listJobApplicationsQuerySchema,
  listMyApplicationsQuerySchema,
  organizationApplicationParamsSchema,
  organizationJobApplicationsParamsSchema,
  publicJobParamsApplicationSchema
} from "./applications.schemas.js";
import {
  addNote,
  applyToJob,
  changeApplicationStatus,
  getMyApplication,
  getOrgApplication,
  listApplicationEvents,
  listJobApplications,
  listMyApplications,
  withdrawApplication
} from "./applications.service.js";

const actorId = (request: Request) => {
  if (!request.userId) throw new AppError("UNAUTHENTICATED", "Authentication is required", 401);
  return request.userId;
};

// ── Candidate ──
export const applyToJobController = async (request: Request, response: Response) => {
  const { jobId } = parseOrThrow(publicJobParamsApplicationSchema, request.params);
  const application = await applyToJob(actorId(request), jobId, parseOrThrow(applyToJobSchema, request.body));
  response.status(201).json({ application });
};

export const listMyApplicationsController = async (request: Request, response: Response) => {
  const query = parseOrThrow(listMyApplicationsQuerySchema, request.query);
  const { total, applications } = await listMyApplications(actorId(request), query);
  respondList(response, applications, query, total);
};

export const getMyApplicationController = async (request: Request, response: Response) => {
  const { applicationId } = parseOrThrow(applicationIdParamSchema, request.params);
  const application = await getMyApplication(actorId(request), applicationId);
  response.json({ application });
};

export const withdrawApplicationController = async (request: Request, response: Response) => {
  const { applicationId } = parseOrThrow(applicationIdParamSchema, request.params);
  const application = await withdrawApplication(actorId(request), applicationId);
  response.json({ application });
};

// ── Recruiter ──
export const listJobApplicationsController = async (request: Request, response: Response) => {
  const { organizationId, jobId } = parseOrThrow(organizationJobApplicationsParamsSchema, request.params);
  const query = parseOrThrow(listJobApplicationsQuerySchema, request.query);
  const { total, applications } = await listJobApplications(organizationId, jobId, query);
  respondList(response, applications, query, total);
};

export const getOrgApplicationController = async (request: Request, response: Response) => {
  const { organizationId, applicationId } = parseOrThrow(organizationApplicationParamsSchema, request.params);
  const application = await getOrgApplication(organizationId, applicationId);
  response.json({ application });
};

export const changeApplicationStatusController = async (request: Request, response: Response) => {
  const { organizationId, applicationId } = parseOrThrow(organizationApplicationParamsSchema, request.params);
  const application = await changeApplicationStatus(
    organizationId,
    actorId(request),
    applicationId,
    parseOrThrow(changeApplicationStatusSchema, request.body)
  );
  response.json({ application });
};

export const addNoteController = async (request: Request, response: Response) => {
  const { organizationId, applicationId } = parseOrThrow(organizationApplicationParamsSchema, request.params);
  const note = await addNote(organizationId, actorId(request), applicationId, parseOrThrow(addNoteSchema, request.body));
  response.status(201).json({ note });
};

export const listApplicationEventsController = async (request: Request, response: Response) => {
  const { organizationId, applicationId } = parseOrThrow(organizationApplicationParamsSchema, request.params);
  const events = await listApplicationEvents(organizationId, applicationId);
  response.json({ data: events });
};
