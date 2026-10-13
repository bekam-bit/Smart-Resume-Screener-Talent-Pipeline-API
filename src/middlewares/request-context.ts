import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { logger } from "../utils/logger.js";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Assigns a correlation ID to every request (honouring a trusted incoming
 * `x-request-id`), echoes it back on the response, and emits one structured
 * access-log line per completed request.
 */
export const requestContext: RequestHandler = (request, response, next) => {
  const incoming = request.header("x-request-id");
  request.requestId = incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
  response.setHeader("x-request-id", request.requestId);

  const startedAt = process.hrtime.bigint();
  response.on("finish", () => {
    const durationMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e5) / 10;
    logger.info("http_request", {
      requestId: request.requestId,
      method: request.method,
      // path only — query strings may carry tokens
      path: request.path,
      status: response.statusCode,
      durationMs,
      userId: request.userId
    });
  });

  next();
};