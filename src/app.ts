import express from "express";
import cors from "cors";
import helmet from "helmet";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./config/env.js";
import { errorHandler } from "./middlewares/error-handler.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { jobsRouter } from "./modules/jobs/jobs.routes.js";
import { healthRouter } from "./routes/health.routes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const app = express();
const allowedOrigins = env.FRONTEND_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean);

app.disable("x-powered-by");
// CSP disabled in dev so the inline-script demo page works without a nonce pipeline
app.use(helmet({ contentSecurityPolicy: env.NODE_ENV !== "development" }));
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: "20kb" }));

if (env.NODE_ENV === "development") {
  app.use(express.static(join(__dirname, "../docs")));
  app.use(express.static(join(__dirname, "modules/auth/ui_demo")));
}

app.use(`${env.API_PREFIX}/health`, healthRouter);
app.use(`${env.API_PREFIX}/auth`, authRouter);
app.use(`${env.API_PREFIX}`, jobsRouter);

app.use((_request, response) => {
  response.status(404).json({
    success: false,
    error: { code: "NOT_FOUND", message: "Route not found" }
  });
});

app.use(errorHandler);