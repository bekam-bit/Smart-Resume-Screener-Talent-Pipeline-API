import { app } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./config/prisma.js";
import { withDbRetry } from "./utils/db-retry.js";

const server = app.listen(env.PORT, () => {
  console.log(`API listening on port ${env.PORT}`);

  // Warm the connection eagerly: Neon suspends the compute instance when idle,
  // so waking it at boot keeps the first request from paying the cold-start cost.
  void withDbRetry(() => prisma.$queryRaw`SELECT 1`, 5, 1000)
    .then(() => console.log("[startup] database warm-up complete"))
    .catch((error: unknown) =>
      console.error("[startup] database warm-up failed:", error instanceof Error ? error.message : error)
    );
});

const shutdown = async (signal: string) => {
  console.log(`Received ${signal}; shutting down`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));