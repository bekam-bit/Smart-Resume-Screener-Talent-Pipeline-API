import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/config/prisma.js";
import { createTestUser, databaseAvailable, removeTestUser } from "../helpers.js";
import {
  compareAndShortlistJobApplications,
  evaluateReviewFlags
} from "../../src/modules/screening/shortlisting.service.js";

const orgBase = "/api/v1/organizations";

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

describe.runIf(databaseAvailable)("Feature: Candidate Comparison, Multi-factor Ranking & Shortlisting with Edge Case Flags", () => {
  let recruiter: TestUser;
  let candidateA: TestUser;
  let candidateB: TestUser;
  let candidateC: TestUser;
  let unauthorizedRecruiter: TestUser;

  let organizationId = "";
  let jobId = "";
  let resumeIdA = "";
  let resumeIdB = "";
  let resumeIdC = "";
  let appIdA = "";
  let appIdB = "";
  let appIdC = "";

  const auth = () => ({ Authorization: `Bearer ${recruiter.accessToken}` });
  const asUnauthorized = () => ({ Authorization: `Bearer ${unauthorizedRecruiter.accessToken}` });

  beforeAll(async () => {
    recruiter = await createTestUser("shortlist-recruiter");
    candidateA = await createTestUser("cand-alice");
    candidateB = await createTestUser("cand-bob");
    candidateC = await createTestUser("cand-carol");
    unauthorizedRecruiter = await createTestUser("shortlist-unauth");

    // 1. Create Organization
    const org = await request(app)
      .post(orgBase)
      .set(auth())
      .send({ name: "Shortlist Talent Org", slug: `shortlist-org-${Date.now()}` });
    organizationId = org.body.organization.id;

    // 2. Create Job
    const job = await request(app)
      .post(`${orgBase}/${organizationId}/jobs`)
      .set(auth())
      .send({
        title: "Principal Cloud Engineer",
        description: "Scale Kubernetes, Go, and PostgreSQL distributed systems."
      });
    jobId = job.body.job.id;

    // 3. Add Requirements: 2 REQUIRED, 1 PREFERRED
    await prisma.jobRequirement.createMany({
      data: [
        {
          jobId,
          name: "Kubernetes",
          description: "Production Kubernetes cluster administration",
          type: "REQUIRED",
          weight: 10
        },
        {
          jobId,
          name: "Go",
          description: "Golang microservices backend development",
          type: "REQUIRED",
          weight: 10
        },
        {
          jobId,
          name: "Terraform",
          description: "Infrastructure as Code IaC",
          type: "PREFERRED",
          weight: 5
        }
      ]
    });

    // 4. Publish Job
    await request(app)
      .patch(`${orgBase}/${organizationId}/jobs/${jobId}/status`)
      .set(auth())
      .send({ status: "PUBLISHED" });

    // 5. Create Resumes:
    // Candidate A: Perfect match (Kubernetes, Go, Terraform)
    const resumeA = await prisma.resume.create({
      data: {
        candidateId: candidateA.user.id,
        storageKey: `resumes/${candidateA.user.id}/alice-${Date.now()}.pdf`,
        originalName: "alice-resume.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        parseStatus: "COMPLETE",
        profile: {
          create: {
            parserVersion: "1.0.0",
            extractionStatus: "SUCCESS",
            extractedData: {
              text: "Alice Smith is a Principal Cloud Architect with 12 years of hands-on distributed systems engineering experience. Expert in Kubernetes cluster lifecycle management, production deployment architectures, and automated failover topologies. Extensive experience developing high-performance microservices in Go Golang with concurrency and gRPC. Proficient in Infrastructure as Code using Terraform, automated CI/CD pipelines, Docker containerization, and PostgreSQL database performance tuning. Successfully led cloud modernization initiatives resulting in five-nines service uptime and seamless scalability across hybrid multi-cloud clusters.",
              wordCount: 100
            }
          }
        }
      }
    });
    resumeIdA = resumeA.id;

    // Candidate B: High potential but missed mandatory requirement "Go"
    const resumeB = await prisma.resume.create({
      data: {
        candidateId: candidateB.user.id,
        storageKey: `resumes/${candidateB.user.id}/bob-${Date.now()}.pdf`,
        originalName: "bob-resume.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        parseStatus: "COMPLETE",
        profile: {
          create: {
            parserVersion: "1.0.0",
            extractionStatus: "SUCCESS",
            extractedData: {
              text: "Bob Miller. Senior Cloud Architect with extensive Kubernetes and Terraform infrastructure experience.",
              wordCount: 12
            }
          }
        }
      }
    });
    resumeIdB = resumeB.id;

    // Candidate C: Borderline score / partial fit
    const resumeC = await prisma.resume.create({
      data: {
        candidateId: candidateC.user.id,
        storageKey: `resumes/${candidateC.user.id}/carol-${Date.now()}.pdf`,
        originalName: "carol-resume.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        parseStatus: "COMPLETE",
        profile: {
          create: {
            parserVersion: "1.0.0",
            extractionStatus: "SUCCESS",
            extractedData: {
              text: "Carol White. Junior developer with Go programming experience. Familiar with cloud concepts.",
              wordCount: 12
            }
          }
        }
      }
    });
    resumeIdC = resumeC.id;

    // 6. Create Applications directly in database
    const appA = await prisma.application.create({
      data: {
        candidateId: candidateA.user.id,
        jobId,
        resumeId: resumeIdA,
        status: "SUBMITTED"
      }
    });
    appIdA = appA.id;

    const appB = await prisma.application.create({
      data: {
        candidateId: candidateB.user.id,
        jobId,
        resumeId: resumeIdB,
        status: "SUBMITTED"
      }
    });
    appIdB = appB.id;

    const appC = await prisma.application.create({
      data: {
        candidateId: candidateC.user.id,
        jobId,
        resumeId: resumeIdC,
        status: "SUBMITTED"
      }
    });
    appIdC = appC.id;

    // Add candidate profile names
    await prisma.candidateProfile.createMany({
      data: [
        { userId: candidateA.user.id, name: "Alice Smith" },
        { userId: candidateB.user.id, name: "Bob Miller" },
        { userId: candidateC.user.id, name: "Carol White" }
      ],
      skipDuplicates: true
    });
  }, 120000);

  afterAll(async () => {
    const appIds = [appIdA, appIdB, appIdC].filter(Boolean);
    if (appIds.length > 0) {
      await prisma.applicationEvent.deleteMany({ where: { applicationId: { in: appIds } } });
      await prisma.application.deleteMany({ where: { id: { in: appIds } } });
    }
    const resumeIds = [resumeIdA, resumeIdB, resumeIdC].filter(Boolean);
    if (resumeIds.length > 0) {
      await prisma.resumeProfile.deleteMany({ where: { resumeId: { in: resumeIds } } });
      await prisma.resumeChunk.deleteMany({ where: { resumeId: { in: resumeIds } } });
      await prisma.resume.deleteMany({ where: { id: { in: resumeIds } } });
    }
    if (organizationId) {
      await removeTestUser(recruiter.user.id, [organizationId]);
    }
    await removeTestUser(candidateA.user.id);
    await removeTestUser(candidateB.user.id);
    await removeTestUser(candidateC.user.id);
    await removeTestUser(unauthorizedRecruiter.user.id);
  });

  describe("Unit: Edge Case Evaluation Logic", () => {
    it("flags candidate for review when a mandatory requirement is unverified", () => {
      const result = evaluateReviewFlags({
        compositeScore: 78,
        deterministicScore: 75,
        aiAdvisoryScore: 82,
        allRequiredMet: false,
        recommendation: "ADVANCE",
        unmetRequiredNames: ["Go"],
        minScore: 60
      });

      expect(result.flagForReview).toBe(true);
      expect(result.reviewSeverity).toBe("CRITICAL");
      expect(result.reviewReasons[0]).toContain("unverified mandatory requirement(s): Go");
    });

    it("flags candidate for review when score is borderline near cutoff", () => {
      const result = evaluateReviewFlags({
        compositeScore: 62,
        deterministicScore: 60,
        aiAdvisoryScore: 65,
        allRequiredMet: true,
        recommendation: "REVIEW",
        unmetRequiredNames: [],
        minScore: 60
      });

      expect(result.flagForReview).toBe(true);
      expect(result.reviewSeverity).toBe("WARNING");
      expect(result.reviewReasons[0]).toContain("borderline close to the cutoff threshold");
    });

    it("does not flag clean top candidate with all requirements met", () => {
      const result = evaluateReviewFlags({
        compositeScore: 92,
        deterministicScore: 90,
        aiAdvisoryScore: 95,
        allRequiredMet: true,
        recommendation: "ADVANCE",
        unmetRequiredNames: [],
        minScore: 60,
        resumeWordCount: 300
      });

      expect(result.flagForReview).toBe(false);
      expect(result.reviewSeverity).toBe("NONE");
      expect(result.reviewReasons.length).toBe(0);
    });
  });

  describe("Service: Job Application Comparison & Shortlisting", () => {
    it("ranks candidates by best fit and partitions into shortlist and others", async () => {
      const result = await compareAndShortlistJobApplications({
        organizationId,
        jobId,
        topCount: 2,
        minScore: 40
      });

      expect(result.job.id).toBe(jobId);
      expect(result.metrics.totalApplications).toBe(3);
      expect(result.metrics.shortlistCapacity).toBe(2);
      expect(result.shortlisted.length).toBe(2);
      expect(result.otherCandidates.length).toBe(1);

      // Top candidate Alice should be Rank 1
      const topCand = result.shortlisted[0]!;
      expect(topCand.rank).toBe(1);
      expect(topCand.candidateEmail).toBe(candidateA.user.email);
      expect(topCand.allRequiredMet).toBe(true);
      expect(topCand.flagForReview).toBe(false);

      // Candidate B (Bob) has missing mandatory requirement -> flagged for review
      const candB = result.shortlisted.find((c) => c.candidateEmail === candidateB.user.email);
      expect(candB).toBeDefined();
      expect(candB!.flagForReview).toBe(true);
      expect(candB!.reviewReasons.some((r) => r.includes("mandatory"))).toBe(true);

      // Executive Comparative Summary is generated
      expect(result.executiveSummary).toBeDefined();
      expect(typeof result.executiveSummary?.overview).toBe("string");
      expect(result.executiveSummary?.candidateComparisons.length).toBe(2);
      expect(result.executiveSummary?.candidateComparisons[0]?.candidateName).toBeDefined();
      expect(result.executiveSummary?.candidateComparisons[0]?.standoutAdvantage).toBeDefined();
      expect(result.executiveSummary?.candidateComparisons[0]?.potentialTradeoff).toBeDefined();
      expect(typeof result.executiveSummary?.hiringGuidance).toBe("string");
    });

    it("auto-advances clean shortlist candidates while holding flagged candidates in review", async () => {
      const result = await compareAndShortlistJobApplications({
        organizationId,
        jobId,
        topCount: 2,
        minScore: 40,
        autoAdvance: true,
        actorUserId: recruiter.user.id
      });

      expect(result.metrics.autoAdvancedCount).toBe(1);

      // Alice had flagForReview: false -> successfully moved to SHORTLISTED
      const updatedAlice = await prisma.application.findUnique({
        where: { id: appIdA }
      });
      expect(updatedAlice?.status).toBe("SHORTLISTED");

      // Bob had flagForReview: true -> NOT auto-advanced, remains SUBMITTED/IN_REVIEW for recruiter judgment
      const updatedBob = await prisma.application.findUnique({
        where: { id: appIdB }
      });
      expect(updatedBob?.status).toBe("SUBMITTED");
    });
  });

  describe("API: Comparison & Shortlisting Endpoints", () => {
    it("GET /jobs/:jobId/candidates/compare returns ranked comparison with flags", async () => {
      const res = await request(app)
        .get(`${orgBase}/${organizationId}/jobs/${jobId}/candidates/compare?topCount=2&minScore=50`)
        .set(auth())
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.metrics.totalApplications).toBe(3);
      expect(Array.isArray(res.body.data.shortlisted)).toBe(true);
      expect(res.body.data.shortlisted.length).toBeGreaterThan(0);
      expect(res.body.data.shortlisted[0].rank).toBe(1);
      expect(res.body.data.shortlisted[0].flagForReview).toBeDefined();

      // Check Executive Summary in API response
      expect(res.body.data.executiveSummary).toBeDefined();
      expect(typeof res.body.data.executiveSummary.overview).toBe("string");
      expect(Array.isArray(res.body.data.executiveSummary.candidateComparisons)).toBe(true);
      expect(typeof res.body.data.executiveSummary.hiringGuidance).toBe("string");
    });

    it("GET /jobs/:jobId/candidates/compare respects generateSummary=false", async () => {
      const res = await request(app)
        .get(`${orgBase}/${organizationId}/jobs/${jobId}/candidates/compare?generateSummary=false`)
        .set(auth())
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.executiveSummary).toBeUndefined();
    });

    it("POST /jobs/:jobId/shortlist triggers shortlisting with custom cutoff", async () => {
      const res = await request(app)
        .post(`${orgBase}/${organizationId}/jobs/${jobId}/shortlist`)
        .set(auth())
        .send({ topCount: 1, minScore: 70 })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.shortlisted.length).toBe(1);
      expect(res.body.data.shortlisted[0].candidateEmail).toBe(candidateA.user.email);
      expect(res.body.data.executiveSummary).toBeDefined();
    });

    it("enforces tenant security rejecting unauthorized access with 404", async () => {
      const res = await request(app)
        .get(`${orgBase}/${organizationId}/jobs/${jobId}/candidates/compare`)
        .set(asUnauthorized())
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("ORGANIZATION_NOT_FOUND");
    });
  });
});
