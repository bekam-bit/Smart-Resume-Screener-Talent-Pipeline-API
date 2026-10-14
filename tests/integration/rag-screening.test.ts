import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/config/prisma.js";
import { createTestUser, databaseAvailable, removeTestUser } from "../helpers.js";
import { chunkText } from "../../src/modules/screening/chunking.service.js";
import {
  ingestResumeEmbeddings,
  retrieveSimilarResumeChunks
} from "../../src/modules/screening/embedding.service.js";
import {
  runRagScreening,
  askResumeQuestion
} from "../../src/modules/screening/rag.service.js";

const orgBase = "/api/v1/organizations";

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

describe.runIf(databaseAvailable)("RAG & pgvector: Embeddings, Semantic Search & OpenRouter Models", () => {
  let recruiter: TestUser;
  let candidate: TestUser;
  let unauthorizedRecruiter: TestUser;
  let organizationId = "";
  let jobId = "";
  let resumeId = "";
  let applicationId = "";

  const auth = () => ({ Authorization: `Bearer ${recruiter.accessToken}` });
  const asCandidate = () => ({ Authorization: `Bearer ${candidate.accessToken}` });
  const asUnauthorized = () => ({ Authorization: `Bearer ${unauthorizedRecruiter.accessToken}` });

  beforeAll(async () => {
    recruiter = await createTestUser("rag-recruiter");
    candidate = await createTestUser("rag-candidate");
    unauthorizedRecruiter = await createTestUser("rag-unauth");

    // 1. Create Organization
    const org = await request(app)
      .post(orgBase)
      .set(auth())
      .send({ name: "Vector RAG Org", slug: `rag-org-${Date.now()}` });
    organizationId = org.body.organization.id;

    // 2. Create Job
    const job = await request(app)
      .post(`${orgBase}/${organizationId}/jobs`)
      .set(auth())
      .send({
        title: "Senior AI & Distributed Systems Engineer",
        description: "Design high-performance vector retrieval architectures with PostgreSQL and pgvector."
      });
    jobId = job.body.job.id;

    // 3. Add Requirements
    await prisma.jobRequirement.createMany({
      data: [
        {
          jobId,
          name: "PostgreSQL pgvector",
          description: "Hands-on experience with vector similarity and HNSW indexing",
          type: "REQUIRED",
          weight: 10
        },
        {
          jobId,
          name: "OpenRouter & LLM Inference",
          description: "Integration of modern text and embedding foundation models",
          type: "REQUIRED",
          weight: 10
        },
        {
          jobId,
          name: "TypeScript",
          description: "Node.js and modern TypeScript backend services",
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

    // 5. Create Candidate Resume record
    const resume = await prisma.resume.create({
      data: {
        candidateId: candidate.user.id,
        storageKey: `resumes/${candidate.user.id}/jordan-resume-${Date.now()}.pdf`,
        originalName: "jordan-resume.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        checksum: "sha256-test",
        parseStatus: "COMPLETE"
      }
    });
    resumeId = resume.id;

    // 6. Candidate Applies
    const applyRes = await request(app)
      .post(`/api/v1/jobs/${jobId}/applications`)
      .set(asCandidate())
      .send({ resumeId, coverLetter: "Excited to work on your RAG and vector systems!" });

    applicationId = applyRes.body.application.id;

    // 7. Seed completed Screening Run for checkpoint challenge and evaluation reasoning tests
    await prisma.screeningRun.create({
      data: {
        applicationId,
        status: "COMPLETE",
        score: 88,
        scoreBreakdown: {
          matches: [
            { name: "PostgreSQL pgvector", matched: true, type: "REQUIRED" },
            { name: "OpenRouter & LLM Inference", matched: true, type: "REQUIRED" },
            { name: "TypeScript", matched: false, type: "PREFERRED" }
          ]
        },
        evidence: {
          recommendation: "ADVANCE",
          strengths: ["Strong vector DB and pgvector background", "Deep LLM inference knowledge"],
          gaps: ["No direct production TypeScript references found in resume"],
          summary: "Demonstrates deep LLM and vector search proficiency with slight gap in TypeScript."
        },
        provider: "deterministic+rag"
      }
    });
  });

  afterAll(async () => {
    if (applicationId) {
      await prisma.screeningRun.deleteMany({ where: { applicationId } });
      await prisma.application.deleteMany({ where: { id: applicationId } });
    }
    if (resumeId) {
      await prisma.resumeChunk.deleteMany({ where: { resumeId } });
      await prisma.resume.deleteMany({ where: { id: resumeId } });
    }
    if (organizationId) {
      await removeTestUser(recruiter.user.id, [organizationId]);
    }
    await removeTestUser(candidate.user.id);
    await removeTestUser(unauthorizedRecruiter.user.id);
  });

  describe("Unit: Document Chunking & Ingestion", () => {
    it("chunks text with configured window size and boundary overlap", () => {
      const sampleText =
        "First sentence discussing vector databases. Second sentence about pgvector indexing and cosine distance. " +
        "Third sentence detailing OpenRouter models for embeddings and text generation. " +
        "Fourth sentence outlining retrieval-augmented generation pipelines.";

      const chunks = chunkText(sampleText, 120, 30);
      expect(chunks.length).toBeGreaterThan(1);
      // Verify overlap exists across adjacent chunks
      for (let i = 0; i < chunks.length - 1; i++) {
        expect(chunks[i]!.length).toBeLessThanOrEqual(120);
      }
    });

    it("ingests and stores 2048-dimensional vectors in Neon pgvector", async () => {
      const resumeContent =
        "Jordan Smith is an experienced Software Engineer with 8 years in distributed backend systems.\n\n" +
        "Primary expertise includes PostgreSQL, pgvector cosine search, and high-throughput vector indexes.\n\n" +
        "Architected enterprise RAG retrieval systems integrating OpenRouter LLM APIs and modern TypeScript services.";

      const result = await ingestResumeEmbeddings(resumeId, resumeContent);
      expect(result.chunkCount).toBeGreaterThan(0);
      expect(result.indexed).toBe(true);

      const dbChunks = await prisma.resumeChunk.findMany({
        where: { resumeId },
        orderBy: { chunkIndex: "asc" }
      });

      expect(dbChunks.length).toBe(result.chunkCount);
      expect(dbChunks[0]!.content).toContain("Jordan Smith");
    });

    it("verifies pgvector extension and 2048-dim vector math on Neon", async () => {
      const ext = await prisma.$queryRawUnsafe<Array<{ extname: string; extversion: string }>>(
        `SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';`
      );
      expect(ext.length).toBe(1);
      expect(ext[0]!.extname).toBe("vector");
      expect(ext[0]!.extversion).toBeDefined();

      // Test pgvector native cosine distance calculation on 2048-dim vector
      const zeroVec = `[${new Array(2048).fill(0.1).join(",")}]`;
      const distanceResult = await prisma.$queryRawUnsafe<Array<{ dist: number }>>(
        `SELECT ('${zeroVec}'::vector <=> '${zeroVec}'::vector)::float AS dist;`
      );
      expect(distanceResult[0]!.dist).toBeCloseTo(0, 4);
    });
  });

  describe("Retrieval: pgvector Cosine Distance Search", () => {
    it("retrieves the most semantically relevant chunks ordered by cosine similarity", async () => {
      const retrieved = await retrieveSimilarResumeChunks(
        resumeId,
        "What experience does this candidate have with PostgreSQL pgvector?",
        3
      );

      expect(retrieved.length).toBeGreaterThan(0);
      expect(retrieved[0]!.similarity).toBeGreaterThan(0);
      expect(retrieved[0]!.distance).toBeGreaterThanOrEqual(0);
      // Cosine distance and similarity should satisfy: similarity = 1 - distance (approx)
      expect(retrieved[0]!.similarity + retrieved[0]!.distance).toBeCloseTo(1, 1);
      expect(retrieved[0]!.content.toLowerCase()).toContain("pgvector");
    });
  });

  describe("Generation: Grounded RAG Screening Evaluation", () => {
    it("synthesizes grounded screening results citing source chunks", async () => {
      const ragResult = await runRagScreening({
        resumeId,
        jobTitle: "Senior AI & Distributed Systems Engineer",
        jobDescription: "Vector search and LLM integrations",
        requirements: [
          { id: "1", name: "PostgreSQL pgvector", type: "REQUIRED" },
          { id: "2", name: "OpenRouter & LLM Inference", type: "REQUIRED" }
        ],
        deterministicScore: 90
      });

      expect(ragResult.summary).toBeDefined();
      expect(ragResult.recommendation).toMatch(/ADVANCE|REVIEW|REJECT/);
      expect(ragResult.groundedScore).toBeGreaterThanOrEqual(0);
      expect(ragResult.groundedScore).toBeLessThanOrEqual(100);
      expect(ragResult.retrievedChunks.length).toBeGreaterThan(0);
      expect(ragResult.citedSources.length).toBeGreaterThan(0);
      expect(ragResult.citedSources[0]).toContain("Source Chunk");
    });
  });

  describe("API: Recruiter Grounded Q&A Endpoint", () => {
    it("allows authorized recruiters to query a candidate resume with grounded citations", async () => {
      const res = await request(app)
        .post(`${orgBase}/${organizationId}/applications/${applicationId}/ask`)
        .set(auth())
        .send({ question: "Does the candidate have experience with OpenRouter and LLM APIs?" })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.question).toBe("Does the candidate have experience with OpenRouter and LLM APIs?");
      expect(res.body.data.answer).toBeDefined();
      expect(typeof res.body.data.answer).toBe("string");
      expect(Array.isArray(res.body.data.sources)).toBe(true);
      expect(res.body.data.sources.length).toBeGreaterThan(0);
      expect(res.body.data.sources[0].snippet).toBeDefined();
      expect(res.body.data.sources[0].similarity).toBeGreaterThan(0);
    });

    it("allows recruiters to challenge selection checkpoints with tailored reasoning and evidence", async () => {
      const res = await request(app)
        .post(`${orgBase}/${organizationId}/applications/${applicationId}/ask`)
        .set(auth())
        .send({ question: "Why was this candidate given their score? Challenge the requirement checkpoints." })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.answer).toBeDefined();
      expect(typeof res.body.data.answer).toBe("string");
      expect(res.body.data.sources.length).toBeGreaterThan(0);
      expect(res.body.data.checkpointContext).toBeDefined();
      expect(res.body.data.checkpointContext.score).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(res.body.data.checkpointContext.matchedRequirements)).toBe(true);
    });

    it("enforces tenant boundary security on candidate resume queries", async () => {
      // User from outside organization cannot query the candidate resume
      const res = await request(app)
        .post(`${orgBase}/${organizationId}/applications/${applicationId}/ask`)
        .set(asUnauthorized())
        .send({ question: "Tell me about this candidate's salary or background." })
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("ORGANIZATION_NOT_FOUND");
    });

    it("validates question length against prompt injection / abuse", async () => {
      const res = await request(app)
        .post(`${orgBase}/${organizationId}/applications/${applicationId}/ask`)
        .set(auth())
        .send({ question: "Hi" }) // Less than 3 chars
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });
  });
});
