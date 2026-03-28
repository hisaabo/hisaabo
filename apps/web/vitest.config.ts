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
  },
  resolve: {
    // Deduplicate React so there is exactly one instance during tests.
    // In this pnpm monorepo, react 19 is hoisted to the root node_modules
    // as react-dom 19 (root) but react itself may be shadowed in apps/web.
    // We point all react* imports to the root node_modules to guarantee one
    // copy is used, eliminating "invalid hook call" / "null useRef" errors.
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "react": path.resolve(__dirname, "node_modules/react"),
      "react/jsx-runtime": path.resolve(
        __dirname,
        "node_modules/react/jsx-runtime"
      ),
      "react/jsx-dev-runtime": path.resolve(
        __dirname,
        "node_modules/react/jsx-dev-runtime"
      ),
    },
  },
});
