import { Prisma } from "@prisma/client";

/**
 * Errors that indicate a *transient* database problem rather than a bug in the
 * request. The most common one in this project is Prisma's P1001
 * ("Can't reach database server"), which happens whenever the Neon Postgres
 * compute instance is cold-starting after its idle auto-suspend window.
 */
// P100x = connection/pool failures, P1017 = engine closed the connection,
// P2024 = pool timeout, P2028 = transaction api error/timeout, P2034/P2037 = transaction-level failures caused by a
// dropped connection, P5000/P5001 = server-side database in transition.
const TRANSIENT_PRISMA_CODES = new Set(["P1001", "P1002", "P1008", "P1009", "P1017", "P2024", "P2028", "P2034", "P2037", "P5000", "P5001"]);
const TRANSIENT_MESSAGE_PATTERN =
  /can'?t reach database server|connection terminated|connection reset|connection refused|econnreset|etimedout|timed out fetching a new connection|socket hang up|server has closed the connection|transaction (api )?error|transaction already closed|unable to start a transaction/i;

export const isUniqueConstraintError = (error: unknown): boolean =>
  (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") ||
  (error instanceof Error && error.message.includes("Unique constraint"));

export const isTransientDatabaseError = (error: unknown): boolean => {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (TRANSIENT_PRISMA_CODES.has(error.code) || error.code.startsWith("P100") || TRANSIENT_MESSAGE_PATTERN.test(error.message)) {
      return true;
    }
  }
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  if (error instanceof Error) return TRANSIENT_MESSAGE_PATTERN.test(error.message);
  return false;
};

/**
 * Runs a database operation and retries it with exponential backoff when the
 * failure is transient (cold start, pool timeout, dropped socket). Non
 * transient errors are re-thrown immediately so real bugs still surface.
 *
 * Default budget (1s, 2s, 4s, 8s) is sized for a Neon cold start.
 */
export const withDbRetry = async <T>(operation: () => Promise<T>, retries = 4, baseDelayMs = 1000): Promise<T> => {
  let attempt = 0;
  for (;;) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= retries || !isTransientDatabaseError(error)) throw error;
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1)));
    }
  }
};