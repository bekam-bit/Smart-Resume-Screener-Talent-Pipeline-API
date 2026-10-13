import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { createTestUser, databaseAvailable, removeTestUser } from "../helpers.js";

const base = "/api/v1/me";

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

// A tiny but structurally-valid-enough buffer; upload validates MIME type, not PDF internals.
const pdfBuffer = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF");

describe.runIf(databaseAvailable)("candidate profile and resumes", () => {
  let candidate: TestUser;

  beforeAll(async () => {
    candidate = await createTestUser("profile-candidate");
  });

  afterAll(async () => {
    await removeTestUser(candidate.user.id);
  });

  const authHeader = () => ({ Authorization: `Bearer ${candidate.accessToken}` });

  it("rejects profile access without authentication", async () => {
    const response = await request(app).get(`${base}/profile`);
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("auto-creates a profile and updates it", async () => {
    const initial = await request(app).get(`${base}/profile`).set(authHeader());
    expect(initial.status).toBe(200);
    expect(typeof initial.body.profile.name).toBe("string");

    const updated = await request(app)
      .patch(`${base}/profile`)
      .set(authHeader())
      .send({ name: "Bekam Yoseph", location: "Addis Ababa", portfolioUrl: "https://example.com/me" });
    expect(updated.status).toBe(200);
    expect(updated.body.profile).toMatchObject({ name: "Bekam Yoseph", location: "Addis Ababa" });

    const noop = await request(app).patch(`${base}/profile`).set(authHeader()).send({});
    expect(noop.status).toBe(400);
    expect(noop.body.error.code).toBe("VALIDATION_ERROR");

    const badUrl = await request(app).patch(`${base}/profile`).set(authHeader()).send({ portfolioUrl: "not-a-url" });
    expect(badUrl.status).toBe(400);
  });

  it("uploads a PDF resume, lists it, and returns a presigned download link", async () => {
    const uploaded = await request(app)
      .post(`${base}/resumes`)
      .set(authHeader())
      .attach("resume", pdfBuffer, { filename: "cv.pdf", contentType: "application/pdf" });
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.resume).toMatchObject({ originalName: "cv.pdf", parseStatus: "QUEUED" });
    const resumeId = uploaded.body.resume.id as string;

    const list = await request(app).get(`${base}/resumes`).set(authHeader());
    expect(list.status).toBe(200);
    expect(list.body.data.map((r: { id: string }) => r.id)).toContain(resumeId);
    expect(list.body.meta.total).toBeGreaterThanOrEqual(1);

    const access = await request(app).get(`${base}/resumes/${resumeId}`).set(authHeader());
    expect(access.status).toBe(200);
    expect(typeof access.body.downloadUrl).toBe("string");
    expect(access.body.downloadUrl.length).toBeGreaterThan(0);
  });

  it("rejects unsupported file types and missing files", async () => {
    const badType = await request(app)
      .post(`${base}/resumes`)
      .set(authHeader())
      .attach("resume", Buffer.from("plain text"), { filename: "notes.txt", contentType: "text/plain" });
    expect(badType.status).toBe(415);
    expect(badType.body.error.code).toBe("UNSUPPORTED_FILE_TYPE");

    const missing = await request(app).post(`${base}/resumes`).set(authHeader());
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe("FILE_REQUIRED");
  });

  it("deletes a resume and then reports it missing", async () => {
    const uploaded = await request(app)
      .post(`${base}/resumes`)
      .set(authHeader())
      .attach("resume", pdfBuffer, { filename: "delete-me.pdf", contentType: "application/pdf" });
    const resumeId = uploaded.body.resume.id as string;

    const removed = await request(app).delete(`${base}/resumes/${resumeId}`).set(authHeader());
    expect(removed.status).toBe(204);

    const missing = await request(app).get(`${base}/resumes/${resumeId}`).set(authHeader());
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("RESUME_NOT_FOUND");
  });
});
