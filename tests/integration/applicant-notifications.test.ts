import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/config/prisma.js";
import { createTestUser, databaseAvailable, removeTestUser } from "../helpers.js";
import { compareAndShortlistJobApplications } from "../../src/modules/screening/shortlisting.service.js";

const orgBase = "/api/v1/organizations";
const jobsBase = "/api/v1/jobs";

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

describe.runIf(databaseAvailable)("Feature: Status Notifications (Outbox) & Shortlist-Only Interview Questions", () => {
  let recruiter: TestUser;
  let candidate1: TestUser;
  let candidate2: TestUser;

  let organizationId = "";
  let jobId = "";
  let resumeId1 = "";
  let resumeId2 = "";
  let appId1 = "";
  let appId2 = "";

  const auth = () => ({ Authorization: `Bearer ${recruiter.accessToken}` });
  const asCand1 = () => ({ Authorization: `Bearer ${candidate1.accessToken}` });
  const asCand2 = () => ({ Authorization: `Bearer ${candidate2.accessToken}` });

  beforeAll(async () => {
    recruiter = await createTestUser("notice-recruiter");
    candidate1 = await createTestUser("notice-cand1");
    candidate2 = await createTestUser("notice-cand2");

    // 1. Create Organization
    const org = await request(app)
      .post(orgBase)
      .set(auth())
      .send({ name: "Notification Talent Org", slug: `notice-org-${Date.now()}` });
    organizationId = org.body.organization.id;

    // 2. Create Job
    const job = await request(app)
      .post(`${orgBase}/${organizationId}/jobs`)
      .set(auth())
      .send({
        title: "Senior Reliability Architect",
        description: "Oversee distributed cloud architecture and resilience engineering."
      });
    jobId = job.body.job.id;

    // 3. Add Requirements
    await prisma.jobRequirement.createMany({
      data: [
        { jobId, name: "Kubernetes", type: "REQUIRED", weight: 5 },
        { jobId, name: "Go", type: "REQUIRED", weight: 5 },
        { jobId, name: "Terraform", type: "PREFERRED", weight: 3 }
      ]
    });

    // 4. Publish Job
    await request(app)
      .patch(`${orgBase}/${organizationId}/jobs/${jobId}/status`)
      .set(auth())
      .send({ status: "PUBLISHED" });

    // 5. Create Resumes directly in DB
    const resume1 = await prisma.resume.create({
      data: {
        candidateId: candidate1.user.id,
        storageKey: `resumes/${candidate1.user.id}/cand1-${Date.now()}.pdf`,
        originalName: "cand1.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        parseStatus: "COMPLETE",
        profile: {
          create: {
            parserVersion: "1.0.0",
            extractionStatus: "SUCCESS",
            extractedData: {
              text: "Senior Reliability Architect with 8 years scaling Kubernetes and Go distributed cloud infrastructure with Terraform automation.",
              wordCount: 200
            }
          }
        }
      }
    });
    resumeId1 = resume1.id;

    const resume2 = await prisma.resume.create({
      data: {
        candidateId: candidate2.user.id,
        storageKey: `resumes/${candidate2.user.id}/cand2-${Date.now()}.pdf`,
        originalName: "cand2.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        parseStatus: "COMPLETE",
        profile: {
          create: {
            parserVersion: "1.0.0",
            extractionStatus: "SUCCESS",
            extractedData: {
              text: "Junior developer with basic HTML and CSS background.",
              wordCount: 80
            }
          }
        }
      }
    });
    resumeId2 = resume2.id;

    // 6. Submit Applications
    const app1Res = await request(app)
      .post(`${jobsBase}/${jobId}/applications`)
      .set(asCand1())
      .send({ resumeId: resumeId1 });
    appId1 = app1Res.body.application.id;

    const app2Res = await request(app)
      .post(`${jobsBase}/${jobId}/applications`)
      .set(asCand2())
      .send({ resumeId: resumeId2 });
    appId2 = app2Res.body.application.id;
  }, 180000);

  afterAll(async () => {
    await prisma.emailOutbox.deleteMany({
      where: {
        recipient: { in: [candidate1.user.email, candidate2.user.email, recruiter.user.email] }
      }
    }).catch(() => {});

    if (organizationId) {
      await prisma.organizationMembership.deleteMany({ where: { organizationId } }).catch(() => {});
      await prisma.jobRequirement.deleteMany({ where: { jobId } }).catch(() => {});
      await prisma.applicationEvent.deleteMany({ where: { applicationId: { in: [appId1, appId2] } } }).catch(() => {});
      await prisma.application.deleteMany({ where: { jobId } }).catch(() => {});
      await prisma.job.deleteMany({ where: { id: jobId } }).catch(() => {});
      await prisma.organization.delete({ where: { id: organizationId } }).catch(() => {});
    }

    await prisma.resumeProfile.deleteMany({ where: { resumeId: { in: [resumeId1, resumeId2] } } }).catch(() => {});
    await prisma.resume.deleteMany({ where: { id: { in: [resumeId1, resumeId2] } } }).catch(() => {});

    await removeTestUser(candidate2.user.id).catch(() => {});
    await removeTestUser(candidate1.user.id).catch(() => {});
    await removeTestUser(recruiter.user.id).catch(() => {});
  });

  describe("Shortlist-Only Interview Questions Behavior", () => {
    it("provides suggested interview questions exclusively for shortlisted candidates and clears them for others", async () => {
      const result = await compareAndShortlistJobApplications({
        organizationId,
        jobId,
        topCount: 1, // Shortlist top 1 only
        minScore: 40
      });

      expect(result.shortlisted.length).toBe(1);
      expect(result.otherCandidates.length).toBe(1);

      // Shortlisted candidate 1 has suggested interview questions
      const shortlistedCand = result.shortlisted[0]!;
      expect(shortlistedCand.candidateEmail).toBe(candidate1.user.email);
      expect(shortlistedCand.suggestedQuestions.length).toBeGreaterThan(0);

      // Non-shortlisted candidate 2 has NO suggested interview questions generated
      const otherCand = result.otherCandidates[0]!;
      expect(otherCand.candidateEmail).toBe(candidate2.user.email);
      expect(otherCand.suggestedQuestions).toEqual([]);
    });
  });

  describe("Automated Status Notifications (Email Outbox)", () => {
    it("skips candidate email for internal SHORTLISTED milestone, and enqueues consolidated invitation on INTERVIEW", async () => {
      // 1. Move to IN_REVIEW
      await request(app)
        .patch(`${orgBase}/${organizationId}/applications/${appId1}/status`)
        .set(auth())
        .send({ status: "IN_REVIEW" })
        .expect(200);

      // 2. Advance to SHORTLISTED (internal milestone - candidate should NOT receive an email)
      const shortlistRes = await request(app)
        .patch(`${orgBase}/${organizationId}/applications/${appId1}/status`)
        .set(auth())
        .send({ status: "SHORTLISTED" })
        .expect(200);

      expect(shortlistRes.body.application.status).toBe("SHORTLISTED");

      // Verify NO email outbox entry was created for the SHORTLISTED milestone
      const shortlistedOutbox = await prisma.emailOutbox.findFirst({
        where: {
          recipient: candidate1.user.email,
          subject: { contains: "Shortlisted" }
        }
      });
      expect(shortlistedOutbox).toBeNull();

      // 3. Advance to INTERVIEW (candidate receives the consolidated interview invitation)
      const res = await request(app)
        .patch(`${orgBase}/${organizationId}/applications/${appId1}/status`)
        .set(auth())
        .send({ status: "INTERVIEW", reason: "Strong performance on cloud scaling requirements" })
        .expect(200);

      expect(res.body.application.status).toBe("INTERVIEW");

      // Verify email outbox entry
      const outbox = await prisma.emailOutbox.findFirst({
        where: {
          recipient: candidate1.user.email,
          subject: { contains: "Interview Invitation" }
        },
        orderBy: { createdAt: "desc" }
      });

      expect(outbox).not.toBeNull();
      expect(outbox?.status).toBe("PENDING");
      expect(outbox?.bodyHtml).toContain("Senior Reliability Architect");
      expect(outbox?.bodyHtml).toContain("shortlisted");
      expect(outbox?.bodyHtml).toContain("Strong performance on cloud scaling requirements");
    });

    it("enqueues a polite, professional REJECTION email when candidate is rejected", async () => {
      const res = await request(app)
        .patch(`${orgBase}/${organizationId}/applications/${appId2}/status`)
        .set(auth())
        .send({ status: "REJECTED", reason: "Does not meet mandatory Kubernetes and Go requirements" })
        .expect(200);

      expect(res.body.application.status).toBe("REJECTED");

      // Verify email outbox entry
      const outbox = await prisma.emailOutbox.findFirst({
        where: {
          recipient: candidate2.user.email,
          subject: { contains: "Update regarding your application" }
        },
        orderBy: { createdAt: "desc" }
      });

      expect(outbox).not.toBeNull();
      expect(outbox?.status).toBe("PENDING");
      expect(outbox?.bodyHtml).toContain("Does not meet mandatory Kubernetes and Go requirements");
      expect(outbox?.bodyHtml).toContain("Senior Reliability Architect");
    });
  });
});
