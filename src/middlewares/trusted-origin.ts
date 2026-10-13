import type { RequestHandler } from "express";
import { env } from "../config/env.js";
import { AppError } from "../utils/app-error.js";

const allowedOrigins = new Set(env.FRONTEND_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean));

export const requireTrustedOrigin: RequestHandler = (request, _response, next) => {
  const origin = request.get("origin");
  if (origin && !allowedOrigins.has(origin)) {
    next(new AppError("INVALID_ORIGIN", "Request origin is not allowed", 403));
    return;
  }
  next();
};