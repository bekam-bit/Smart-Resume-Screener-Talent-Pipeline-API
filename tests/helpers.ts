import { randomUUID } from "node:crypto";
import { prisma } from "../src/config/prisma.js";
import { createAccessToken } from "../src/modules/auth/auth.tokens.js";

/** Integration tests need a reachable database; suites can skip when it is down. */
export const isDatabaseAvailable = async () => {
  // Neon suspends when idle, so allow several cold-start attempts (each
  // connection times out around 10s) before deciding the database is down.
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  return false;
};

export const databaseAvailable = await isDatabaseAvailable();

/**
 * Creates a fully verified user and mints an access token directly, so tests
 * do not depend on email delivery or the auth rate limiter.
 */
export const createTestUser = async (label = "user") => {
  const email = `itest-${label}-${randomUUID().slice(0, 8)}@example.test`;
  const user = await prisma.user.create({
    data: { email, passwordHash: "not-a-real-password-hash", emailVerifiedAt: new Date() }
  });
  const accessToken = await createAccessToken(user.id);
  return { user, accessToken };
};

/** Removes everything a test user created, in dependency order. */
export const removeTestUser = async (userId: string, organizationIds: string[] = []) => {
  try {
    for (const organizationId of organizationIds.filter(Boolean)) {
      const jobs = await prisma.job.findMany({ where: { organizationId }, select: { id: true } });
      const jobIds = jobs.map((job) => job.id);
      if (jobIds.length) {
        await prisma.jobRequirement.deleteMany({ where: { jobId: { in: jobIds } } });
        await prisma.application.deleteMany({ where: { jobId: { in: jobIds } } });
        await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
      }
      await prisma.auditLog.deleteMany({ where: { organizationId } });
      await prisma.organizationMembership.deleteMany({ where: { organizationId } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
    }
    await prisma.authToken.deleteMany({ where: { userId } });
    await prisma.refreshSession.deleteMany({ where: { userId } });
    const resumes = await prisma.resume.findMany({ where: { candidateId: userId }, select: { id: true } });
    const resumeIds = resumes.map((resume) => resume.id);
    if (resumeIds.length) {
      await prisma.applicationEvent.deleteMany({ where: { application: { resumeId: { in: resumeIds } } } });
      await prisma.recruiterNote.deleteMany({ where: { application: { resumeId: { in: resumeIds } } } });
      await prisma.screeningRun.deleteMany({ where: { application: { resumeId: { in: resumeIds } } } });
      await prisma.application.deleteMany({ where: { resumeId: { in: resumeIds } } });
      await prisma.resumeProfile.deleteMany({ where: { resumeId: { in: resumeIds } } });
      await prisma.resume.deleteMany({ where: { id: { in: resumeIds } } });
    }
    await prisma.candidateProfile.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  } catch (error) {
    console.error("test cleanup failed", error instanceof Error ? error.message : error);
  }
};