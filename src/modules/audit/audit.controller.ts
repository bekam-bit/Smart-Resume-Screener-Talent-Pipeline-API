import type { Request, Response } from "express";
import { respondList } from "../../schemas/common.schema.js";
import { parseOrThrow } from "../../middlewares/validate-request.js";
import { listAuditLogs } from "./audit.service.js";
import { listAuditLogsQuerySchema } from "./audit.schemas.js";

export const listAuditLogsController = async (request: Request, response: Response) => {
  const organizationId = request.params.organizationId as string;
  const query = parseOrThrow(listAuditLogsQuerySchema, request.query);

  const { total, logs } = await listAuditLogs(organizationId, query);

  respondList(response, logs, { page: query.page, pageSize: query.pageSize }, total);
};
