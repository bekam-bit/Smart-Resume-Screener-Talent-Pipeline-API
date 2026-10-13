import { randomUUID } from "node:crypto";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { withDbRetry } from "../../utils/db-retry.js";
import type { Pagination } from "../../schemas/common.schema.js";
import { recordAudit } from "../audit/audit.service.js";
import { deleteObject, getPresignedGetUrl, putObject } from "../../providers/s3.storage.js";
import { resumeExtensionFor } from "../../middlewares/upload-resume.js";
import type { UpdateProfileInput } from "./profile.schemas.js";

const publicProfile = (profile: {
  name: string;
  phone: string | null;
  portfolioUrl: string | null;
  location: string | null;
  updatedAt: Date;
}) => ({
  name: profile.name,
  phone: profile.phone,
  portfolioUrl: profile.portfolioUrl,
  location: profile.location,
  updatedAt: profile.updatedAt
});

const publicResume = (resume: {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  parseStatus: string;
  createdAt: Date;
}) => ({
  id: resume.id,
  originalName: resume.originalName,
  mimeType: resume.mimeType,
  sizeBytes: resume.sizeBytes,
  parseStatus: resume.parseStatus,
  createdAt: resume.createdAt
});

/**
 * Reads the authenticated user's candidate profile. A profile is always
 * present for accounts created via registration, but is lazily created for
 * accounts that were invited into an organization without one.
 */
export const getProfile = async (userId: string) => {
  const existing = await withDbRetry(() =>
    prisma.candidateProfile.findUnique({ where: { userId } })
  );
  if (existing) return publicProfile(existing);

  const user = await withDbRetry(() =>
    prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
  );
  if (!user) throw new AppError("UNAUTHENTICATED", "Account no longer exists", 401);

  const created = await withDbRetry(() =>
    prisma.candidateProfile.create({
      data: { userId, name: user.email.split("@")[0] ?? "Candidate" }
    })
  );
  return publicProfile(created);
};

export const updateProfile = async (userId: string, input: UpdateProfileInput) => {
  const existing = await withDbRetry(() =>
    prisma.candidateProfile.findUnique({ where: { userId }, select: { id: true } })
  );
  if (!existing) {
    // Ensure a row exists so the update below never targets a missing record.
    await getProfile(userId);
  }

  const data = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.phone !== undefined ? { phone: input.phone } : {}),
    ...(input.portfolioUrl !== undefined ? { portfolioUrl: input.portfolioUrl } : {}),
    ...(input.location !== undefined ? { location: input.location } : {})
  };

  const updated = await withDbRetry(() =>
    prisma.candidateProfile.update({ where: { userId }, data })
  );

  await recordAudit({
    actorId: userId,
    action: "profile.update",
    resourceType: "CandidateProfile",
    resourceId: userId
  });

  return publicProfile(updated);
};

// ─────────────────────────────────────────────────────────────
//  Resumes
// ─────────────────────────────────────────────────────────────
export const listResumes = async (userId: string, pagination: Pagination) => {
  const where = { candidateId: userId };
  const [total, rows] = await withDbRetry(() =>
    Promise.all([
      prisma.resume.count({ where }),
      prisma.resume.findMany({
        where,
        skip: (pagination.page - 1) * pagination.pageSize,
        take: pagination.pageSize,
        orderBy: { createdAt: "desc" },
        select: { id: true, originalName: true, mimeType: true, sizeBytes: true, parseStatus: true, createdAt: true }
      })
    ])
  );
  return { total, resumes: rows.map(publicResume) };
};

type UploadedFile = { buffer: Buffer; originalname: string; mimetype: string; size: number };

export const uploadResume = async (userId: string, file: UploadedFile) => {
  const extension = resumeExtensionFor(file.mimetype);
  const key = `resumes/${userId}/${randomUUID()}.${extension}`;

  // Store first; only record the resume row once the bytes are durably saved.
  await putObject({ key, content: file.buffer, contentType: file.mimetype });

  try {
    const resume = await withDbRetry(() =>
      prisma.resume.create({
        data: {
          candidateId: userId,
          storageKey: key,
          originalName: file.originalname,
          mimeType: file.mimetype,
          sizeBytes: file.size
        },
        select: { id: true, originalName: true, mimeType: true, sizeBytes: true, parseStatus: true, createdAt: true }
      })
    );

    await recordAudit({
      actorId: userId,
      action: "resume.upload",
      resourceType: "Resume",
      resourceId: resume.id,
      metadata: { mimeType: resume.mimeType, sizeBytes: resume.sizeBytes }
    });

    return publicResume(resume);
  } catch (error) {
    // Roll back the orphaned object so storage doesn't accumulate garbage.
    await deleteObject(key);
    throw error;
  }
};

export const getResumeAccess = async (userId: string, resumeId: string) => {
  const resume = await withDbRetry(() =>
    prisma.resume.findFirst({
      where: { id: resumeId, candidateId: userId },
      select: { id: true, originalName: true, mimeType: true, sizeBytes: true, parseStatus: true, createdAt: true, storageKey: true }
    })
  );
  if (!resume) throw new AppError("RESUME_NOT_FOUND", "Resume not found", 404);

  const downloadUrl = await getPresignedGetUrl(resume.storageKey);
  return { resume: publicResume(resume), downloadUrl };
};

export const deleteResume = async (userId: string, resumeId: string) => {
  const resume = await withDbRetry(() =>
    prisma.resume.findFirst({
      where: { id: resumeId, candidateId: userId },
      select: { id: true, storageKey: true, originalName: true, _count: { select: { applications: true } } }
    })
  );
  if (!resume) throw new AppError("RESUME_NOT_FOUND", "Resume not found", 404);
  if (resume._count.applications > 0) {
    throw new AppError("RESUME_IN_USE", "A resume used by an application cannot be deleted", 409);
  }

  await prisma.resume.delete({ where: { id: resume.id } });
  await deleteObject(resume.storageKey);

  await recordAudit({
    actorId: userId,
    action: "resume.delete",
    resourceType: "Resume",
    resourceId: resume.id,
    metadata: { originalName: resume.originalName }
  });
};

