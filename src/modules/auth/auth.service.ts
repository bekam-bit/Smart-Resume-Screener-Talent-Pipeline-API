import { randomUUID } from "node:crypto";
import type { AuthTokenPurpose } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { AppError } from "../../utils/app-error.js";
import { createOneTimeToken, hashOneTimeToken } from "../../utils/auth-secrets.js";
import { isUniqueConstraintError, withDbRetry } from "../../utils/db-retry.js";
import { hashPassword, verifyPassword } from "../../utils/password.js";
import { sendPasswordResetEmail, sendVerificationEmail } from "../../providers/resend.email.js";
import { createAccessToken, createRefreshToken, hashRefreshToken } from "./auth.tokens.js";
import type { LoginInput, RegisterInput, ResetPasswordInput, TokenInput } from "./auth.schemas.js";

const refreshExpiry = () => new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000);

const publicUser = (user: { id: string; email: string; emailVerifiedAt: Date | null }) => ({
  id: user.id,
  email: user.email,
  emailVerifiedAt: user.emailVerifiedAt
});

const issueSession = async (user: { id: string; email: string; emailVerifiedAt: Date | null }) => {
  const refreshToken = createRefreshToken();
  await prisma.refreshSession.create({
    data: {
      userId: user.id,
      tokenHash: hashRefreshToken(refreshToken),
      familyId: randomUUID(),
      expiresAt: refreshExpiry()
    }
  });

  return {
    user: publicUser(user),
    accessToken: await createAccessToken(user.id),
    refreshToken
  };
};

export const createAuthToken = async (userId: string, purpose: AuthTokenPurpose) => {
  const token = createOneTimeToken();
  await withDbRetry(() =>
    prisma.authToken.create({
      data: {
        userId,
        purpose,
        tokenHash: hashOneTimeToken(token),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      }
    })
  );
  return token;
};

export const register = async ({ email, password, name }: RegisterInput) => {
  const passwordHash = await hashPassword(password);

  try {
    // The database can be mid cold-start (Neon suspends when idle); retry the
    // write instead of letting the request fail with an opaque 500.
    const user = await withDbRetry(() =>
      prisma.user.create({
        data: { email, passwordHash, candidateProfile: { create: { name } } }
      })
    );
    const verificationToken = await createAuthToken(user.id, "EMAIL_VERIFICATION");
    try {
      await sendVerificationEmail(user.email, verificationToken);
    } catch (error) {
      console.error("Verification email delivery failed", error instanceof Error ? error.message : "unknown error");
    }
    return { user: publicUser(user), verificationToken };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AppError("EMAIL_IN_USE", "An account already exists for this email", 409);
    }
    throw error;
  }
};

export const login = async ({ email, password }: LoginInput) => {
  const user = await prisma.user.findUnique({ where: { email } });
  const validPassword = user?.passwordHash ? await verifyPassword(user.passwordHash, password) : false;

  if (!user || !validPassword || user.accountStatus !== "ACTIVE") {
    throw new AppError("INVALID_CREDENTIALS", "Invalid email or password", 401);
  }
  if (!user.emailVerifiedAt) {
    throw new AppError("EMAIL_NOT_VERIFIED", "Email verification is required", 403);
  }

  return issueSession(user);
};

export const verifyEmail = async ({ token }: TokenInput) => {
  const record = await prisma.authToken.findFirst({
    where: { tokenHash: hashOneTimeToken(token), purpose: "EMAIL_VERIFICATION", usedAt: null, expiresAt: { gt: new Date() } }
  });
  if (!record) throw new AppError("INVALID_VERIFICATION_TOKEN", "Verification token is invalid or expired", 400);

  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
    prisma.authToken.update({ where: { id: record.id }, data: { usedAt: new Date() } })
  ]);
};

export const requestPasswordReset = async (email: string) => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return undefined;
  const token = await createAuthToken(user.id, "PASSWORD_RESET");
  try {
    await sendPasswordResetEmail(user.email, token);
  } catch (error) {
    console.error("Password reset email delivery failed", error instanceof Error ? error.message : "unknown error");
  }
  return token;
};

export const resendVerificationEmail = async (email: string) => {
  const user = await prisma.user.findUnique({ where: { email } });
  // Silently no-op for unknown emails or already-verified accounts (security — prevents enumeration)
  if (!user || user.emailVerifiedAt) return;
  const token = await createAuthToken(user.id, "EMAIL_VERIFICATION");
  try {
    await sendVerificationEmail(user.email, token);
  } catch (error) {
    console.error("Resend verification email delivery failed", error instanceof Error ? error.message : "unknown error");
  }
};

export const resetPassword = async ({ token, password }: ResetPasswordInput) => {
  const record = await prisma.authToken.findFirst({
    where: { tokenHash: hashOneTimeToken(token), purpose: "PASSWORD_RESET", usedAt: null, expiresAt: { gt: new Date() } }
  });
  if (!record) throw new AppError("INVALID_RESET_TOKEN", "Reset token is invalid or expired", 400);

  const passwordHash = await hashPassword(password);
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    prisma.authToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.refreshSession.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } })
  ]);
};

export const rotateRefreshToken = async (refreshToken: string) => {
  const tokenHash = hashRefreshToken(refreshToken);
  const result = await prisma.$transaction(async (transaction) => {
    const current = await transaction.refreshSession.findUnique({ where: { tokenHash }, include: { user: true } });
    const now = new Date();
    if (!current || current.expiresAt <= now || current.user.accountStatus !== "ACTIVE") return { kind: "invalid" as const };
    if (current.revokedAt) {
      await transaction.refreshSession.updateMany({ where: { familyId: current.familyId, revokedAt: null }, data: { revokedAt: now } });
      return { kind: "reused" as const };
    }

    const replacementToken = createRefreshToken();
    const next = await transaction.refreshSession.create({
      data: { userId: current.userId, tokenHash: hashRefreshToken(replacementToken), familyId: current.familyId, expiresAt: refreshExpiry() }
    });
    const updated = await transaction.refreshSession.updateMany({
      where: { id: current.id, tokenHash, revokedAt: null, expiresAt: { gt: now } },
      data: { revokedAt: now, replacedBy: next.id }
    });
    if (updated.count !== 1) {
      await transaction.refreshSession.delete({ where: { id: next.id } });
      return { kind: "conflict" as const };
    }
    return { kind: "ok" as const, user: publicUser(current.user), userId: current.userId, refreshToken: replacementToken };
  });

  if (result.kind === "invalid") throw new AppError("INVALID_REFRESH_TOKEN", "Refresh session is invalid or expired", 401);
  if (result.kind === "reused") throw new AppError("REFRESH_TOKEN_REUSE", "Refresh session reuse detected", 401);
  if (result.kind === "conflict") throw new AppError("REFRESH_CONFLICT", "Refresh token was already used", 409);
  return { user: result.user, accessToken: await createAccessToken(result.userId), refreshToken: result.refreshToken };
};

export const revokeRefreshToken = async (refreshToken: string) => {
  await prisma.refreshSession.updateMany({ where: { tokenHash: hashRefreshToken(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
};

export const revokeAllSessions = (userId: string) =>
  prisma.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
