import { app } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./config/prisma.js";
import { withDbRetry } from "./utils/db-retry.js";
import { EmailWorker } from "./workers/email.worker.js";
import { ScreeningWorker } from "./workers/screening.worker.js";

let emailWorker: EmailWorker | null = null;
let screeningWorker: ScreeningWorker | null = null;

const server = app.listen(env.PORT, () => {
  console.log(`API listening on port ${env.PORT}`);

  // Warm the connection eagerly: Neon suspends the compute instance when idle,
  // so waking it at boot keeps the first request from paying the cold-start cost.
  void withDbRetry(() => prisma.$queryRaw`SELECT 1`, 5, 1000)
    .then(() => console.log("[startup] database warm-up complete"))
    .catch((error: unknown) =>
      console.error("[startup] database warm-up failed:", error instanceof Error ? error.message : error)
    );

  // Start embedded background workers for transactional emails and resume screening
  if (env.ENABLE_EMBEDDED_WORKERS && env.NODE_ENV !== "test") {
    emailWorker = new EmailWorker({ pollIntervalMs: 3000, batchSize: 10 });
    emailWorker.start();
    console.log("[startup] embedded email worker started (polling outbox every 3s)");

    screeningWorker = new ScreeningWorker({
      pollIntervalMs: env.SCREENING_POLL_INTERVAL_MS,
      batchSize: env.SCREENING_BATCH_SIZE
    });
    screeningWorker.start();
    console.log(`[startup] embedded screening worker started (polling every ${env.SCREENING_POLL_INTERVAL_MS}ms)`);
  }
});

const shutdown = async (signal: string) => {
  console.log(`Received ${signal}; shutting down`);
  if (emailWorker) {
    await emailWorker.stop();
  }
  if (screeningWorker) {
    await screeningWorker.stop();
  }
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));