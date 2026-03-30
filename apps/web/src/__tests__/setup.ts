/**
 * Global test setup for Hisaabo web app.
 *
 * Loaded before every test file via vitest's `setupFiles` config.
 * It extends Vitest's `expect` with:
 *   - @testing-library/jest-dom matchers (toBeInTheDocument, toHaveTextContent, …)
 *   - toHaveNoViolations from vitest-axe for WCAG 2.1 AA axe-core audits
 *
 * NOTE on vitest-axe/extend-expect:
 *   The published vitest-axe@0.1.0 ships dist/extend-expect.js as an empty
 *   file (0 bytes) — the automatic registration is broken. We work around this
 *   by importing the matcher directly from dist/matchers.js and calling
 *   expect.extend() ourselves.  This is the official workaround documented in
 *   the vitest-axe README and in GitHub issue #6.
 *
 * NOTE on jsdom limitations:
 *   jsdom does not implement several browser APIs. We stub them here so
 *   component code that uses them during tests does not throw.
 */
import "@testing-library/jest-dom";
import { expect, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
// Register the axe-core matcher so `expect(results).toHaveNoViolations()` works.
// vitest-axe/extend-expect is empty in v0.1.0, so we import the value matcher directly.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const axeMatchers = require("vitest-axe/matchers");
expect.extend(axeMatchers);

// ── jsdom missing API stubs ────────────────────────────────────────────────────

// scrollIntoView: used by dropdown components (Combobox, Listbox) to keep the
// active/highlighted option visible while keyboard-navigating. jsdom does not
// implement layout, so it provides a no-op stub to prevent TypeError.
if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = function () {};
}

// Automatically clean up DOM after each test to prevent:
// 1. Memory leaks from accumulated DOM nodes across tests
// 2. Stale rendered content interfering with subsequent tests
afterEach(() => {
  cleanup();
});
