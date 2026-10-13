import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Integration suites run against a remote Neon database that cold-starts
    // after idle periods; the first query of a run can legitimately take ~10s.
    testTimeout: 30_000,
    hookTimeout: 60_000
  }
});