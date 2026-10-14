import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { withDbRetry } from "../utils/db-retry.js";
import { logger } from "../utils/logger.js";
import { executeScreeningRun } from "../modules/screening/screening.service.js";

export interface ScreeningBatchResult {
  processed: number;
  succeeded: number;
  failed: number;
}

/**
 * Processes a single batch of queued screening runs.
 */
export const processScreeningBatch = async (
  batchSize: number = env.SCREENING_BATCH_SIZE
): Promise<ScreeningBatchResult> => {
  const queued = await withDbRetry(() =>
    prisma.screeningRun.findMany({
      where: { status: "QUEUED" },
      orderBy: { createdAt: "asc" },
      take: batchSize,
      select: { id: true, applicationId: true }
    })
  );

  if (queued.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  logger.info("screening_worker_batch_started", {
    count: queued.length
  });

  let succeeded = 0;
  let failed = 0;

  for (const item of queued) {
    try {
      const result = await executeScreeningRun(item.id);
      if (result.status === "COMPLETE") {
        succeeded++;
      } else {
        failed++;
      }
    } catch (error) {
      failed++;
      logger.error("screening_worker_item_error", {
        screeningRunId: item.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  logger.info("screening_worker_batch_finished", {
    processed: queued.length,
    succeeded,
    failed
  });

  return { processed: queued.length, succeeded, failed };
};

export interface ScreeningWorkerOptions {
  pollIntervalMs?: number;
  batchSize?: number;
}

export class ScreeningWorker {
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;

  constructor(options: ScreeningWorkerOptions = {}) {
    this.pollIntervalMs = options.pollIntervalMs ?? env.SCREENING_POLL_INTERVAL_MS;
    this.batchSize = options.batchSize ?? env.SCREENING_BATCH_SIZE;
  }

  public isRunning(): boolean {
    return this.running;
  }

  public start(): void {
    if (this.running) return;
    this.running = true;

    logger.info("screening_worker_started", {
      pollIntervalMs: this.pollIntervalMs,
      batchSize: this.batchSize
    });

    const loop = async () => {
      if (!this.running) return;

      if (!this.isProcessing) {
        this.isProcessing = true;
        try {
          await processScreeningBatch(this.batchSize);
        } catch (error) {
          logger.error("screening_worker_loop_error", {
            error: error instanceof Error ? error.message : String(error)
          });
        } finally {
          this.isProcessing = false;
        }
      }

      if (this.running) {
        this.timer = setTimeout(loop, this.pollIntervalMs);
      }
    };

    this.timer = setTimeout(loop, 100);
  }

  public async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    while (this.isProcessing) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    logger.info("screening_worker_stopped");
  }
}

// ─────────────────────────────────────────────────────────────
//  CLI entrypoint when run as a standalone worker process
// ─────────────────────────────────────────────────────────────
const isDirectCli =
  typeof process.argv[1] === "string" &&
  (process.argv[1].endsWith("screening.worker.ts") || process.argv[1].endsWith("screening.worker.js"));

if (isDirectCli) {
  const worker = new ScreeningWorker();
  worker.start();

  const shutdown = async (signal: string) => {
    logger.info("screening_worker_shutdown_signal", { signal });
    await worker.stop();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}
