import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // Run tests sequentially to avoid DB contention when using a shared test DB.
    // If we ever switch to per-test transaction rollbacks this can be changed to pool mode.
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // Allow longer timeouts for tests that hit a real PostgreSQL database.
    testTimeout: 15000,
    hookTimeout: 15000,
    // env-setup.ts must be first — it sets DATABASE_URL before any module
    // (including @hisaabo/db) is evaluated and opens its postgres.js connections.
    setupFiles: ["./src/__tests__/helpers/env-setup.ts"],
  },
});
