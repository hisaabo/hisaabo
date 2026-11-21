import { defineConfig, devices } from "@playwright/test";
import { resolveWorkers } from "./harness/topology.cjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5173";
const API_URL = process.env.API_URL ?? "http://localhost:3000";
const DEV = process.env.E2E_DEV === "1";

// One worker per isolated stack (own database, API, web server and seeded owner):
// min(4, floor(available memory / 1500MB)) unless E2E_WORKERS says otherwise,
// 1 for the shared dev stack. Resolved once here and exported to the environment
// so the stack supervisor, the workers and global-setup (which all load this
// file or inherit its env) agree even if free memory changes meanwhile.
const WORKERS = resolveWorkers();
process.env.E2E_WORKERS = String(WORKERS);

export default defineConfig({
  testDir: ".",
  testMatch: ["routes/**/*.spec.ts", "flows/**/*.spec.ts"],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: WORKERS,
  reporter: process.env.CI ? "github" : "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  // Drops leftover per-worker databases and the generated auth state; the stack
  // supervisor does the same on SIGTERM/SIGINT, this covers it having been killed.
  globalTeardown: "./harness/teardown.ts",

  projects: [
    { name: "setup", testMatch: /global-setup\.ts/ },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // storageState and baseURL are per worker: see helpers/fixtures.ts
      },
      dependencies: ["setup"],
    },
  ],

  webServer: DEV ? devServers() : [prodStack()],
});

/**
 * Default: one production build of the web app + API (built by
 * harness/stack.mjs), run once per worker against that worker's own database.
 * The web app is served statically with the same /api proxy as the Vite dev
 * server, so tests exercise the bundle that ships.
 */
function prodStack() {
  return {
    command: "node harness/stack.mjs",
    url: `${BASE_URL}/__e2e_ready`,
    // Never adopt a stray `pnpm dev`: it would silently swap the production
    // build for a dev server. Use E2E_DEV=1 for that.
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe" as const,
    stderr: "pipe" as const,
    gracefulShutdown: { signal: "SIGTERM" as const, timeout: 5_000 },
    // E2E_RUNNER_PID: lets the stack clean up if this process dies without doing so.
    env: { E2E_WORKERS: String(WORKERS), BASE_URL, API_URL, E2E_RUNNER_PID: String(process.pid) },
  };
}

/** E2E_DEV=1: the original setup — dev servers (tsx watch + Vite), reused if already running. */
function devServers() {
  return [
    {
      command: "pnpm --filter @hisaabo/api dev",
      url: `${API_URL}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: "pipe" as const,
      stderr: "pipe" as const,
      env: { DISABLE_RATE_LIMIT: "1" },
    },
    {
      command: "pnpm --filter @hisaabo/web dev",
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: "pipe" as const,
      stderr: "pipe" as const,
    },
  ];
}
