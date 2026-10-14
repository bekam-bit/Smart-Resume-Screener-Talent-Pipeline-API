import { Prisma } from "@prisma/client";
import type { ApplicationStatus } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { withDbRetry } from "../../utils/db-retry.js";
import type { Pagination } from "../../schemas/common.schema.js";
import { recordAudit } from "../audit/audit.service.js";
import { enqueueApplicationStatusEmail } from "../notifications/applicant-notifications.service.js";
import type {
  AddNoteInput,
  ApplyToJobInput,
  ChangeApplicationStatusInput,
  ListJobApplicationsQuery,
  ListMyApplicationsQuery
} from "./applications.schemas.js";

// ─────────────────────────────────────────────────────────────
//  Pipeline state machine
// ─────────────────────────────────────────────────────────────
/** Recruiter-driven transitions: which statuses each current status may move to. */
const RECRUITER_TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  SUBMITTED: ["SCREENING", "IN_REVIEW", "SHORTLISTED", "INTERVIEW", "OFFER", "REJECTED"],
  SCREENING: ["IN_REVIEW", "SHORTLISTED", "INTERVIEW", "OFFER", "REJECTED"],
  IN_REVIEW: ["SHORTLISTED", "INTERVIEW", "OFFER", "REJECTED"],
  SHORTLISTED: ["INTERVIEW", "OFFER", "REJECTED"],
  INTERVIEW: ["OFFER", "REJECTED"],
  OFFER: ["HIRED", "REJECTED"],
  HIRED: [],
  REJECTED: [],
  WITHDRAWN: []
};

const canRecruiterTransition = (from: ApplicationStatus, to: ApplicationStatus) =>
  RECRUITER_TRANSITIONS[from].includes(to);

const canCandidateWithdraw = (status: ApplicationStatus) =>
  status !== "HIRED" && status !== "REJECTED" && status !== "WITHDRAWN";

// ─────────────────────────────────────────────────────────────
//  Public shapes
// ─────────────────────────────────────────────────────────────
const publicApplication = (application: {
  id: string;
  status: ApplicationStatus;
  coverLetter: string | null;
  submittedAt: Date;
  withdrawnAt: Date | null;
  job: { id: string; title: string };
  resume: { id: string; originalName: string };
}) => ({
  id: application.id,
  status: application.status,
  coverLetter: application.coverLetter,
  submittedAt: application.submittedAt,
  withdrawnAt: application.withdrawnAt,
  job: { id: application.job.id, title: application.job.title },
  resume: { id: application.resume.id, originalName: application.resume.originalName }
});

const applicationSelect = {
  id: true,
  status: true,
  coverLetter: true,
  submittedAt: true,
  withdrawnAt: true,
  job: { select: { id: true, title: true } },
  resume: { select: { id: true, originalName: true } }
} satisfies Prisma.ApplicationSelect;

// ─────────────────────────────────────────────────────────────
//  Candidate actions
// ─────────────────────────────────────────────────────────────
export const applyToJob = async (candidateId: string, jobId: string, input: ApplyToJobInput) => {
  const job = await withDbRetry(() =>
    prisma.job.findFirst({ where: { id: jobId, status: "PUBLISHED" }, select: { id: true } })
  );
  if (!job) throw new AppError("JOB_NOT_FOUND", "Job not found", 404);

  const resume = await withDbRetry(() =>
    prisma.resume.findFirst({ where: { id: input.resumeId, candidateId }, select: { id: true } })
  );
  if (!resume) throw new AppError("RESUME_NOT_FOUND", "Resume not found", 404);

  // One active application per candidate per job (re-applying after withdrawal
  // or rejection is allowed and simply creates a fresh application).
  const existing = await withDbRetry(() =>
    prisma.application.findFirst({
      where: { candidateId, jobId, status: { in: ["SUBMITTED", "SCREENING", "IN_REVIEW", "SHORTLISTED", "INTERVIEW", "OFFER"] } },
      select: { id: true }
    })
  );
  if (existing) {
    throw new AppError("ALREADY_APPLIED", "You already have an active application for this job", 409);
  }

  try {
    const application = await withDbRetry(() =>
      prisma.$transaction(
        async (transaction) => {
          const created = await transaction.application.create({
            data: {
              candidateId,
              jobId,
              resumeId: resume.id,
              status: "SUBMITTED",
              coverLetter: input.coverLetter ?? null
            },
            select: applicationSelect
          });
          await transaction.applicationEvent.create({
            data: {
              applicationId: created.id,
              actorUserId: candidateId,
              fromStatus: null,
              toStatus: "SUBMITTED",
              candidateVisible: true
            }
          });
          return created;
        },
        { maxWait: 15000, timeout: 30000 }
      )
    );

    await recordAudit({
      actorId: candidateId,
      action: "application.create",
      resourceType: "Application",
      resourceId: application.id,
      metadata: { jobId, resumeId: resume.id }
    });

    return publicApplication(application);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("ALREADY_APPLIED", "You already have an application for this job", 409);
    }
    throw error;
  }
};

export const listMyApplications = async (candidateId: string, query: ListMyApplicationsQuery) => {
  const where: Prisma.ApplicationWhereInput = {
    candidateId,
    ...(query.status ? { status: query.status } : {})
  };
  const [total, rows] = await withDbRetry(() =>
    Promise.all([
      prisma.application.count({ where }),
      prisma.application.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { submittedAt: "desc" },
        select: applicationSelect
      })
    ])
  );
  return { total, applications: rows.map(publicApplication) };
};

export const getMyApplication = async (candidateId: string, applicationId: string) => {
  const application = await withDbRetry(() =>
    prisma.application.findFirst({ where: { id: applicationId, candidateId }, select: applicationSelect })
  );
  if (!application) throw new AppError("APPLICATION_NOT_FOUND", "Application not found", 404);
  return publicApplication(application);
};

export const withdrawApplication = async (candidateId: string, applicationId: string) => {
  const application = await withDbRetry(() =>
    prisma.application.findFirst({
      where: { id: applicationId, candidateId },
      select: { id: true, status: true }
    })
  );
  if (!application) throw new AppError("APPLICATION_NOT_FOUND", "Application not found", 404);
  if (!canCandidateWithdraw(application.status)) {
    throw new AppError("CANNOT_WITHDRAW", `A ${application.status} application cannot be withdrawn`, 409);
  }

  const updated = await withDbRetry(() =>
    prisma.$transaction(
      async (transaction) => {
        const saved = await transaction.application.update({
          where: { id: application.id },
          data: { status: "WITHDRAWN", withdrawnAt: new Date() },
          select: applicationSelect
        });
        await transaction.applicationEvent.create({
          data: {
            applicationId: application.id,
            actorUserId: candidateId,
            fromStatus: application.status,
            toStatus: "WITHDRAWN",
            candidateVisible: true
          }
        });
        return saved;
      },
      { maxWait: 15000, timeout: 30000 }
    )
  );

  await recordAudit({
    actorId: candidateId,
    action: "application.withdraw",
    resourceType: "Application",
    resourceId: application.id
  });

  return publicApplication(updated);
};

// ─────────────────────────────────────────────────────────────
//  Recruiter actions
// ─────────────────────────────────────────────────────────────
const recruiterApplicationSelect = {
  id: true,
  status: true,
  coverLetter: true,
  submittedAt: true,
  withdrawnAt: true,
  candidate: { select: { email: true, candidateProfile: { select: { name: true } } } },
  job: { select: { id: true, title: true } },
  resume: { select: { id: true, originalName: true } }
};

const recruiterApplication = (application: {
  id: string;
  status: ApplicationStatus;
  coverLetter: string | null;
  submittedAt: Date;
  withdrawnAt: Date | null;
  candidate: { email: string; candidateProfile: { name: string } | null };
  job: { id: string; title: string };
  resume: { id: string; originalName: string };
}) => ({
  id: application.id,
  status: application.status,
  coverLetter: application.coverLetter,
  submittedAt: application.submittedAt,
  withdrawnAt: application.withdrawnAt,
  candidate: {
    email: application.candidate.email,
    name: application.candidate.candidateProfile?.name ?? null
  },
  job: { id: application.job.id, title: application.job.title },
  resume: { id: application.resume.id, originalName: application.resume.originalName }
});

export const listJobApplications = async (
  organizationId: string,
  jobId: string,
  query: ListJobApplicationsQuery
) => {
  const where: Prisma.ApplicationWhereInput = {
    jobId,
    job: { organizationId },
    ...(query.status ? { status: query.status } : {})
  };
  const direction = query.sort?.endsWith(":asc") ? "asc" : "desc";
  const orderBy: Prisma.ApplicationOrderByWithRelationInput =
    query.sort?.startsWith("status") ? { status: direction } : { submittedAt: direction };

  const [total, rows] = await withDbRetry(() =>
    Promise.all([
      prisma.application.count({ where }),
      prisma.application.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy,
        select: recruiterApplicationSelect
      })
    ])
  );
  return { total, applications: rows.map(recruiterApplication) };
};

export const getOrgApplication = async (organizationId: string, applicationId: string) => {
  const application = await withDbRetry(() =>
    prisma.application.findFirst({
      where: { id: applicationId, job: { organizationId } },
      select: recruiterApplicationSelect
    })
  );
  if (!application) throw new AppError("APPLICATION_NOT_FOUND", "Application not found", 404);
  return recruiterApplication(application);
};


export const changeApplicationStatus = async (
  organizationId: string,
  actorId: string,
  applicationId: string,
  input: ChangeApplicationStatusInput
) => {
  const application = await withDbRetry(() =>
    prisma.application.findFirst({
      where: { id: applicationId, job: { organizationId } },
      select: { id: true, status: true }
    })
  );
  if (!application) throw new AppError("APPLICATION_NOT_FOUND", "Application not found", 404);

  if (!canRecruiterTransition(application.status, input.status)) {
    throw new AppError(
      "INVALID_STATUS_TRANSITION",
      `A ${application.status} application cannot be moved to ${input.status}`,
      409
    );
  }

  const updated = await withDbRetry(() =>
    prisma.$transaction(
      async (transaction) => {
        const saved = await transaction.application.update({
          where: { id: application.id },
          data: { status: input.status },
          select: recruiterApplicationSelect
        });
        await transaction.applicationEvent.create({
          data: {
            applicationId: application.id,
            actorUserId: actorId,
            fromStatus: application.status,
            toStatus: input.status,
            reason: input.reason ?? null,
            candidateVisible: input.candidateVisible ?? false
          }
        });
        return saved;
      },
      { maxWait: 15000, timeout: 30000 }
    )
  );

  await recordAudit({
    actorId,
    organizationId,
    action: "application.status.change",
    resourceType: "Application",
    resourceId: application.id,
    metadata: { from: application.status, to: input.status }
  });

  // Enqueue notification email for candidate-facing milestones (INTERVIEW, REJECTED, OFFER).
  // SHORTLISTED is an internal pipeline milestone and does not trigger a candidate email —
  // the INTERVIEW invitation email consolidates both shortlisting and invitation context.
  await enqueueApplicationStatusEmail({
    candidateEmail: updated.candidate.email,
    candidateName: updated.candidate.candidateProfile?.name || updated.candidate.email.split("@")[0] || "Candidate",
    jobTitle: updated.job.title,
    newStatus: input.status,
    reason: input.reason,
    applicationId: updated.id
  });

  return recruiterApplication(updated);
};

export const addNote = async (organizationId: string, authorId: string, applicationId: string, input: AddNoteInput) => {
  const application = await withDbRetry(() =>
    prisma.application.findFirst({
      where: { id: applicationId, job: { organizationId } },
      select: { id: true }
    })
  );
  if (!application) throw new AppError("APPLICATION_NOT_FOUND", "Application not found", 404);

  const note = await withDbRetry(() =>
    prisma.recruiterNote.create({
      data: { applicationId: application.id, authorId, body: input.body },
      select: {
        id: true,
        body: true,
        createdAt: true,
        author: { select: { candidateProfile: { select: { name: true } } } }
      }
    })
  );

  await recordAudit({
    actorId: authorId,
    organizationId,
    action: "application.note.create",
    resourceType: "Application",
    resourceId: application.id,
    metadata: { noteId: note.id }
  });

  return {
    id: note.id,
    body: note.body,
    createdAt: note.createdAt,
    authorName: note.author.candidateProfile?.name ?? null
  };
};

export const listApplicationEvents = async (organizationId: string, applicationId: string) => {
  const application = await withDbRetry(() =>
    prisma.application.findFirst({
      where: { id: applicationId, job: { organizationId } },
      select: { id: true }
    })
  );
  if (!application) throw new AppError("APPLICATION_NOT_FOUND", "Application not found", 404);

  const events = await withDbRetry(() =>
    prisma.applicationEvent.findMany({
      where: { applicationId: application.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        fromStatus: true,
        toStatus: true,
        reason: true,
        candidateVisible: true,
        createdAt: true,
        actor: { select: { email: true } }
      }
    })
  );

  return events.map((event) => ({
    id: event.id,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    reason: event.reason,
    candidateVisible: event.candidateVisible,
    createdAt: event.createdAt,
    actorEmail: event.actor?.email ?? null
  }));
};

