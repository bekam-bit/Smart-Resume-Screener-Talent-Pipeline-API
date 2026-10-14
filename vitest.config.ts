import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Integration suites run against a remote Neon database that cold-starts
    // after idle periods; running test files sequentially avoids connection
    // contention and transaction timeouts.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 90_000
  }
});