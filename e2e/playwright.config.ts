import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5173";
const API_URL = process.env.API_URL ?? "http://localhost:3000";
const DEV = process.env.E2E_DEV === "1";

export default defineConfig({
  testDir: ".",
  testMatch: ["routes/**/*.spec.ts", "flows/**/*.spec.ts"],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    { name: "setup", testMatch: /global-setup\.ts/ },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/user.json",
      },
      dependencies: ["setup"],
    },
  ],

  webServer: DEV ? devServers() : [prodStack()],
});

/**
 * Default: one production build of the web app + API (built and started by
 * harness/stack.mjs). The web app is served statically with the same /api proxy
 * as the Vite dev server, so tests exercise the bundle that ships.
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
    env: {
      E2E_WEB_PORT: new URL(BASE_URL).port || "80",
      E2E_API_PORT: new URL(API_URL).port || "80",
    },
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
