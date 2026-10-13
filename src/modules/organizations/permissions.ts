import type { OrganizationRole } from "@prisma/client";

export type OrganizationPermission =
  | "organization:read"
  | "organization:members:manage"
  | "job:read"
  | "job:create"
  | "job:update"
  | "job:publish"
  | "application:read"
  | "application:advance"
  | "application:reject"
  | "screening:read"
  | "audit:read";

const rolePermissions: Record<OrganizationRole, readonly OrganizationPermission[]> = {
  ADMIN: [
    "organization:read",
    "organization:members:manage",
    "job:read",
    "job:create",
    "job:update",
    "job:publish",
    "application:read",
    "application:advance",
    "application:reject",
    "screening:read",
    "audit:read"
  ],
  RECRUITER: [
    "organization:read",
    "job:read",
    "job:create",
    "job:update",
    "job:publish",
    "application:read",
    "application:advance",
    "application:reject",
    "screening:read"
  ]
};

export const roleHasPermission = (role: OrganizationRole, permission: OrganizationPermission) =>
  rolePermissions[role].includes(permission);