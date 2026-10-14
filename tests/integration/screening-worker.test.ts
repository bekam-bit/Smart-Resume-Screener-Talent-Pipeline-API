import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/config/prisma.js";
import { createTestUser, databaseAvailable, removeTestUser } from "../helpers.js";
import {
  normalizeExtractedText,
  parseBufferToText
} from "../../src/modules/screening/extraction.service.js";
import { runDeterministicMatcher } from "../../src/modules/screening/deterministic-matcher.js";
import { generateDeterministicAdvisory } from "../../src/providers/gemini.ai.js";
import {
  processScreeningBatch,
  ScreeningWorker
} from "../../src/workers/screening.worker.js";

const orgBase = "/api/v1/organizations";

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

describe.runIf(databaseAvailable)("Feature G: Screening Worker, Matcher & AI Adapter", () => {
  let recruiter: TestUser;
  let candidate: TestUser;
  let organizationId = "";
  let jobId = "";
  let resumeId = "";
  let applicationId = "";
  let createdScreeningRunId = "";

  const auth = () => ({ Authorization: `Bearer ${recruiter.accessToken}` });
  const asCandidate = () => ({ Authorization: `Bearer ${candidate.accessToken}` });

  beforeAll(async () => {
    recruiter = await createTestUser("screen-recruiter");
    candidate = await createTestUser("screen-candidate");

    // 1. Create Organization
    const org = await request(app)
      .post(orgBase)
      .set(auth())
      .send({ name: "Screening Org", slug: `screen-org-${Date.now()}` });
    organizationId = org.body.organization.id;

    // 2. Create Job
    const job = await request(app)
      .post(`${orgBase}/${organizationId}/jobs`)
      .set(auth())
      .send({
        title: "Senior Backend Developer",
        description: "Develop scalable backend microservices using TypeScript and relational databases."
      });
    jobId = job.body.job.id;

    // 3. Add Requirements
    await prisma.jobRequirement.createMany({
      data: [
        {
          jobId,
          name: "TypeScript",
          description: "Strong TypeScript experience",
          type: "REQUIRED",
          weight: 10
        },
        {
          jobId,
          name: "PostgreSQL",
          description: "Relational database schema and queries",
          type: "REQUIRED",
          weight: 10
        },
        {
          jobId,
          name: "Docker",
          description: "Containerization and local compose",
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

    // 5. Upload Candidate Resume (Valid PDF with extractable text)
    const minimalPdf =
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n4 0 obj\n<< /Length 120 >>\nstream\nBT\n/F1 12 Tf\n100 700 Td\n(Alex Johnson Senior TypeScript and PostgreSQL Developer with cloud microservices experience.) Tj\nET\nendstream\nendobj\n5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000244 00000 n \n0000000415 00000 n \ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n490\n%%EOF";
    const resumeBuffer = Buffer.from(minimalPdf, "utf-8");

    const uploadRes = await request(app)
      .post("/api/v1/me/resumes")
      .set(asCandidate())
      .attach("resume", resumeBuffer, { filename: "alex-resume.pdf", contentType: "application/pdf" });

    resumeId = uploadRes.body.resume.id;

    // 6. Candidate Applies
    const applyRes = await request(app)
      .post(`/api/v1/jobs/${jobId}/applications`)
      .set(asCandidate())
      .send({ resumeId, coverLetter: "Excited to apply for this backend role!" });

    applicationId = applyRes.body.application.id;
  }, 180000);

  afterAll(async () => {
    if (createdScreeningRunId) {
      await prisma.screeningRun.deleteMany({ where: { id: createdScreeningRunId } });
    }
    if (applicationId) {
      await prisma.application.deleteMany({ where: { id: applicationId } });
    }
    await removeTestUser(recruiter.user.id, [organizationId]);
    await removeTestUser(candidate.user.id);
  });

  describe("Unit: Extraction and Matcher", () => {
    it("normalizes text and extracts from plain text buffer", async () => {
      const raw = "  Hello   world \r\n\r\n\r\n  New line \x00test  ";
      const cleaned = normalizeExtractedText(raw);
      expect(cleaned).toContain("Hello world");
      expect(cleaned).toContain("New line");
      expect(cleaned).not.toContain("\x00");

      const buffer = Buffer.from("Resume content in plain text", "utf-8");
      const parsed = await parseBufferToText(buffer, "text/plain", "resume.txt");
      expect(parsed).toBe("Resume content in plain text");
    });

    it("evaluates deterministic requirements accurately with weights and snippets", () => {
      const resume = "Extensive experience in TypeScript and PostgreSQL databases. No mention of containers.";
      const requirements = [
        { id: "1", name: "TypeScript", type: "REQUIRED" as const, weight: 10 },
        { id: "2", name: "PostgreSQL", type: "REQUIRED" as const, weight: 10 },
        { id: "3", name: "Kubernetes", type: "PREFERRED" as const, weight: 5 }
      ];

      const result = runDeterministicMatcher(resume, requirements);
      expect(result.requiredTotal).toBe(2);
      expect(result.requiredPassed).toBe(2);
      expect(result.preferredTotal).toBe(1);
      expect(result.preferredPassed).toBe(0);
      expect(result.allRequiredMet).toBe(true);
      expect(result.score).toBe(80); // (20 / 25) * 100 = 80

      const tsMatch = result.matches.find((m) => m.name === "TypeScript");
      expect(tsMatch?.matched).toBe(true);
      expect(tsMatch?.snippet).toContain("TypeScript");

      const k8sMatch = result.matches.find((m) => m.name === "Kubernetes");
      expect(k8sMatch?.matched).toBe(false);
      expect(k8sMatch?.snippet).toBeNull();
    });

    it("generates explainable advisory feedback with structured schema", () => {
      const matcherResult = {
        score: 80,
        requiredTotal: 2,
        requiredPassed: 2,
        preferredTotal: 1,
        preferredPassed: 0,
        allRequiredMet: true,
        matches: [
          { requirementId: "1", name: "TypeScript", type: "REQUIRED" as const, weight: 10, matched: true, snippet: "...TypeScript..." },
          { requirementId: "2", name: "PostgreSQL", type: "REQUIRED" as const, weight: 10, matched: true, snippet: "...PostgreSQL..." },
          { requirementId: "3", name: "Docker", type: "PREFERRED" as const, weight: 5, matched: false, snippet: null }
        ]
      };

      const advisory = generateDeterministicAdvisory({
        jobTitle: "Senior Developer",
        resumeText: "sample text",
        deterministicResult: matcherResult
      });

      expect(advisory.recommendation).toBe("ADVANCE");
      expect(advisory.summary).toContain("Senior Developer");
      expect(advisory.strengths.length).toBeGreaterThanOrEqual(1);
      expect(advisory.gaps.length).toBeGreaterThanOrEqual(1);
      expect(advisory.suggestedQuestions.length).toBeGreaterThanOrEqual(1);
      expect(advisory.advisoryScore).toBe(80);
    });
  });

  describe("End-to-End: Screening Flow and Worker", () => {
    it("enqueues a screening run and advances application to SCREENING", async () => {
      const res = await request(app)
        .post(`${orgBase}/${organizationId}/applications/${applicationId}/screen`)
        .set(auth())
        .expect(202);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.status).toBe("QUEUED");
      expect(res.body.data.applicationId).toBe(applicationId);

      createdScreeningRunId = res.body.data.id;

      // Check application status moved to SCREENING
      const appInDb = await prisma.application.findUnique({
        where: { id: applicationId }
      });
      expect(appInDb?.status).toBe("SCREENING");
    });

    it("processes the queued screening run via processScreeningBatch", async () => {
      const batchResult = await processScreeningBatch(10);
      expect(batchResult.processed).toBeGreaterThanOrEqual(1);
      expect(batchResult.succeeded).toBeGreaterThanOrEqual(1);

      // Verify screening run is COMPLETE with scores and evidence
      const run = await prisma.screeningRun.findUnique({
        where: { id: createdScreeningRunId }
      });

      expect(run?.status).toBe("COMPLETE");
      expect(Number(run?.score)).toBeGreaterThan(0);
      expect(run?.scoreBreakdown).not.toBeNull();
      expect(run?.evidence).not.toBeNull();
      expect(run?.provider).toBeDefined();
      expect(run?.finishedAt).toBeInstanceOf(Date);

      // Verify application advanced to IN_REVIEW
      const updatedApp = await prisma.application.findUnique({
        where: { id: applicationId }
      });
      expect(updatedApp?.status).toBe("IN_REVIEW");
    });

    it("lists screening runs for an application", async () => {
      const res = await request(app)
        .get(`${orgBase}/${organizationId}/applications/${applicationId}/screening-runs`)
        .set(auth())
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.runs)).toBe(true);
      const found = res.body.data.runs.find((r: { id: string }) => r.id === createdScreeningRunId);
      expect(found).toBeDefined();
      expect(found.status).toBe("COMPLETE");
    });

    it("retrieves details for a specific screening run", async () => {
      const res = await request(app)
        .get(`${orgBase}/${organizationId}/applications/${applicationId}/screening-runs/${createdScreeningRunId}`)
        .set(auth())
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(createdScreeningRunId);
      expect(res.body.data.status).toBe("COMPLETE");
      expect(res.body.data.score).toBeGreaterThan(0);
      expect(res.body.data.scoreBreakdown).toBeDefined();
      expect(res.body.data.evidence).toBeDefined();
    });

    it("starts and stops continuous ScreeningWorker gracefully", async () => {
      const worker = new ScreeningWorker({ batchSize: 5, pollIntervalMs: 500 });
      expect(worker.isRunning()).toBe(false);

      worker.start();
      expect(worker.isRunning()).toBe(true);

      // Let it cycle briefly
      await new Promise((resolve) => setTimeout(resolve, 300));

      await worker.stop();
      expect(worker.isRunning()).toBe(false);
    });
  });
});
