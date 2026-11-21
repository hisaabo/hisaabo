import { defineConfig } from "vitest/config";

// Kept apart from vite.config.ts so tests do not load the React/Tailwind
// plugins. The store's tested logic is pure TypeScript (no DOM needed).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text"],
    },
  },
});
