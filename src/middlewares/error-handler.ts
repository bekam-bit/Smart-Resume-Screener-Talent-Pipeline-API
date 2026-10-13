import type { ErrorRequestHandler } from "express";
import { AppError } from "../utils/app-error.js";
import { isTransientDatabaseError } from "../utils/db-retry.js";

type BodyParserError = { type?: string };

export const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  if (error instanceof AppError) {
    response.status(error.statusCode).json({
      success: false,
      error: { code: error.code, message: error.message }
    });
    return;
  }

  // Body-parser (express.json) failures are client errors, not server errors.
  const parserError = error as BodyParserError;
  if (parserError?.type === "entity.parse.failed") {
    response.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Request body is not valid JSON" }
    });
    return;
  }
  if (parserError?.type === "entity.too.large") {
    response.status(413).json({
      success: false,
      error: { code: "PAYLOAD_TOO_LARGE", message: "Request body exceeds the size limit" }
    });
    return;
  }

  // Transient database problems (e.g. Neon cold start) are not bugs in the
  // request — report them as a retryable service-unavailable condition.
  if (isTransientDatabaseError(error)) {
    response.status(503).json({
      success: false,
      error: { code: "DATABASE_UNAVAILABLE", message: "The database is temporarily unavailable, please try again" }
    });
    return;
  }

  // Always surface the real cause on the server so failures are diagnosable.
  console.error(
    `[error] ${request.method} ${request.originalUrl} ->`,
    error instanceof Error ? (error.stack ?? error.message) : error
  );

  response.status(500).json({
    success: false,
    error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" }
  });
};