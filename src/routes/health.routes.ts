import { Router } from "express";
import { prisma } from "../config/prisma.js";

export const healthRouter = Router();

healthRouter.get("/live", (_request, response) => {
  response.json({ status: "ok" });
});

healthRouter.get("/ready", async (_request, response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    response.json({ status: "ok", database: "reachable" });
  } catch {
    response.status(503).json({ status: "degraded", database: "unreachable" });
  }
});