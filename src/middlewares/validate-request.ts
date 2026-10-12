import type { RequestHandler } from "express";
import type { ZodType } from "zod";

export const validateBody = <T>(schema: ZodType<T>): RequestHandler => (request, _response, next) => {
  const result = schema.safeParse(request.body);
  if (!result.success) {
    next(result.error);
    return;
  }

  request.body = result.data;
  next();
};