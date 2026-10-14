import express from "express";
import cors from "cors";
import helmet from "helmet";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./config/env.js";
import { errorHandler } from "./middlewares/error-handler.js";
import { requestContext } from "./middlewares/request-context.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { jobsRouter } from "./modules/jobs/jobs.routes.js";
import { organizationsRouter } from "./modules/organizations/organizations.routes.js";
import { profileRouter } from "./modules/profile/profile.routes.js";
import { candidateApplicationsRouter } from "./modules/applications/candidate-applications.routes.js";
import { organizationApplicationsRouter } from "./modules/applications/applications.routes.js";
import { screeningRouter } from "./modules/screening/screening.routes.js";
import { auditRouter } from "./modules/audit/audit.routes.js";
import { healthRouter } from "./routes/health.routes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const app = express();
const allowedOrigins = env.FRONTEND_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean);

app.disable("x-powered-by");
app.use(requestContext);
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
app.use(`${env.API_PREFIX}/organizations`, organizationsRouter);
app.use(`${env.API_PREFIX}/organizations`, organizationApplicationsRouter);
app.use(`${env.API_PREFIX}/organizations`, screeningRouter);
app.use(`${env.API_PREFIX}/organizations`, auditRouter);
app.use(`${env.API_PREFIX}/me`, profileRouter);
app.use(`${env.API_PREFIX}`, candidateApplicationsRouter);
app.use(`${env.API_PREFIX}`, jobsRouter);

app.use((_request, response) => {
  response.status(404).json({
    success: false,
    error: { code: "NOT_FOUND", message: "Route not found" }
  });
});

app.use(errorHandler);