import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { logger } from "../../utils/logger.js";
import { withDbRetry } from "../../utils/db-retry.js";
import type { ListAuditLogsQuery } from "./audit.schemas.js";

export type AuditEntry = {
  actorId?: string | null;
  organizationId?: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata?: Record<string, unknown>;
};

export interface PublicAuditLog {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: unknown;
  createdAt: Date;
  actor: {
    id: string;
    email: string;
    name: string | null;
  } | null;
}

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

/**
 * Queries paginated audit logs scoped to an organization with multi-field filtering.
 */
export const listAuditLogs = async (
  organizationId: string,
  query: ListAuditLogsQuery
): Promise<{ total: number; logs: PublicAuditLog[] }> => {
  const where: Prisma.AuditLogWhereInput = {
    organizationId,
    ...(query.actorId ? { actorId: query.actorId } : {}),
    ...(query.resourceType ? { resourceType: query.resourceType } : {}),
    ...(query.action ? { action: query.action } : {}),
    ...(query.startDate || query.endDate
      ? {
          createdAt: {
            ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
            ...(query.endDate ? { lte: new Date(query.endDate) } : {})
          }
        }
      : {})
  };

  const page = query.page && query.page > 0 ? query.page : 1;
  const pageSize = query.pageSize && query.pageSize > 0 ? query.pageSize : 20;

  const [total, rows] = await withDbRetry(() =>
    Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: "desc" },
        include: {
          actor: {
            select: {
              id: true,
              email: true,
              candidateProfile: {
                select: { name: true }
              }
            }
          }
        }
      })
    ])
  );

  const logs: PublicAuditLog[] = rows.map((row) => ({
    id: row.id,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    metadata: row.metadata,
    createdAt: row.createdAt,
    actor: row.actor
      ? {
          id: row.actor.id,
          email: row.actor.email,
          name: row.actor.candidateProfile?.name ?? null
        }
      : null
  }));

  return { total, logs };
};