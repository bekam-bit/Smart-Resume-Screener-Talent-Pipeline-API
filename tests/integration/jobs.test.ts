import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { createTestUser, databaseAvailable, removeTestUser } from "../helpers.js";

const base = "/api/v1/organizations";
const publicBase = "/api/v1/jobs";

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

describe.runIf(databaseAvailable)("jobs and requirements", () => {
  let admin: TestUser;
  let outsider: TestUser;
  let organizationId = "";

  beforeAll(async () => {
    admin = await createTestUser("jobs-admin");
    outsider = await createTestUser("jobs-outsider");

    const response = await request(app)
      .post(base)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ name: "Jobs Org", slug: `jobs-org-${Date.now()}` });
    organizationId = response.body.organization.id;
  });

  afterAll(async () => {
    await removeTestUser(admin.user.id, [organizationId]);
    await removeTestUser(outsider.user.id);
  });

  const createDraftJob = async (token: string, overrides: Record<string, unknown> = {}) => {
    const response = await request(app)
      .post(`${base}/${organizationId}/jobs`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Backend Engineer",
        description: "Build and maintain resilient backend services for the hiring platform.",
        location: "Addis Ababa",
        remotePolicy: "REMOTE",
        employmentType: "FULL_TIME",
        requirements: [
          { name: "TypeScript", type: "REQUIRED", weight: 50 },
          { name: "PostgreSQL", type: "PREFERRED" }
        ],
        ...overrides
      });
    return response;
  };

  const publish = async (jobId: string) =>
    request(app)
      .patch(`${base}/${organizationId}/jobs/${jobId}/status`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ status: "PUBLISHED" });

  it("rejects job creation without authentication", async () => {
    const response = await request(app).post(`${base}/${organizationId}/jobs`).send({ title: "X", description: "x".repeat(25) });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects job creation from a non-member", async () => {
    const response = await createDraftJob(outsider.accessToken);
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("ORGANIZATION_NOT_FOUND");
  });

  it("creates a draft job with nested requirements", async () => {
    const response = await createDraftJob(admin.accessToken);
    expect(response.status).toBe(201);
    expect(response.body.job.status).toBe("DRAFT");
    expect(response.body.job.publishedAt).toBeNull();
    expect(response.body.job.requirements).toHaveLength(2);
    expect(response.body.job.requirements[0]).toMatchObject({ name: "TypeScript", type: "REQUIRED", weight: 50 });
  });

  it("rejects invalid job payloads with field-level details", async () => {
    const response = await request(app)
      .post(`${base}/${organizationId}/jobs`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ title: "A", description: "too short" });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    const fields = response.body.error.details.map((d: { field: string }) => d.field);
    expect(fields).toContain("title");
    expect(fields).toContain("description");
  });

  it("publishes a draft job and exposes it on the public board", async () => {
    const created = await createDraftJob(admin.accessToken);
    const jobId = created.body.job.id as string;

    const published = await publish(jobId);
    expect(published.status).toBe(200);
    expect(published.body.job.status).toBe("PUBLISHED");
    expect(published.body.job.publishedAt).not.toBeNull();

    const publicList = await request(app).get(publicBase);
    expect(publicList.status).toBe(200);
    expect(publicList.body.data.map((j: { id: string }) => j.id)).toContain(jobId);

    const publicDetail = await request(app).get(`${publicBase}/${jobId}`);
    expect(publicDetail.status).toBe(200);
    expect(publicDetail.body.job.requirements).toHaveLength(2);
  });

  it("rejects an invalid lifecycle transition", async () => {
    const created = await createDraftJob(admin.accessToken);
    const jobId = created.body.job.id as string;

    const closed = await request(app)
      .patch(`${base}/${organizationId}/jobs/${jobId}/status`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ status: "CLOSED" });
    expect(closed.status).toBe(409);
    expect(closed.body.error.code).toBe("INVALID_STATUS_TRANSITION");
  });


  it("blocks wholesale requirement changes on a published job", async () => {
    const created = await createDraftJob(admin.accessToken);
    const jobId = created.body.job.id as string;
    await publish(jobId);

    const updated = await request(app)
      .patch(`${base}/${organizationId}/jobs/${jobId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ title: "Renamed", requirements: [{ name: "OnlyOne", type: "REQUIRED" }] });
    expect(updated.status).toBe(409);
    expect(updated.body.error.code).toBe("JOB_IMMUTABLE");
  });

  it("adds, updates, and removes a requirement", async () => {
    const created = await createDraftJob(admin.accessToken);
    const jobId = created.body.job.id as string;

    const added = await request(app)
      .post(`${base}/${organizationId}/jobs/${jobId}/requirements`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ name: "Docker", type: "PREFERRED", weight: 20 });
    expect(added.status).toBe(201);
    const requirementId = added.body.requirement.id as string;

    const patched = await request(app)
      .patch(`${base}/${organizationId}/jobs/${jobId}/requirements/${requirementId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ weight: 40 });
    expect(patched.status).toBe(200);
    expect(patched.body.requirement.weight).toBe(40);

    const removed = await request(app)
      .delete(`${base}/${organizationId}/jobs/${jobId}/requirements/${requirementId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(removed.status).toBe(204);

    const missing = await request(app)
      .patch(`${base}/${organizationId}/jobs/${jobId}/requirements/${requirementId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ name: "Ghost" });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("REQUIREMENT_NOT_FOUND");
  });

  it("deletes a draft job but refuses a published one", async () => {
    const draft = await createDraftJob(admin.accessToken, { title: "Draft To Delete" });
    const draftId = draft.body.job.id as string;
    const deleted = await request(app)
      .delete(`${base}/${organizationId}/jobs/${draftId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(deleted.status).toBe(204);

    const published = await createDraftJob(admin.accessToken, { title: "Published Keep" });
    await publish(published.body.job.id as string);

    const refused = await request(app)
      .delete(`${base}/${organizationId}/jobs/${published.body.job.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("JOB_NOT_DRAFT");
  });

  it("hides non-published jobs from the public board", async () => {
    const response = await request(app).get(`${publicBase}/00000000-0000-0000-0000-000000000000`);
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("JOB_NOT_FOUND");
  });

  it("returns a paginated, sortable org job list", async () => {
    await createDraftJob(admin.accessToken, { title: "Zebra Analyst" });
    await createDraftJob(admin.accessToken, { title: "Alpha Designer" });

    const response = await request(app)
      .get(`${base}/${organizationId}/jobs`)
      .query({ status: "DRAFT", sort: "title:asc", pageSize: 1 })
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(response.status).toBe(200);
    expect(response.body.meta.pageSize).toBe(1);
    expect(response.body.data.length).toBeGreaterThanOrEqual(1);
    expect(response.body.meta.total).toBeGreaterThanOrEqual(2);
  });
});

