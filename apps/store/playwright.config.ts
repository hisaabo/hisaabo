import { defineConfig, devices } from "@playwright/test";

// Browser tests for the storefront. The API is served from fixtures
// (e2e/mockStore.ts), so no backend or database is needed: only the Vite dev
// server, started here. Run with `pnpm --filter @hisaabo/store test:e2e`.
const PORT = Number(process.env.STORE_E2E_PORT ?? 5174);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 30_000,
  expect: { timeout: 7_000 },
  outputDir: "./e2e/.results",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    // Headless Chromium hides scrollbars by default, which would hide the very
    // layout shift (a scrollbar appearing or vanishing) these tests look for.
    launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
