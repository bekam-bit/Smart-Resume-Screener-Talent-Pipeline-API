import express from "express";
import { env } from "./config/env.js";
import { healthRouter } from "./routes/health.routes.js";

export const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(`${env.API_PREFIX}/health`, healthRouter);

app.use((_request, response) => {
  response.status(404).json({
    success: false,
    error: { code: "NOT_FOUND", message: "Route not found" }
  });
});