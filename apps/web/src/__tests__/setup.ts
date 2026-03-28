/**
 * Global test setup for Hisaabo web app.
 *
 * Loaded before every test file via vitest's `setupFiles` config.
 * It extends Vitest's `expect` with:
 *   - @testing-library/jest-dom matchers (toBeInTheDocument, toHaveTextContent, …)
 *   - toHaveNoViolations from vitest-axe for WCAG 2.1 AA axe-core audits
 */
import "@testing-library/jest-dom";
import "vitest-axe/extend-expect";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Automatically clean up DOM after each test to prevent:
// 1. Memory leaks from accumulated DOM nodes across tests
// 2. Stale rendered content interfering with subsequent tests
afterEach(() => {
  cleanup();
});
