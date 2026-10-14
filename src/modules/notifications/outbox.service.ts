import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { withDbRetry } from "../../utils/db-retry.js";
import { logger } from "../../utils/logger.js";

export interface EnqueueEmailInput {
  recipient: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  metadata?: Record<string, unknown>;
}

/**
 * Enqueues an email into the EmailOutbox table.
 * If a transaction client is passed, it executes within that transaction,
 * guaranteeing transactional consistency with business operations.
 */
export const enqueueEmail = async (
  input: EnqueueEmailInput,
  tx?: Prisma.TransactionClient
) => {
  const client = tx ?? prisma;

  const outboxEntry = await withDbRetry(() =>
    client.emailOutbox.create({
      data: {
        recipient: input.recipient,
        subject: input.subject,
        bodyHtml: input.bodyHtml,
        bodyText: input.bodyText,
        metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        status: "PENDING",
        nextAttemptAt: new Date()
      }
    })
  );

  logger.info("email_outbox_enqueued", {
    outboxId: outboxEntry.id,
    recipient: outboxEntry.recipient,
    subject: outboxEntry.subject
  });

  return outboxEntry;
};

/**
 * Fetches batch of pending emails ready to be sent.
 */
export const fetchPendingEmails = async (limit = 10) => {
  return withDbRetry(() =>
    prisma.emailOutbox.findMany({
      where: {
        status: "PENDING",
        nextAttemptAt: { lte: new Date() }
      },
      orderBy: { nextAttemptAt: "asc" },
      take: limit
    })
  );
};

/**
 * Marks an outbox record as PROCESSING.
 */
export const markEmailProcessing = async (id: string) => {
  return withDbRetry(() =>
    prisma.emailOutbox.update({
      where: { id },
      data: { status: "PROCESSING" }
    })
  );
};

/**
 * Marks an outbox record as SENT.
 */
export const markEmailSent = async (id: string) => {
  return withDbRetry(() =>
    prisma.emailOutbox.update({
      where: { id },
      data: {
        status: "SENT",
        sentAt: new Date(),
        lastError: null
      }
    })
  );
};

/**
 * Handles email delivery failure with exponential backoff or marks FAILED if max attempts reached.
 */
export const markEmailFailed = async (
  id: string,
  errorMessage: string,
  currentAttempts: number,
  maxAttempts: number
) => {
  const newAttempts = currentAttempts + 1;
  const isTerminal = newAttempts >= maxAttempts;

  // Backoff: 10s, 20s, 40s, 80s... capped at 1 hour
  const delayMs = Math.min(3_600_000, 10_000 * Math.pow(2, currentAttempts));
  const nextAttemptAt = new Date(Date.now() + delayMs);

  return withDbRetry(() =>
    prisma.emailOutbox.update({
      where: { id },
      data: {
        status: isTerminal ? "FAILED" : "PENDING",
        attempts: newAttempts,
        lastError: errorMessage.slice(0, 1000),
        nextAttemptAt: isTerminal ? undefined : nextAttemptAt
      }
    })
  );
};
