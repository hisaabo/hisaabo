import os from "node:os";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

/**
 * Test files are independent (no database, no ports, no files), so they run in
 * parallel forks, sized by what the machine has free: WEB_TEST_WORKERS=n sets it
 * explicitly (1 = serial); otherwise min(4, free memory / budget, cpus - 1).
 */
const MB_PER_WORKER = 1500;
const MAX_DEFAULT_WORKERS = 4;

function resolveMaxWorkers(): number {
  const override = process.env.WEB_TEST_WORKERS?.trim();
  if (override) {
    const n = Number.parseInt(override, 10);
    if (!Number.isFinite(n) || n < 1) {
      throw new Error(`WEB_TEST_WORKERS must be a positive integer, got "${override}"`);
    }
    return n;
  }
  const freeMb = os.freemem() / 1024 / 1024;
  return Math.max(
    1,
    Math.min(MAX_DEFAULT_WORKERS, Math.floor(freeMb / MB_PER_WORKER), os.availableParallelism() - 1),
  );
}

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
    // Exclude route files — they depend on TanStack Router's file-based
    // route generation which requires the full Vite plugin pipeline.
    exclude: ["**/node_modules/**", "**/routes/**"],
    // This used to be one fork (maxWorkers: 1) to prevent a memory explosion from
    // parallel jsdom environments. Workers are now capped by free memory instead
    // (~0.45 GB per jsdom fork measured; 4 forks peak ~1.9 GB), see resolveMaxWorkers.
    pool: "forks",
    maxWorkers: resolveMaxWorkers(),
    testTimeout: 10000,
    teardownTimeout: 5000,
  },
  resolve: {
    // Deduplicate React so every import resolves to exactly one instance.
    //
    // pnpm with node-linker=hoisted previously had:
    //   root/node_modules/react@18  (from apps/mobile)
    //   root/node_modules/react-dom@19  (from apps/web)
    //   apps/web/node_modules/react@19  (kept local due to conflict)
    //
    // After running `pnpm add react-dom@19` the conflict was resolved and both
    // react@19 and react-dom@19 now live at root/node_modules. The aliases
    // below guarantee Vite-processed test files also resolve to the same single
    // root copy, eliminating any duplicate-instance risk from caching or
    // symlinks.
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
