import type { Response } from "express";
import { z } from "zod";

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20)
});

export type Pagination = z.infer<typeof paginationSchema>;

export const idParamSchema = z.object({ id: z.string().uuid() });

/** Validates `sort=field:asc|desc` against an allow-list of sortable fields. */
export const sortParamSchema = (allowedFields: readonly string[]) =>
  z
    .string()
    .regex(/^[A-Za-z_][A-Za-z0-9_]*:(asc|desc)$/, "sort must look like field:asc or field:desc")
    .refine((value) => allowedFields.includes(value.split(":")[0] ?? ""), {
      message: `sort field must be one of: ${allowedFields.join(", ")}`
    })
    .optional();

export type SortSpec<T extends string = string> = { field: T; direction: "asc" | "desc" };

/** Turns a validated `sort` query value into a Prisma orderBy object. */
export const parseSort = <T extends string>(
  value: string | undefined,
  allowedFields: readonly T[],
  fallback: SortSpec<T>
): SortSpec<T> => {
  if (!value) return fallback;
  const [rawField, rawDirection] = value.split(":");
  const field = allowedFields.includes(rawField as T) ? (rawField as T) : fallback.field;
  const direction = rawDirection === "asc" ? "asc" : "desc";
  return { field, direction };
};

export type ListMeta = { page: number; pageSize: number; total: number; totalPages: number };

export const listMeta = (pagination: Pagination, total: number): ListMeta => ({
  page: pagination.page,
  pageSize: pagination.pageSize,
  total,
  totalPages: Math.ceil(total / pagination.pageSize)
});

/** Standard list envelope: `{ data: [...], meta: { page, pageSize, total, totalPages } }`. */
export const respondList = <T>(response: Response, items: T[], pagination: Pagination, total: number) =>
  response.json({ data: items, meta: listMeta(pagination, total) });