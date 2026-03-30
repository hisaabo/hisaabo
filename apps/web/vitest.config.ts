import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
    // Exclude route files — they depend on TanStack Router's file-based
    // route generation which requires the full Vite plugin pipeline.
    exclude: ["**/node_modules/**", "**/routes/**"],
    // Prevent memory explosion: single fork reuses one worker for all test files
    // instead of spawning parallel jsdom environments.
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
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
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
