import type { JobStatus, Prisma, RequirementType } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { parseSort } from "../../schemas/common.schema.js";
import { withDbRetry } from "../../utils/db-retry.js";
import { recordAudit } from "../audit/audit.service.js";
import type {
  ChangeJobStatusInput,
  CreateJobInput,
  CreateRequirementInput,
  ListOrgJobsQuery,
  ListPublicJobsQuery,
  UpdateJobInput,
  UpdateRequirementInput
} from "./jobs.schemas.js";

// ─────────────────────────────────────────────────────────────
//  Shared shapes
// ─────────────────────────────────────────────────────────────
type OrganizationRef = { id: string; name: string; slug: string };

type RequirementRecord = {
  id: string;
  name: string;
  description: string | null;
  type: RequirementType;
  weight: number | null;
  createdAt: Date;
};

type JobSummaryRecord = {
  id: string;
  title: string;
  description: string;
  location: string | null;
  remotePolicy: string | null;
  employmentType: string | null;
  status: JobStatus;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  organization: OrganizationRef;
};

type JobDetailRecord = JobSummaryRecord & { requirements: RequirementRecord[] };

const requirementSelect = {
  id: true,
  name: true,
  description: true,
  type: true,
  weight: true,
  createdAt: true
};

const jobScalarSelect = {
  id: true,
  title: true,
  description: true,
  location: true,
  remotePolicy: true,
  employmentType: true,
  status: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
  organization: { select: { id: true, name: true, slug: true } }
};

const jobListSelect = jobScalarSelect;

const jobDetailSelect = {
  ...jobScalarSelect,
  requirements: { orderBy: { createdAt: "asc" as const }, select: requirementSelect }
};

const jobScalars = (job: JobSummaryRecord) => ({
  id: job.id,
  title: job.title,
  description: job.description,
  location: job.location,
  remotePolicy: job.remotePolicy,
  employmentType: job.employmentType,
  status: job.status,
  publishedAt: job.publishedAt,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
  organization: job.organization
});

const jobSummary = (job: JobSummaryRecord) => jobScalars(job);

const jobDetail = (job: JobDetailRecord) => ({ ...jobScalars(job), requirements: job.requirements });

const requirementRecord = (row: RequirementRecord) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  type: row.type,
  weight: row.weight,
  createdAt: row.createdAt
});

const requirementCreateData = (requirements: CreateJobInput["requirements"] | undefined) =>
  requirements && requirements.length > 0
    ? {
        create: requirements.map((requirement) => ({
          name: requirement.name,
          description: requirement.description ?? null,
          type: requirement.type,
          weight: requirement.weight ?? null
        }))
      }
    : undefined;

const ensureJob = async (organizationId: string, jobId: string) => {
  const job = await withDbRetry(() => prisma.job.findFirst({ where: { id: jobId, organizationId }, select: { id: true } }));
  if (!job) throw new AppError("JOB_NOT_FOUND", "Job not found", 404);
  return job;
};

/** Only draft or paused jobs may have their requirement list replaced wholesale. */
const assertRequirementsMutable = (status: JobStatus) => {
  if (status === "PUBLISHED" || status === "CLOSED") {
    throw new AppError("JOB_IMMUTABLE", "Requirements can only be replaced while the job is a draft or paused", 409);
  }
};

// ─────────────────────────────────────────────────────────────
//  Org-scoped job management
// ─────────────────────────────────────────────────────────────
export const createJob = async (organizationId: string, actorId: string, input: CreateJobInput) => {
  const requirementCreate = requirementCreateData(input.requirements);
  const job = await withDbRetry(() =>
    prisma.job.create({
      data: {
        organizationId,
        title: input.title,
        description: input.description,
        location: input.location ?? null,
        remotePolicy: input.remotePolicy ?? null,
        employmentType: input.employmentType ?? null,
        ...(requirementCreate ? { requirements: requirementCreate } : {})
      },
      select: jobDetailSelect
    })
  );

  await recordAudit({
    actorId,
    organizationId,
    action: "job.create",
    resourceType: "Job",
    resourceId: job.id,
    metadata: { title: job.title }
  });

  return jobDetail(job);
};

export const listOrgJobs = async (organizationId: string, query: ListOrgJobsQuery) => {
  const where: Prisma.JobWhereInput = {
    organizationId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.q ? { title: { contains: query.q, mode: "insensitive" } } : {})
  };

  const { field, direction } = parseSort(
    query.sort,
    ["title", "createdAt", "publishedAt", "status"] as const,
    { field: "createdAt", direction: "desc" }
  );

  const [total, rows] = await withDbRetry(() =>
    Promise.all([
      prisma.job.count({ where }),
      prisma.job.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { [field]: direction } as Prisma.JobOrderByWithRelationInput,
        select: jobListSelect
      })
    ])
  );

  return { total, jobs: rows.map(jobSummary) };
};

export const getJob = async (organizationId: string, jobId: string) => {
  const job = await withDbRetry(() =>
    prisma.job.findFirst({
      where: { id: jobId, organizationId },
      select: jobDetailSelect
    })
  );
  if (!job) throw new AppError("JOB_NOT_FOUND", "Job not found", 404);
  return jobDetail(job);
};

export const updateJob = async (organizationId: string, actorId: string, jobId: string, input: UpdateJobInput) => {
  const existing = await prisma.job.findFirst({
    where: { id: jobId, organizationId },
    select: { id: true, status: true }
  });
  if (!existing) throw new AppError("JOB_NOT_FOUND", "Job not found", 404);

  if (input.requirements !== undefined) assertRequirementsMutable(existing.status);

  const requirementCreate = requirementCreateData(input.requirements);
  const updated = await prisma.job.update({
    where: { id: existing.id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.location !== undefined ? { location: input.location } : {}),
      ...(input.remotePolicy !== undefined ? { remotePolicy: input.remotePolicy } : {}),
      ...(input.employmentType !== undefined ? { employmentType: input.employmentType } : {}),
      ...(input.requirements !== undefined
        ? { requirements: { deleteMany: {}, ...(requirementCreate ?? {}) } }
        : {})
    },
    select: jobDetailSelect
  });

  await recordAudit({
    actorId,
    organizationId,
    action: "job.update",
    resourceType: "Job",
    resourceId: existing.id,
    metadata: { title: updated.title }
  });

  return jobDetail(updated);
};

/** Allowed job lifecycle transitions. */
const JOB_STATUS_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  DRAFT: ["PUBLISHED"],
  PUBLISHED: ["PAUSED", "CLOSED"],
  PAUSED: ["PUBLISHED", "CLOSED"],
  CLOSED: ["PUBLISHED"]
};

export const changeJobStatus = async (
  organizationId: string,
  actorId: string,
  jobId: string,
  input: ChangeJobStatusInput
) => {
  const existing = await prisma.job.findFirst({
    where: { id: jobId, organizationId },
    select: { id: true, status: true, publishedAt: true }
  });
  if (!existing) throw new AppError("JOB_NOT_FOUND", "Job not found", 404);

  if (!JOB_STATUS_TRANSITIONS[existing.status].includes(input.status)) {
    throw new AppError(
      "INVALID_STATUS_TRANSITION",
      `A ${existing.status} job cannot be changed to ${input.status}`,
      409
    );
  }

  const updated = await prisma.job.update({
    where: { id: existing.id },
    data: {
      status: input.status,
      ...(input.status === "PUBLISHED" && !existing.publishedAt ? { publishedAt: new Date() } : {})
    },
    select: jobDetailSelect
  });

  await recordAudit({
    actorId,
    organizationId,
    action: "job.status.change",
    resourceType: "Job",
    resourceId: existing.id,
    metadata: { from: existing.status, to: input.status }
  });

  return jobDetail(updated);
};

export const deleteJob = async (organizationId: string, actorId: string, jobId: string) => {
  const existing = await prisma.job.findFirst({
    where: { id: jobId, organizationId },
    select: { id: true, title: true, status: true, _count: { select: { applications: true } } }
  });
  if (!existing) throw new AppError("JOB_NOT_FOUND", "Job not found", 404);

  if (existing.status !== "DRAFT") {
    throw new AppError("JOB_NOT_DRAFT", "Only draft jobs can be deleted; close the job instead", 409);
  }
  if (existing._count.applications > 0) {
    throw new AppError("JOB_HAS_APPLICATIONS", "Jobs with applications cannot be deleted", 409);
  }

  await prisma.$transaction([
    prisma.jobRequirement.deleteMany({ where: { jobId: existing.id } }),
    prisma.job.delete({ where: { id: existing.id } })
  ]);

  await recordAudit({
    actorId,
    organizationId,
    action: "job.delete",
    resourceType: "Job",
    resourceId: existing.id,
    metadata: { title: existing.title }
  });
};


// ─────────────────────────────────────────────────────────────
//  Requirements
// ─────────────────────────────────────────────────────────────
export const addRequirement = async (
  organizationId: string,
  actorId: string,
  jobId: string,
  input: CreateRequirementInput
) => {
  await ensureJob(organizationId, jobId);

  const created = await prisma.jobRequirement.create({
    data: {
      jobId,
      name: input.name,
      description: input.description ?? null,
      type: input.type,
      weight: input.weight ?? null
    },
    select: requirementSelect
  });

  await recordAudit({
    actorId,
    organizationId,
    action: "job.requirement.add",
    resourceType: "JobRequirement",
    resourceId: created.id,
    metadata: { jobId, name: created.name, type: created.type }
  });

  return requirementRecord(created);
};

export const updateRequirement = async (
  organizationId: string,
  actorId: string,
  jobId: string,
  requirementId: string,
  input: UpdateRequirementInput
) => {
  await ensureJob(organizationId, jobId);

  const existing = await prisma.jobRequirement.findFirst({
    where: { id: requirementId, jobId },
    select: { id: true }
  });
  if (!existing) throw new AppError("REQUIREMENT_NOT_FOUND", "Requirement not found", 404);

  const updated = await prisma.jobRequirement.update({
    where: { id: existing.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.weight !== undefined ? { weight: input.weight } : {})
    },
    select: requirementSelect
  });

  await recordAudit({
    actorId,
    organizationId,
    action: "job.requirement.update",
    resourceType: "JobRequirement",
    resourceId: existing.id,
    metadata: { jobId, name: updated.name }
  });

  return requirementRecord(updated);
};

export const removeRequirement = async (
  organizationId: string,
  actorId: string,
  jobId: string,
  requirementId: string
) => {
  await ensureJob(organizationId, jobId);

  const existing = await prisma.jobRequirement.findFirst({
    where: { id: requirementId, jobId },
    select: { id: true, name: true }
  });
  if (!existing) throw new AppError("REQUIREMENT_NOT_FOUND", "Requirement not found", 404);

  await prisma.jobRequirement.delete({ where: { id: existing.id } });

  await recordAudit({
    actorId,
    organizationId,
    action: "job.requirement.remove",
    resourceType: "JobRequirement",
    resourceId: existing.id,
    metadata: { jobId, name: existing.name }
  });
};

// ─────────────────────────────────────────────────────────────
//  Public job board
// ─────────────────────────────────────────────────────────────
export const listPublicJobs = async (query: ListPublicJobsQuery) => {
  const where: Prisma.JobWhereInput = {
    status: "PUBLISHED",
    ...(query.location ? { location: { contains: query.location, mode: "insensitive" } } : {}),
    ...(query.remotePolicy ? { remotePolicy: query.remotePolicy } : {}),
    ...(query.employmentType ? { employmentType: query.employmentType } : {}),
    ...(query.q
      ? {
          OR: [
            { title: { contains: query.q, mode: "insensitive" } },
            { description: { contains: query.q, mode: "insensitive" } }
          ]
        }
      : {})
  };

  const { field, direction } = parseSort(query.sort, ["publishedAt", "title"] as const, {
    field: "publishedAt",
    direction: "desc"
  });

  const [total, rows] = await withDbRetry(() =>
    Promise.all([
      prisma.job.count({ where }),
      prisma.job.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { [field]: direction } as Prisma.JobOrderByWithRelationInput,
        select: jobListSelect
      })
    ])
  );

  return { total, jobs: rows.map(jobSummary) };
};

export const getPublicJob = async (jobId: string) => {
  const job = await withDbRetry(() =>
    prisma.job.findFirst({
      where: { id: jobId, status: "PUBLISHED" },
      select: jobDetailSelect
    })
  );
  if (!job) throw new AppError("JOB_NOT_FOUND", "Job not found", 404);
  return jobDetail(job);
};

