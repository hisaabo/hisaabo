import os from "node:os";
import { defineConfig } from "vitest/config";
import { resolveWorkerCount } from "./src/__tests__/helpers/worker-db-config.ts";

// Files run in parallel workers, each against its own clone of the test
// database (src/__tests__/helpers/global-setup.ts). Sized by free memory;
// API_TEST_WORKERS=1 runs everything serially against TEST_DATABASE_URL itself.
const maxWorkers = resolveWorkerCount({
  override: process.env.API_TEST_WORKERS,
  freeMb: os.freemem() / 1024 / 1024,
  cpus: os.availableParallelism(),
});

export default defineConfig({
  test: {
    globals: true,
    pool: "forks",
    maxWorkers,
    // Allow longer timeouts for tests that hit a real PostgreSQL database.
    testTimeout: 15000,
    hookTimeout: 15000,
    globalSetup: ["./src/__tests__/helpers/global-setup.ts"],
    // env-setup.ts must be first — it sets DATABASE_URL before any module
    // (including @hisaabo/db) is evaluated and opens its postgres.js connections.
    setupFiles: [
      "./src/__tests__/helpers/env-setup.ts",
      // After env-setup: global beforeEach(resetAllCaches).
      "./src/__tests__/helpers/cache-setup.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: ["src/__tests__/**", "src/**/*.test.ts"],
    },
  },
});
