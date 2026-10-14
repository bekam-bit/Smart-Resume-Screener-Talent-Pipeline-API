import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/config/prisma.js";
import { createTestUser, databaseAvailable, removeTestUser } from "../helpers.js";

const orgBase = "/api/v1/organizations";

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

describe.runIf(databaseAvailable)("Feature H: Audit Logs Endpoint", () => {
  let admin: TestUser;
  let recruiter: TestUser;
  let outsider: TestUser;
  let organizationId = "";
  let jobId = "";

  const asAdmin = () => ({ Authorization: `Bearer ${admin.accessToken}` });
  const asRecruiter = () => ({ Authorization: `Bearer ${recruiter.accessToken}` });
  const asOutsider = () => ({ Authorization: `Bearer ${outsider.accessToken}` });

  beforeAll(async () => {
    admin = await createTestUser("audit-admin");
    recruiter = await createTestUser("audit-recruiter");
    outsider = await createTestUser("audit-outsider");

    // 1. Admin creates organization
    const orgRes = await request(app)
      .post(orgBase)
      .set(asAdmin())
      .send({ name: "Audit Test Org", slug: `audit-org-${Date.now()}` });
    organizationId = orgRes.body.organization.id;

    // 2. Add recruiter to organization
    await request(app)
      .post(`${orgBase}/${organizationId}/members`)
      .set(asAdmin())
      .send({ email: recruiter.user.email, role: "RECRUITER" });

    // Activate membership directly in DB for testing
    await prisma.organizationMembership.updateMany({
      where: { organizationId, userId: recruiter.user.id },
      data: { status: "ACTIVE" }
    });

    // 3. Admin creates a job (which triggers job.create audit log)
    const jobRes = await request(app)
      .post(`${orgBase}/${organizationId}/jobs`)
      .set(asAdmin())
      .send({
        title: "Security Engineer",
        description: "Maintain secure production infrastructure and audit trails."
      });
    jobId = jobRes.body.job.id;
  });

  afterAll(async () => {
    await removeTestUser(admin.user.id, [organizationId]);
    await removeTestUser(recruiter.user.id);
    await removeTestUser(outsider.user.id);
  });

  it("allows organization ADMIN to list audit logs with standard pagination envelope", async () => {
    const res = await request(app)
      .get(`${orgBase}/${organizationId}/audit-logs`)
      .set(asAdmin())
      .expect(200);

    expect(res.body.data).toBeDefined();
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toBeDefined();
    expect(res.body.meta.page).toBe(1);
    expect(res.body.meta.pageSize).toBe(20);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);

    const first = res.body.data[0];
    expect(first.id).toBeDefined();
    expect(first.action).toBeDefined();
    expect(first.resourceType).toBeDefined();
    expect(first.resourceId).toBeDefined();
    expect(first.createdAt).toBeDefined();
    expect(first.actor).toBeDefined();
    expect(first.actor.id).toBe(admin.user.id);
  });

  it("filters audit logs by action", async () => {
    const res = await request(app)
      .get(`${orgBase}/${organizationId}/audit-logs`)
      .query({ action: "job.create" })
      .set(asAdmin())
      .expect(200);

    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    for (const log of res.body.data) {
      expect(log.action).toBe("job.create");
      expect(log.resourceType).toBe("Job");
    }
  });

  it("filters audit logs by resourceType", async () => {
    const res = await request(app)
      .get(`${orgBase}/${organizationId}/audit-logs`)
      .query({ resourceType: "Job" })
      .set(asAdmin())
      .expect(200);

    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    for (const log of res.body.data) {
      expect(log.resourceType).toBe("Job");
    }
  });

  it("filters audit logs by date range", async () => {
    const now = new Date();
    const past = new Date(now.getTime() - 60000).toISOString();
    const future = new Date(now.getTime() + 60000).toISOString();

    const res = await request(app)
      .get(`${orgBase}/${organizationId}/audit-logs`)
      .query({ startDate: past, endDate: future })
      .set(asAdmin())
      .expect(200);

    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it("forbids RECRUITER membership from viewing audit logs (403)", async () => {
    const res = await request(app)
      .get(`${orgBase}/${organizationId}/audit-logs`)
      .set(asRecruiter())
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("returns 404 for outsider with no membership in the organization", async () => {
    const res = await request(app)
      .get(`${orgBase}/${organizationId}/audit-logs`)
      .set(asOutsider())
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("ORGANIZATION_NOT_FOUND");
  });

  it("returns 401 for unauthenticated request", async () => {
    const res = await request(app)
      .get(`${orgBase}/${organizationId}/audit-logs`)
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });
});
