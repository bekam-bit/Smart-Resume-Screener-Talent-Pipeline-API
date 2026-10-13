import { describe, expect, it } from "vitest";
import { roleHasPermission } from "../../src/modules/organizations/permissions.js";

describe("organization authorization policy", () => {
  it("allows recruiters to read jobs but not manage members", () => {
    expect(roleHasPermission("RECRUITER", "job:read")).toBe(true);
    expect(roleHasPermission("RECRUITER", "organization:members:manage")).toBe(false);
  });

  it("allows administrators to manage organization members", () => {
    expect(roleHasPermission("ADMIN", "organization:members:manage")).toBe(true);
  });
});