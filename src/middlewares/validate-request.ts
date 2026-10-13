import type { RequestHandler } from "express";
import type { ZodType } from "zod";
import { AppError, type ErrorDetail } from "../utils/app-error.js";

type ZodLikeError = { issues: readonly { path: readonly PropertyKey[]; message: string }[] };

/** Maps Zod issues to the API's `error.details[]` shape (field + message). */
export const toErrorDetails = (error: ZodLikeError): ErrorDetail[] =>
  error.issues.map((issue) => ({
    field: issue.path.map(String).join(".") || "(root)",
    message: issue.message
  }));

/** Parses a value or throws a 400 VALIDATION_ERROR carrying field-level details. */
export const parseOrThrow = <T>(schema: ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError("VALIDATION_ERROR", "Invalid request payload", 400, toErrorDetails(result.error));
  }
  return result.data;
};

const run = (next: (error?: unknown) => void, parse: () => void) => {
  try {
    parse();
    next();
  } catch (error) {
    next(error);
  }
};

/** Validates and replaces `request.body`. */
export const validateBody =
  <T>(schema: ZodType<T>): RequestHandler =>
  (request, _response, next) =>
    run(next, () => {
      request.body = parseOrThrow(schema, request.body);
    });

/** Validates and replaces `request.params`. */
export const validateParams =
  <T>(schema: ZodType<T>): RequestHandler =>
  (request, _response, next) =>
    run(next, () => {
      request.params = parseOrThrow(schema, request.params) as Record<string, string>;
    });

/**
 * Validates `request.query`. Express 5 exposes `query` through a read-only
 * getter, so the parsed result is produced with `parseOrThrow` inside handlers
 * rather than written back here.
 */
export const validateQuery =
  <T>(schema: ZodType<T>): RequestHandler =>
  (request, _response, next) =>
    run(next, () => {
      parseOrThrow(schema, request.query);
    });