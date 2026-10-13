import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { createTestUser, databaseAvailable, removeTestUser } from "../helpers.js";

const base = "/api/v1/organizations";

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

describe.runIf(databaseAvailable)("organizations and membership", () => {
  let admin: TestUser;
  let recruiter: TestUser;
  let outsider: TestUser;
  const organizationIds: string[] = [];

  beforeAll(async () => {
    admin = await createTestUser("org-admin");
    recruiter = await createTestUser("org-recruiter");
    outsider = await createTestUser("org-outsider");
  });

  afterAll(async () => {
    await removeTestUser(admin.user.id, organizationIds);
    await removeTestUser(recruiter.user.id);
    await removeTestUser(outsider.user.id);
  });

  const createOrganization = async (token: string, name: string, slug?: string) => {
    const response = await request(app)
      .post(base)
      .set("Authorization", `Bearer ${token}`)
      .send(slug ? { name, slug } : { name });
    expect(response.status).toBe(201);
    organizationIds.push(response.body.organization.id);
    return response.body.organization as { id: string; slug: string };
  };

  it("rejects organization creation without authentication", async () => {
    const response = await request(app).post(base).send({ name: "No Auth Inc" });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("creates an organization with the creator as its admin", async () => {
    const organization = await createOrganization(admin.accessToken, "Acme Recruiting");

    expect(organization.slug).toBe("acme-recruiting");

    const members = await request(app)
      .get(`${base}/${organization.id}/members`)
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(members.status).toBe(200);
    expect(members.body.meta.total).toBe(1);
    expect(members.body.data[0]).toMatchObject({ userId: admin.user.id, role: "ADMIN", status: "ACTIVE" });
  });

  it("rejects a malformed organization id before touching authorization", async () => {
    const response = await request(app)
      .get(`${base}/not-a-uuid`)
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.details[0].field).toBe("organizationId");
  });

  it("hides organizations from users who are not members", async () => {
    const organization = await createOrganization(admin.accessToken, "Closed Doors Ltd");

    const response = await request(app)
      .get(`${base}/${organization.id}`)
      .set("Authorization", `Bearer ${outsider.accessToken}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("ORGANIZATION_NOT_FOUND");
  });

  it("lets admins manage the organization and blocks recruiters", async () => {
    const organization = await createOrganization(admin.accessToken, "Permission Test Co");

    const added = await request(app)
      .post(`${base}/${organization.id}/members`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ email: recruiter.user.email, role: "RECRUITER" });

    expect(added.status).toBe(201);
    expect(added.body.member).toMatchObject({ userId: recruiter.user.id, role: "RECRUITER", status: "ACTIVE" });

    const recruiterUpdate = await request(app)
      .patch(`${base}/${organization.id}`)
      .set("Authorization", `Bearer ${recruiter.accessToken}`)
      .send({ name: "Recruiter Rename" });
    expect(recruiterUpdate.status).toBe(403);

    const adminUpdate = await request(app)
      .patch(`${base}/${organization.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ name: "Permission Test Renamed" });
    expect(adminUpdate.status).toBe(200);
    expect(adminUpdate.body.organization.name).toBe("Permission Test Renamed");
  });

  it("rejects duplicate membership and duplicate slugs with 409", async () => {
    const organization = await createOrganization(admin.accessToken, "Conflict Corp", "conflict-corp");

    const added = await request(app)
      .post(`${base}/${organization.id}/members`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ email: recruiter.user.email, role: "RECRUITER" });
    expect(added.status).toBe(201);

    const duplicateMember = await request(app)
      .post(`${base}/${organization.id}/members`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ email: recruiter.user.email });
    expect(duplicateMember.status).toBe(409);
    expect(duplicateMember.body.error.code).toBe("ALREADY_MEMBER");

    const duplicateSlug = await request(app)
      .post(base)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ name: "Conflict Two", slug: "conflict-corp" });
    expect(duplicateSlug.status).toBe(409);
    expect(duplicateSlug.body.error.code).toBe("SLUG_IN_USE");
  });

  it("invites an unknown email as a pending, password-less account", async () => {
    const organization = await createOrganization(admin.accessToken, "Invite Only GmbH");

    const response = await request(app)
      .post(`${base}/${organization.id}/members`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ email: "invite-target@example.test", role: "RECRUITER" });

    expect(response.status).toBe(201);
    expect(response.body.member.status).toBe("INVITED");
    expect(response.body.member.email).toBe("invite-target@example.test");
  });

  it("refuses to demote the only active admin", async () => {
    const organization = await createOrganization(admin.accessToken, "Sole Admin SA");

    const response = await request(app)
      .patch(`${base}/${organization.id}/members/${admin.user.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ role: "RECRUITER" });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("LAST_ADMIN");
  });

  it("removes a member and immediately revokes their access", async () => {
    const organization = await createOrganization(admin.accessToken, "Access Revoked AG");

    await request(app)
      .post(`${base}/${organization.id}/members`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ email: recruiter.user.email, role: "RECRUITER" });

    const beforeRemoval = await request(app)
      .get(`${base}/${organization.id}`)
      .set("Authorization", `Bearer ${recruiter.accessToken}`);
    expect(beforeRemoval.status).toBe(200);

    const removal = await request(app)
      .delete(`${base}/${organization.id}/members/${recruiter.user.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(removal.status).toBe(204);

    const afterRemoval = await request(app)
      .get(`${base}/${organization.id}`)
      .set("Authorization", `Bearer ${recruiter.accessToken}`);
    expect(afterRemoval.status).toBe(404);
  });

  it("returns 404 when managing a user who is not a member", async () => {
    const organization = await createOrganization(admin.accessToken, "Ghost Members BV");

    const response = await request(app)
      .patch(`${base}/${organization.id}/members/${outsider.user.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ role: "RECRUITER" });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("MEMBER_NOT_FOUND");
  });
});