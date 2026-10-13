import type { Request, Response } from "express";
import { env } from "../../config/env.js";
import { AppError } from "../../utils/app-error.js";
import { clearRefreshCookie, readRefreshToken, setRefreshCookie } from "./auth.cookies.js";
import { login, register, requestPasswordReset, resetPassword, resendVerificationEmail, revokeAllSessions, revokeRefreshToken, rotateRefreshToken, verifyEmail } from "./auth.service.js";
import { forgotPasswordSchema, loginSchema, registerSchema, resetPasswordSchema, tokenSchema } from "./auth.schemas.js";

export const registerController = async (request: Request, response: Response) => {
  const result = registerSchema.safeParse(request.body);
  if (!result.success) throw new AppError("VALIDATION_ERROR", "Invalid request payload", 400);
  const resultData = await register(result.data);
  response.status(201).json({
    user: resultData.user,
    verificationRequired: true,
    ...(!env.RESEND_API_KEY && env.NODE_ENV !== "production" ? { verificationToken: resultData.verificationToken } : {})
  });
};

export const loginController = async (request: Request, response: Response) => {
  const result = loginSchema.safeParse(request.body);
  if (!result.success) throw new AppError("VALIDATION_ERROR", "Invalid request payload", 400);
  const session = await login(result.data);
  setRefreshCookie(response, session.refreshToken);
  response.json({ user: session.user, accessToken: session.accessToken });
};

export const refreshController = async (request: Request, response: Response) => {
  const refreshToken = readRefreshToken(request);
  if (!refreshToken) throw new AppError("MISSING_REFRESH_TOKEN", "Refresh session is required", 401);
  const session = await rotateRefreshToken(refreshToken);
  setRefreshCookie(response, session.refreshToken);
  response.json({ user: session.user, accessToken: session.accessToken });
};

export const logoutController = async (request: Request, response: Response) => {
  const refreshToken = readRefreshToken(request);
  if (refreshToken) await revokeRefreshToken(refreshToken);
  clearRefreshCookie(response);
  response.status(204).send();
};

export const logoutAllController = async (request: Request, response: Response) => {
  if (!request.userId) throw new AppError("UNAUTHENTICATED", "Authentication is required", 401);
  await revokeAllSessions(request.userId);
  clearRefreshCookie(response);
  response.status(204).send();
};

export const verifyEmailController = async (request: Request, response: Response) => {
  const result = tokenSchema.safeParse(request.body);
  if (!result.success) throw new AppError("VALIDATION_ERROR", "Invalid request payload", 400);
  await verifyEmail(result.data);
  response.json({ message: "Email verified" });
};

export const forgotPasswordController = async (request: Request, response: Response) => {
  const result = forgotPasswordSchema.safeParse(request.body);
  if (!result.success) throw new AppError("VALIDATION_ERROR", "Invalid request payload", 400);
  const token = await requestPasswordReset(result.data.email);
  response.json({
    message: "If an account exists, password reset instructions will be sent",
    ...(token && !env.RESEND_API_KEY && env.NODE_ENV !== "production" ? { resetToken: token } : {})
  });
};

export const resetPasswordController = async (request: Request, response: Response) => {
  const result = resetPasswordSchema.safeParse(request.body);
  if (!result.success) throw new AppError("VALIDATION_ERROR", "Invalid request payload", 400);
  await resetPassword(result.data);
  response.json({ message: "Password reset" });
};

export const resendVerificationController = async (request: Request, response: Response) => {
  const result = forgotPasswordSchema.safeParse(request.body);
  if (!result.success) throw new AppError("VALIDATION_ERROR", "Invalid request payload", 400);
  await resendVerificationEmail(result.data.email);
  response.json({ message: "If your account exists and is unverified, a new verification email has been sent" });
};