/**
 * Global test setup for Hisaabo web app.
 *
 * Loaded before every test file via vitest's `setupFiles` config.
 * It extends Vitest's `expect` with:
 *   - @testing-library/jest-dom matchers (toBeInTheDocument, toHaveTextContent, …)
 *   - toHaveNoViolations from vitest-axe for WCAG 2.1 AA axe-core audits
 */
import "@testing-library/jest-dom";
import { expect } from "vitest";
import { toHaveNoViolations } from "vitest-axe";

// Register the vitest-axe custom matcher so expect(results).toHaveNoViolations()
// works in every test file that imports axe from "vitest-axe".
expect.extend({ toHaveNoViolations });
