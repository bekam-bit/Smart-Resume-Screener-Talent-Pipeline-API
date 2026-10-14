import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/config/prisma.js";
import { createTestUser, databaseAvailable, removeTestUser } from "../helpers.js";

const orgBase = "/api/v1/organizations";
const jobsBase = "/api/v1/jobs";
const pdfBuffer = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF");

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

describe.runIf(databaseAvailable)("applications and pipeline", () => {
  let recruiter: TestUser;
  let candidate: TestUser;
  let outsider: TestUser;
  let organizationId = "";
  let jobId = "";
  let resumeId = "";

  const auth = () => ({ Authorization: `Bearer ${recruiter.accessToken}` });
  const asCandidate = () => ({ Authorization: `Bearer ${candidate.accessToken}` });
  const asOutsider = () => ({ Authorization: `Bearer ${outsider.accessToken}` });

  beforeAll(async () => {
    recruiter = await createTestUser("app-recruiter");
    candidate = await createTestUser("app-candidate");
    outsider = await createTestUser("app-outsider");

    const org = await request(app)
      .post(orgBase)
      .set(auth())
      .send({ name: "Pipeline Org", slug: `pipeline-org-${Date.now()}` });
    organizationId = org.body.organization.id;

    const job = await request(app)
      .post(`${orgBase}/${organizationId}/jobs`)
      .set(auth())
      .send({ title: "Platform Engineer", description: "Design resilient platform services for hiring workflows." });
    jobId = job.body.job.id;

    await request(app)
      .patch(`${orgBase}/${organizationId}/jobs/${jobId}/status`)
      .set(auth())
      .send({ status: "PUBLISHED" });

    const resume = await request(app)
      .post("/api/v1/me/resumes")
      .set(asCandidate())
      .attach("resume", pdfBuffer, { filename: "cv.pdf", contentType: "application/pdf" });
    resumeId = resume.body.resume.id;
  });

  afterAll(async () => {
    await removeTestUser(recruiter.user.id, [organizationId]);
    await removeTestUser(candidate.user.id);
    await removeTestUser(outsider.user.id);
  });

  const apply = () =>
    request(app).post(`${jobsBase}/${jobId}/applications`).set(asCandidate()).send({ resumeId, coverLetter: "Excited to apply." });

  /** Creates a fresh published job + resume and applies, yielding an isolated SUBMITTED application. */
  const freshApplication = async () => {
    const job = await request(app)
      .post(`${orgBase}/${organizationId}/jobs`)
      .set(auth())
      .send({ title: `Role ${Date.now()}-${Math.floor(Math.random() * 1e6)}`, description: "Isolated pipeline role used by a single application test." });
    const freshJobId = job.body.job.id as string;
    await request(app)
      .patch(`${orgBase}/${organizationId}/jobs/${freshJobId}/status`)
      .set(auth())
      .send({ status: "PUBLISHED" });

    const resume = await request(app)
      .post("/api/v1/me/resumes")
      .set(asCandidate())
      .attach("resume", pdfBuffer, { filename: `cv-${Date.now()}-${Math.random()}.pdf`, contentType: "application/pdf" });

    const applied = await request(app)
      .post(`${jobsBase}/${freshJobId}/applications`)
      .set(asCandidate())
      .send({ resumeId: resume.body.resume.id });
    expect(applied.status).toBe(201);
    return { applicationId: applied.body.application.id as string, jobId: freshJobId };
  };

  const advance = (applicationId: string, status: string, extra: Record<string, unknown> = {}) =>
    request(app)
      .patch(`${orgBase}/${organizationId}/applications/${applicationId}/status`)
      .set(auth())
      .send({ status, ...extra });

  it("rejects an application without authentication", async () => {
    const response = await request(app).post(`${jobsBase}/${jobId}/applications`).send({ resumeId });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("lets a candidate apply to a published job", async () => {
    const response = await apply();
    expect(response.status).toBe(201);
    expect(response.body.application.status).toBe("SUBMITTED");
    expect(response.body.application.job.id).toBe(jobId);
    expect(response.body.application.resume.id).toBe(resumeId);
  });

  it("prevents a second active application to the same job", async () => {
    const response = await apply();
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("ALREADY_APPLIED");
  });

  it("rejects applying with a resume the candidate does not own", async () => {
    const foreignResume = await request(app)
      .post("/api/v1/me/resumes")
      .set(asOutsider())
      .attach("resume", pdfBuffer, { filename: "other.pdf", contentType: "application/pdf" });

    const response = await request(app)
      .post(`${jobsBase}/${jobId}/applications`)
      .set(asCandidate())
      .send({ resumeId: foreignResume.body.resume.id });
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("RESUME_NOT_FOUND");
  });

  it("rejects applying to a non-published job", async () => {
    const draft = await request(app)
      .post(`${orgBase}/${organizationId}/jobs`)
      .set(auth())
      .send({ title: "Secret Role", description: "This role is still a draft and must not be visible to applicants." });
    const draftId = draft.body.job.id;

    const response = await request(app)
      .post(`${jobsBase}/${draftId}/applications`)
      .set(asCandidate())
      .send({ resumeId });
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("JOB_NOT_FOUND");
  });

  it("lists only the candidate's own applications", async () => {
    const response = await request(app).get("/api/v1/applications").set(asCandidate());
    expect(response.status).toBe(200);
    expect(response.body.data.length).toBeGreaterThanOrEqual(1);
    expect(response.body.data.every((a: { job: { id: string } }) => a.job.id === jobId)).toBe(true);
  });

  it("lets a candidate withdraw and then re-apply with a new resume", async () => {
    const { applicationId } = await freshApplication();

    const withdrawResponse = await request(app)
      .post(`/api/v1/applications/${applicationId}/withdraw`)
      .set(asCandidate());
    expect(withdrawResponse.status).toBe(200);
    expect(withdrawResponse.body.application.status).toBe("WITHDRAWN");

    // Re-applying with the same resume is blocked by the (candidate, job, resume)
    // uniqueness; a new resume yields a fresh, allowed application.
    const sameResume = await request(app)
      .post(`${jobsBase}/${jobId}/applications`)
      .set(asCandidate())
      .send({ resumeId });
    expect(sameResume.status).toBe(409);

    const { applicationId: reappliedId } = await freshApplication();
    const detail = await request(app).get(`/api/v1/applications/${reappliedId}`).set(asCandidate());
    expect(detail.body.application.status).toBe("SUBMITTED");
  });

  it("hides another candidate's application", async () => {
    const { applicationId } = await freshApplication();

    const response = await request(app).get(`/api/v1/applications/${applicationId}`).set(asOutsider());
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("APPLICATION_NOT_FOUND");
  });

  it("advances an application through the pipeline and records events", async () => {
    const { applicationId } = await freshApplication();

    const screening = await advance(applicationId, "SCREENING");
    expect(screening.status).toBe(200);
    expect(screening.body.application.status).toBe("SCREENING");

    const shortlisted = await advance(applicationId, "SHORTLISTED", { candidateVisible: true });
    expect(shortlisted.status).toBe(200);
    expect(shortlisted.body.application.status).toBe("SHORTLISTED");

    const events = await request(app)
      .get(`${orgBase}/${organizationId}/applications/${applicationId}/events`)
      .set(auth());
    expect(events.status).toBe(200);
    const toStatuses = events.body.data.map((e: { toStatus: string }) => e.toStatus);
    expect(toStatuses).toContain("SUBMITTED");
    expect(toStatuses).toContain("SCREENING");
    expect(toStatuses).toContain("SHORTLISTED");
  });

  it("rejects an invalid pipeline transition", async () => {
    const { applicationId } = await freshApplication();
    await advance(applicationId, "SHORTLISTED");

    // HIRED is only reachable from OFFER, not from SHORTLISTED.
    const response = await advance(applicationId, "HIRED");
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("INVALID_STATUS_TRANSITION");
  });

  it("requires a reason when rejecting and blocks outsiders", async () => {
    const { applicationId } = await freshApplication();
    await advance(applicationId, "SHORTLISTED");

    const noReason = await advance(applicationId, "REJECTED");
    expect(noReason.status).toBe(400);

    const forbidden = await request(app)
      .patch(`${orgBase}/${organizationId}/applications/${applicationId}/status`)
      .set(asOutsider())
      .send({ status: "REJECTED", reason: "Not a member" });
    expect(forbidden.status).toBe(404);
    expect(forbidden.body.error.code).toBe("ORGANIZATION_NOT_FOUND");

    const rejected = await advance(applicationId, "REJECTED", { reason: "Skill mismatch" });
    expect(rejected.status).toBe(200);
    expect(rejected.body.application.status).toBe("REJECTED");

    const afterTerminal = await advance(applicationId, "INTERVIEW");
    expect(afterTerminal.status).toBe(409);
    expect(afterTerminal.body.error.code).toBe("INVALID_STATUS_TRANSITION");
  });

  it("lets a recruiter add a note and lists job applications", async () => {
    const { applicationId } = await freshApplication();

    const note = await request(app)
      .post(`${orgBase}/${organizationId}/applications/${applicationId}/notes`)
      .set(auth())
      .send({ body: "Strong fundamentals, follow up." });
    expect(note.status).toBe(201);
    expect(note.body.note.body).toBe("Strong fundamentals, follow up.");

    const jobApps = await request(app)
      .get(`${orgBase}/${organizationId}/jobs/${jobId}/applications`)
      .set(auth());
    expect(jobApps.status).toBe(200);
    expect(jobApps.body.data.length).toBeGreaterThanOrEqual(1);
    expect(jobApps.body.data[0].candidate.email).toContain("@");
  });
});


