import type { RequestHandler } from "express";
import { prisma } from "../config/prisma.js";
import type { OrganizationPermission } from "../modules/organizations/permissions.js";
import { roleHasPermission } from "../modules/organizations/permissions.js";
import { AppError } from "../utils/app-error.js";
import { withDbRetry } from "../utils/db-retry.js";

const routeParam = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

const organizationIdFromRequest = (request: Parameters<RequestHandler>[0]) =>
  routeParam(request.params.organizationId) ?? routeParam(request.params.orgId);

const loadMembership = async (request: Parameters<RequestHandler>[0]) => {
  if (!request.userId) {
    throw new AppError("UNAUTHENTICATED", "Authentication is required", 401);
  }

  const organizationId = organizationIdFromRequest(request);
  if (!organizationId) {
    throw new AppError("INVALID_RESOURCE", "Organization ID is required", 400);
  }

  const userId = request.userId;
  const membership = await withDbRetry(() =>
    prisma.organizationMembership.findUnique({
      where: {
        userId_organizationId: {
          userId,
          organizationId
        }
      }
    })
  );

  if (!membership || membership.status !== "ACTIVE") {
    throw new AppError("ORGANIZATION_NOT_FOUND", "Organization not found", 404);
  }

  request.organizationId = organizationId;
  request.organizationRole = membership.role;
  return membership;
};

export const requireOrganizationPermission = (permission: OrganizationPermission): RequestHandler =>
  async (request, _response, next) => {
    try {
      const membership = await loadMembership(request);
      if (!roleHasPermission(membership.role, permission)) {
        throw new AppError("FORBIDDEN", "You do not have permission for this organization", 403);
      }
      next();
    } catch (error) {
      next(error);
    }
  };

export const requireOrganizationJobPermission = (permission: OrganizationPermission): RequestHandler =>
  async (request, _response, next) => {
    try {
      const membership = await loadMembership(request);
      if (!roleHasPermission(membership.role, permission)) {
        throw new AppError("FORBIDDEN", "You do not have permission for this organization", 403);
      }

      const organizationId = request.organizationId!;
      const job = await withDbRetry(() =>
        prisma.job.findFirst({
          where: { id: routeParam(request.params.jobId), organizationId },
          select: { id: true }
        })
      );

      if (!job) {
        throw new AppError("JOB_NOT_FOUND", "Job not found", 404);
      }

      request.jobId = job.id;
      next();
    } catch (error) {
      next(error);
    }
  };

export const requireOrganizationApplicationPermission = (permission: OrganizationPermission): RequestHandler =>
  async (request, _response, next) => {
    try {
      const membership = await loadMembership(request);
      if (!roleHasPermission(membership.role, permission)) {
        throw new AppError("FORBIDDEN", "You do not have permission for this organization", 403);
      }

      const organizationId = request.organizationId!;
      const application = await withDbRetry(() =>
        prisma.application.findFirst({
          where: { id: routeParam(request.params.applicationId), job: { organizationId } },
          select: { id: true }
        })
      );

      if (!application) {
        throw new AppError("APPLICATION_NOT_FOUND", "Application not found", 404);
      }

      request.applicationId = application.id;
      next();
    } catch (error) {
      next(error);
    }
  };