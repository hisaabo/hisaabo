import { defineConfig } from "vitest/config";

// Kept apart from vite.config.ts so tests do not load the React/Tailwind
// plugins. Most tested logic is pure TypeScript and runs in node; component
// tests opt into a DOM per file with `// @vitest-environment jsdom`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text"],
    },
  },
});
