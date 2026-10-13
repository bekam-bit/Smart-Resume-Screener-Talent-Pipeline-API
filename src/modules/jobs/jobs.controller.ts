import type { Request, Response } from "express";
import { AppError } from "../../utils/app-error.js";
import { parseOrThrow } from "../../middlewares/validate-request.js";
import { respondList } from "../../schemas/common.schema.js";
import {
  changeJobStatusSchema,
  createJobSchema,
  createRequirementSchema,
  jobRequirementParamsSchema,
  listOrgJobsQuerySchema,
  listPublicJobsQuerySchema,
  organizationJobParamsSchema,
  organizationJobsParamsSchema,
  publicJobParamsSchema,
  updateJobSchema,
  updateRequirementSchema
} from "./jobs.schemas.js";
import {
  addRequirement,
  changeJobStatus,
  createJob,
  deleteJob,
  getJob,
  getPublicJob,
  listOrgJobs,
  listPublicJobs,
  removeRequirement,
  updateJob,
  updateRequirement
} from "./jobs.service.js";

const actorId = (request: Request) => {
  if (!request.userId) throw new AppError("UNAUTHENTICATED", "Authentication is required", 401);
  return request.userId;
};

export const createJobController = async (request: Request, response: Response) => {
  const { organizationId } = parseOrThrow(organizationJobsParamsSchema, request.params);
  const job = await createJob(organizationId, actorId(request), parseOrThrow(createJobSchema, request.body));
  response.status(201).json({ job });
};

export const listOrgJobsController = async (request: Request, response: Response) => {
  const { organizationId } = parseOrThrow(organizationJobsParamsSchema, request.params);
  const query = parseOrThrow(listOrgJobsQuerySchema, request.query);
  const { total, jobs } = await listOrgJobs(organizationId, query);
  respondList(response, jobs, query, total);
};

export const getJobController = async (request: Request, response: Response) => {
  const { organizationId, jobId } = parseOrThrow(organizationJobParamsSchema, request.params);
  const job = await getJob(organizationId, jobId);
  response.json({ job });
};

export const updateJobController = async (request: Request, response: Response) => {
  const { organizationId, jobId } = parseOrThrow(organizationJobParamsSchema, request.params);
  const job = await updateJob(organizationId, actorId(request), jobId, parseOrThrow(updateJobSchema, request.body));
  response.json({ job });
};

export const changeJobStatusController = async (request: Request, response: Response) => {
  const { organizationId, jobId } = parseOrThrow(organizationJobParamsSchema, request.params);
  const job = await changeJobStatus(
    organizationId,
    actorId(request),
    jobId,
    parseOrThrow(changeJobStatusSchema, request.body)
  );
  response.json({ job });
};

export const deleteJobController = async (request: Request, response: Response) => {
  const { organizationId, jobId } = parseOrThrow(organizationJobParamsSchema, request.params);
  await deleteJob(organizationId, actorId(request), jobId);
  response.status(204).send();
};

export const addRequirementController = async (request: Request, response: Response) => {
  const { organizationId, jobId } = parseOrThrow(organizationJobParamsSchema, request.params);
  const requirement = await addRequirement(
    organizationId,
    actorId(request),
    jobId,
    parseOrThrow(createRequirementSchema, request.body)
  );
  response.status(201).json({ requirement });
};

export const updateRequirementController = async (request: Request, response: Response) => {
  const { organizationId, jobId, requirementId } = parseOrThrow(jobRequirementParamsSchema, request.params);
  const requirement = await updateRequirement(
    organizationId,
    actorId(request),
    jobId,
    requirementId,
    parseOrThrow(updateRequirementSchema, request.body)
  );
  response.json({ requirement });
};

export const removeRequirementController = async (request: Request, response: Response) => {
  const { organizationId, jobId, requirementId } = parseOrThrow(jobRequirementParamsSchema, request.params);
  await removeRequirement(organizationId, actorId(request), jobId, requirementId);
  response.status(204).send();
};

export const listPublicJobsController = async (request: Request, response: Response) => {
  const query = parseOrThrow(listPublicJobsQuerySchema, request.query);
  const { total, jobs } = await listPublicJobs(query);
  respondList(response, jobs, query, total);
};

export const getPublicJobController = async (request: Request, response: Response) => {
  const { jobId } = parseOrThrow(publicJobParamsSchema, request.params);
  const job = await getPublicJob(jobId);
  response.json({ job });
};
