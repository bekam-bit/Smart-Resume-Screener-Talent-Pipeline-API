import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/config/prisma.js";
import {
  enqueueEmail,
  fetchPendingEmails,
  markEmailFailed,
  markEmailProcessing,
  markEmailSent
} from "../../src/modules/notifications/outbox.service.js";
import { EmailWorker, processEmailOutboxBatch } from "../../src/workers/email.worker.js";
import * as resendProvider from "../../src/providers/resend.email.js";
import { databaseAvailable } from "../helpers.js";

describe.runIf(databaseAvailable)("Feature F: EmailOutbox and Email Worker", () => {
  const testRecipient = `outbox-test-${Date.now()}@example.test`;
  const createdOutboxIds: string[] = [];

  let sendEmailSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    sendEmailSpy = vi.spyOn(resendProvider, "sendEmail").mockResolvedValue(undefined);
    await prisma.emailOutbox.deleteMany({
      where: { status: "PENDING" }
    }).catch(() => {});
  });

  afterAll(async () => {
    sendEmailSpy?.mockRestore();
    if (createdOutboxIds.length > 0) {
      await prisma.emailOutbox.deleteMany({
        where: { id: { in: createdOutboxIds } }
      });
    }
  });

  it("enqueues an email into the outbox with PENDING status", async () => {
    const entry = await enqueueEmail({
      recipient: testRecipient,
      subject: "Test Subject",
      bodyHtml: "<p>Hello Outbox</p>",
      bodyText: "Hello Outbox",
      metadata: { test: true }
    });

    createdOutboxIds.push(entry.id);

    expect(entry.id).toBeDefined();
    expect(entry.recipient).toBe(testRecipient);
    expect(entry.status).toBe("PENDING");
    expect(entry.attempts).toBe(0);
    expect(entry.maxAttempts).toBe(5);
    expect(entry.nextAttemptAt).toBeInstanceOf(Date);

    const fromDb = await prisma.emailOutbox.findUnique({ where: { id: entry.id } });
    expect(fromDb).not.toBeNull();
    expect(fromDb?.subject).toBe("Test Subject");
  });

  it("fetches pending emails that are ready for delivery", async () => {
    const pending = await fetchPendingEmails(50);
    expect(Array.isArray(pending)).toBe(true);
    const found = pending.find((p) => createdOutboxIds.includes(p.id));
    expect(found).toBeDefined();
  });

  it("marks email as processing, sent, and updates sentAt", async () => {
    const entry = await enqueueEmail({
      recipient: `sent-test-${Date.now()}@example.test`,
      subject: "Will Be Sent",
      bodyHtml: "<p>Sent</p>",
      bodyText: "Sent"
    });
    createdOutboxIds.push(entry.id);

    const processing = await markEmailProcessing(entry.id);
    expect(processing.status).toBe("PROCESSING");

    const sent = await markEmailSent(entry.id);
    expect(sent.status).toBe("SENT");
    expect(sent.sentAt).toBeInstanceOf(Date);
  });

  it("handles retryable failure with exponential backoff", async () => {
    const entry = await enqueueEmail({
      recipient: `fail-test-${Date.now()}@example.test`,
      subject: "Will Fail Once",
      bodyHtml: "<p>Fail</p>",
      bodyText: "Fail"
    });
    createdOutboxIds.push(entry.id);

    const failed = await markEmailFailed(entry.id, "Connection timeout to provider", 0, 5);
    expect(failed.status).toBe("PENDING");
    expect(failed.attempts).toBe(1);
    expect(failed.lastError).toContain("Connection timeout");
    expect(failed.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 5000);
  });

  it("marks an email as FAILED permanently when max attempts are reached", async () => {
    const entry = await enqueueEmail({
      recipient: `terminal-fail-${Date.now()}@example.test`,
      subject: "Will Exhaust Attempts",
      bodyHtml: "<p>Terminal</p>",
      bodyText: "Terminal"
    });
    createdOutboxIds.push(entry.id);

    const failedTerminal = await markEmailFailed(entry.id, "Recipient address rejected", 4, 5);
    expect(failedTerminal.status).toBe("FAILED");
    expect(failedTerminal.attempts).toBe(5);
    expect(failedTerminal.lastError).toContain("Recipient address rejected");
  });

  it("processes a batch through processEmailOutboxBatch using mocked sender", async () => {
    const entry = await enqueueEmail({
      recipient: `batch-test-${Date.now()}@example.test`,
      subject: "Batch Process Item",
      bodyHtml: "<p>Batch</p>",
      bodyText: "Batch"
    });
    createdOutboxIds.push(entry.id);

    const result = await processEmailOutboxBatch(10);
    expect(result.processed).toBeGreaterThanOrEqual(1);

    const updated = await prisma.emailOutbox.findUnique({ where: { id: entry.id } });
    expect(updated?.status).toBe("SENT");
    expect(updated?.sentAt).toBeInstanceOf(Date);
  });

  it("starts and stops the continuous EmailWorker without errors", async () => {
    const worker = new EmailWorker({ batchSize: 5, pollIntervalMs: 500 });
    expect(worker.isRunning()).toBe(false);

    worker.start();
    expect(worker.isRunning()).toBe(true);

    // Let it cycle once
    await new Promise((resolve) => setTimeout(resolve, 300));

    await worker.stop();
    expect(worker.isRunning()).toBe(false);
  });
});
