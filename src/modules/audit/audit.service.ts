import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { logger } from "../../utils/logger.js";

export type AuditEntry = {
  actorId?: string | null;
  organizationId?: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata?: Record<string, unknown>;
};

/**
 * Append-only audit trail. Writing an audit row must never break the business
 * request that triggered it — failures are logged and swallowed.
 */
export const recordAudit = async (entry: AuditEntry) => {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        organizationId: entry.organizationId ?? null,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        metadata: (entry.metadata ?? undefined) as Prisma.InputJsonValue | undefined
      }
    });
  } catch (error) {
    logger.warn("audit_write_failed", { action: entry.action, resourceId: entry.resourceId, error });
  }
};