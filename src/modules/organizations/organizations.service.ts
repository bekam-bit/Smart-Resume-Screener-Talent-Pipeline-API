import { prisma } from "../../config/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { isUniqueConstraintError, withDbRetry } from "../../utils/db-retry.js";
import { sendPasswordResetEmail } from "../../providers/resend.email.js";
import { recordAudit } from "../audit/audit.service.js";
import { createAuthToken } from "../auth/auth.service.js";
import type { Pagination } from "../../schemas/common.schema.js";
import type {
  AddMemberInput,
  CreateOrganizationInput,
  UpdateMemberInput,
  UpdateOrganizationInput
} from "./organizations.schemas.js";

const slugify = (value: string) => {
  const base = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "org";
};

const uniqueSlug = async (base: string) => {
  let candidate = base;
  let suffix = 1;
  while (await withDbRetry(() => prisma.organization.findUnique({ where: { slug: candidate }, select: { id: true } }))) {
    suffix += 1;
    candidate = `${base.slice(0, 55)}-${suffix}`;
  }
  return candidate;
};

const publicOrganization = (organization: { id: string; name: string; slug: string; createdAt: Date; updatedAt: Date }) => ({
  id: organization.id,
  name: organization.name,
  slug: organization.slug,
  createdAt: organization.createdAt,
  updatedAt: organization.updatedAt
});

export const createOrganization = async (actorId: string, input: CreateOrganizationInput) => {
  let slug: string;
  if (input.slug) {
    const existing = await withDbRetry(() =>
      prisma.organization.findUnique({ where: { slug: input.slug }, select: { id: true } })
    );
    if (existing) throw new AppError("SLUG_IN_USE", "That organization slug is already taken", 409);
    slug = input.slug;
  } else {
    slug = await uniqueSlug(slugify(input.name));
  }

  try {
    const organization = await withDbRetry(() =>
      prisma.$transaction(async (transaction) => {
        const created = await transaction.organization.create({ data: { name: input.name, slug } });
        await transaction.organizationMembership.create({
          data: { userId: actorId, organizationId: created.id, role: "ADMIN", status: "ACTIVE" }
        });
        return created;
      })
    );

    await recordAudit({
      actorId,
      organizationId: organization.id,
      action: "organization.create",
      resourceType: "Organization",
      resourceId: organization.id,
      metadata: { name: organization.name, slug: organization.slug }
    });

    return publicOrganization(organization);
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new AppError("SLUG_IN_USE", "That organization slug is already taken", 409);
    throw error;
  }
};

export const getOrganization = async (organizationId: string, actorId: string) => {
  const organization = await withDbRetry(() => prisma.organization.findUnique({ where: { id: organizationId } }));
  if (!organization) throw new AppError("ORGANIZATION_NOT_FOUND", "Organization not found", 404);

  const memberCount = await withDbRetry(() =>
    prisma.organizationMembership.count({
      where: { organizationId, status: { not: "REMOVED" } }
    })
  );

  void actorId;
  return { ...publicOrganization(organization), memberCount };
};

export const updateOrganization = async (
  organizationId: string,
  actorId: string,
  input: UpdateOrganizationInput
) => {
  if (input.slug) {
    const clash = await withDbRetry(() =>
      prisma.organization.findFirst({
        where: { slug: input.slug, id: { not: organizationId } },
        select: { id: true }
      })
    );
    if (clash) throw new AppError("SLUG_IN_USE", "That organization slug is already taken", 409);
  }

  try {
    const organization = await prisma.organization.update({
      where: { id: organizationId },
      data: { ...(input.name ? { name: input.name } : {}), ...(input.slug ? { slug: input.slug } : {}) }
    });

    await recordAudit({
      actorId,
      organizationId,
      action: "organization.update",
      resourceType: "Organization",
      resourceId: organizationId,
      metadata: { name: organization.name, slug: organization.slug }
    });

    return publicOrganization(organization);
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new AppError("SLUG_IN_USE", "That organization slug is already taken", 409);
    throw error;
  }
};

export const listMembers = async (organizationId: string, pagination: Pagination) => {
  const where = { organizationId, status: { not: "REMOVED" as const } };
  const [total, rows] = await withDbRetry(() =>
    Promise.all([
      prisma.organizationMembership.count({ where }),
      prisma.organizationMembership.findMany({
        where,
        skip: (pagination.page - 1) * pagination.pageSize,
        take: pagination.pageSize,
        orderBy: { createdAt: "asc" },
        select: {
          userId: true,
          role: true,
          status: true,
          createdAt: true,
          user: { select: { email: true, candidateProfile: { select: { name: true } } } }
        }
      })
    ])
  );

  return {
    total,
    members: rows.map((row) => ({
      userId: row.userId,
      email: row.user.email,
      name: row.user.candidateProfile?.name ?? null,
      role: row.role,
      status: row.status,
      joinedAt: row.createdAt
    }))
  };
};

const deliverInvite = async (userId: string, email: string) => {
  const token = await createAuthToken(userId, "PASSWORD_RESET");
  try {
    await sendPasswordResetEmail(email, token);
  } catch (error) {
    // Delivery must not fail the membership change — the token is still valid.
    console.error("Member invitation delivery failed", error instanceof Error ? error.message : "unknown error");
  }
};

export const addMember = async (organizationId: string, actorId: string, input: AddMemberInput) => {
  const existingUser = await withDbRetry(() =>
    prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true, email: true, emailVerifiedAt: true, candidateProfile: { select: { name: true } } }
    })
  );

  let target = existingUser;
  let createdAccount = false;
  if (!target) {
    // Invitation for an unknown email: create a password-less account the
    // invitee claims by setting a password through the reset link.
    const created = await withDbRetry(() =>
      prisma.user.create({
        data: { email: input.email, passwordHash: null },
        select: { id: true, email: true, emailVerifiedAt: true, candidateProfile: { select: { name: true } } }
      })
    );
    target = created;
    createdAccount = true;
  }

  const existingMembership = await prisma.organizationMembership.findUnique({
    where: { userId_organizationId: { userId: target.id, organizationId } }
  });
  if (existingMembership && existingMembership.status !== "REMOVED") {
    throw new AppError("ALREADY_MEMBER", "This user is already a member of the organization", 409);
  }

  const status = createdAccount || !target.emailVerifiedAt ? "INVITED" : "ACTIVE";

  try {
    const membership = await withDbRetry(() =>
      existingMembership
        ? prisma.organizationMembership.update({
            where: { userId_organizationId: { userId: target!.id, organizationId } },
            data: { role: input.role, status }
          })
        : prisma.organizationMembership.create({
            data: { userId: target!.id, organizationId, role: input.role, status }
          })
    );

    if (status === "INVITED") await deliverInvite(target.id, target.email);

    await recordAudit({
      actorId,
      organizationId,
      action: existingMembership ? "organization.member.reactivate" : "organization.member.add",
      resourceType: "OrganizationMembership",
      resourceId: membership.userId,
      metadata: { email: target.email, role: membership.role, status: membership.status }
    });

    return {
      userId: membership.userId,
      email: target.email,
      name: target.candidateProfile?.name ?? null,
      role: membership.role,
      status: membership.status,
      joinedAt: membership.createdAt
    };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AppError("ALREADY_MEMBER", "This user is already a member of the organization", 409);
    }
    throw error;
  }
};

const assertNotLastAdmin = async (
  organizationId: string,
  membership: { userId: string; role: string; status: string },
  nextRole: string,
  nextStatus: string
) => {
  const demotingActiveAdmin =
    membership.role === "ADMIN" && membership.status === "ACTIVE" && (nextRole !== "ADMIN" || nextStatus !== "ACTIVE");
  if (!demotingActiveAdmin) return;

  const remainingAdmins = await prisma.organizationMembership.count({
    where: {
      organizationId,
      role: "ADMIN",
      status: "ACTIVE",
      userId: { not: membership.userId }
    }
  });
  if (remainingAdmins === 0) {
    throw new AppError("LAST_ADMIN", "An organization must keep at least one active admin", 409);
  }
};

export const updateMember = async (
  organizationId: string,
  actorId: string,
  targetUserId: string,
  input: UpdateMemberInput
) => {
  const membership = await prisma.organizationMembership.findUnique({
    where: { userId_organizationId: { userId: targetUserId, organizationId } },
    select: { userId: true, role: true, status: true, user: { select: { email: true } } }
  });
  if (!membership || membership.status === "REMOVED") {
    throw new AppError("MEMBER_NOT_FOUND", "Member not found", 404);
  }

  const nextRole = input.role ?? membership.role;
  const nextStatus = input.status ?? membership.status;
  await assertNotLastAdmin(organizationId, membership, nextRole, nextStatus);

  const updated = await prisma.organizationMembership.update({
    where: { userId_organizationId: { userId: targetUserId, organizationId } },
    data: { ...(input.role ? { role: input.role } : {}), ...(input.status ? { status: input.status } : {}) },
    select: { userId: true, role: true, status: true, createdAt: true }
  });

  await recordAudit({
    actorId,
    organizationId,
    action: "organization.member.update",
    resourceType: "OrganizationMembership",
    resourceId: targetUserId,
    metadata: { email: membership.user.email, role: updated.role, status: updated.status }
  });

  return { userId: updated.userId, email: membership.user.email, role: updated.role, status: updated.status };
};

export const removeMember = async (organizationId: string, actorId: string, targetUserId: string) => {
  const membership = await prisma.organizationMembership.findUnique({
    where: { userId_organizationId: { userId: targetUserId, organizationId } },
    select: { userId: true, role: true, status: true, user: { select: { email: true } } }
  });
  if (!membership) throw new AppError("MEMBER_NOT_FOUND", "Member not found", 404);
  if (membership.status === "REMOVED") return;

  await assertNotLastAdmin(organizationId, membership, membership.role, "REMOVED");

  await prisma.organizationMembership.update({
    where: { userId_organizationId: { userId: targetUserId, organizationId } },
    data: { status: "REMOVED" }
  });

  await recordAudit({
    actorId,
    organizationId,
    action: "organization.member.remove",
    resourceType: "OrganizationMembership",
    resourceId: targetUserId,
    metadata: { email: membership.user.email, role: membership.role }
  });
};