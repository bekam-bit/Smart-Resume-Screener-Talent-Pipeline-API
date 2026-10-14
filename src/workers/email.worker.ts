import { fileURLToPath } from "node:url";
import { logger } from "../utils/logger.js";
import {
  fetchPendingEmails,
  markEmailFailed,
  markEmailProcessing,
  markEmailSent
} from "../modules/notifications/outbox.service.js";
import { sendEmail } from "../providers/resend.email.js";

export interface EmailWorkerOptions {
  batchSize?: number;
  pollIntervalMs?: number;
}

/**
 * Processes a single batch of pending emails from the outbox.
 * Designed to be safely called from scheduled intervals or directly in tests.
 */
export const processEmailOutboxBatch = async (batchSize = 10) => {
  const pending = await fetchPendingEmails(batchSize);
  if (pending.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  logger.info("email_worker_batch_started", { count: pending.length });

  let succeeded = 0;
  let failed = 0;

  for (const item of pending) {
    try {
      await markEmailProcessing(item.id);

      await sendEmail({
        to: item.recipient,
        subject: item.subject,
        html: item.bodyHtml,
        text: item.bodyText
      });

      await markEmailSent(item.id);
      succeeded += 1;

      logger.info("email_worker_sent", {
        outboxId: item.id,
        recipient: item.recipient,
        subject: item.subject
      });
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "Unknown email delivery error";

      logger.warn("email_worker_send_failed", {
        outboxId: item.id,
        recipient: item.recipient,
        attempt: item.attempts + 1,
        maxAttempts: item.maxAttempts,
        error: message
      });

      await markEmailFailed(item.id, message, item.attempts, item.maxAttempts);
    }
  }

  return { processed: pending.length, succeeded, failed };
};

/**
 * Continuous polling worker with graceful shutdown.
 */
export class EmailWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private processing = false;
  private readonly batchSize: number;
  private readonly pollIntervalMs: number;

  constructor(options: EmailWorkerOptions = {}) {
    this.batchSize = options.batchSize ?? 10;
    this.pollIntervalMs = options.pollIntervalMs ?? 5000;
  }

  public start(): void {
    if (this.running) return;
    this.running = true;

    logger.info("email_worker_started", {
      pollIntervalMs: this.pollIntervalMs,
      batchSize: this.batchSize
    });

    const poll = async () => {
      if (!this.running) return;
      if (!this.processing) {
        this.processing = true;
        try {
          await processEmailOutboxBatch(this.batchSize);
        } catch (error) {
          logger.error("email_worker_unhandled_error", { error });
        } finally {
          this.processing = false;
        }
      }

      if (this.running) {
        this.timer = setTimeout(poll, this.pollIntervalMs);
      }
    };

    this.timer = setTimeout(poll, 100);
  }

  public async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    // Wait if a batch is currently executing
    let waitCount = 0;
    while (this.processing && waitCount < 30) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      waitCount += 1;
    }

    logger.info("email_worker_stopped");
  }

  public isRunning(): boolean {
    return this.running;
  }
}

// ─────────────────────────────────────────────────────────────
//  CLI entrypoint when run standalone: tsx src/workers/email.worker.ts
// ─────────────────────────────────────────────────────────────
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  const worker = new EmailWorker();
  worker.start();

  const shutdown = async () => {
    logger.info("email_worker_shutting_down");
    await worker.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
