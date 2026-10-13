import type { RequestHandler } from "express";
import { AppError } from "../utils/app-error.js";
import { verifyAccessToken } from "../modules/auth/auth.tokens.js";

export const authenticate: RequestHandler = async (request, _response, next) => {
  try {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      throw new AppError("UNAUTHENTICATED", "Authentication is required", 401);
    }
    const { userId } = await verifyAccessToken(authorization.slice("Bearer ".length));
    request.userId = userId;
    next();
  } catch (error) {
    next(error instanceof AppError ? error : new AppError("UNAUTHENTICATED", "Authentication is required", 401));
  }
};