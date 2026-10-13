import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../../src/app.js";

describe("health endpoints", () => {
  it("reports that the API is live without requiring the database", async () => {
    const response = await request(app).get("/api/v1/health/live");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("returns the standard not-found envelope", async () => {
    const response = await request(app).get("/api/v1/does-not-exist");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("rejects invalid registration input before touching the database", async () => {
    const response = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "invalid", password: "short", name: "" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns field-level validation details and a request id", async () => {
    const response = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "invalid", password: "short", name: "" });

    expect(response.status).toBe(400);
    expect(Array.isArray(response.body.error.details)).toBe(true);
    expect(response.body.error.details.map((detail: { field: string }) => detail.field)).toContain("email");
    expect(typeof response.body.error.requestId).toBe("string");
    expect(response.headers["x-request-id"]).toBe(response.body.error.requestId);
  });

  it("echoes a caller supplied request id", async () => {
    const response = await request(app)
      .get("/api/v1/health/live")
      .set("x-request-id", "req-from-client-123");

    expect(response.status).toBe(200);
    expect(response.headers["x-request-id"]).toBe("req-from-client-123");
  });

  it("rejects organization job access without authentication", async () => {
    const response = await request(app)
      .get("/api/v1/organizations/00000000-0000-0000-0000-000000000000/jobs");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects a modified bearer token before database authorization", async () => {
    const response = await request(app)
      .get("/api/v1/organizations/00000000-0000-0000-0000-000000000000/jobs")
      .set("Authorization", "Bearer invalid-token");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects an untrusted browser origin on cookie-authenticated refresh", async () => {
    const response = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Origin", "https://attacker.example");

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("INVALID_ORIGIN");
  });
});