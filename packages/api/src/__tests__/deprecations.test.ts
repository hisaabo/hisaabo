/**
 * deprecations.test.ts — the password sign-in deprecation WARN is emitted
 * once per procedure per hour, counts suppressed calls, and carries no
 * request data. No database needed.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { logger } from "../lib/logger.js";
import {
  warnPasswordSignInDeprecated,
  resetDeprecationWarnings,
  DEPRECATION_LOG_INTERVAL_MS,
} from "../lib/deprecations.js";

beforeEach(() => {
  resetDeprecationWarnings();
  vi.restoreAllMocks();
});

describe("warnPasswordSignInDeprecated", () => {
  it("logs the deprecation message with the removal version", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    warnPasswordSignInDeprecated("auth.login", 1_000);
    expect(warn).toHaveBeenCalledTimes(1);
    const [fields, message] = warn.mock.calls[0] as unknown as [Record<string, unknown>, string];
    expect(message).toContain("password sign-in is deprecated and will be removed in 0.11.0");
    expect(fields).toMatchObject({ deprecated: true, procedure: "auth.login", removedIn: "0.11.0", callsSinceLastWarning: 1 });
    expect(fields).not.toHaveProperty("sec");
  });

  it("is rate-limited per procedure and reports suppressed calls on the next warning", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    warnPasswordSignInDeprecated("auth.login", 0);
    warnPasswordSignInDeprecated("auth.login", 10);
    warnPasswordSignInDeprecated("auth.login", 20);
    expect(warn).toHaveBeenCalledTimes(1);

    // A different procedure has its own budget.
    warnPasswordSignInDeprecated("auth.register", 30);
    expect(warn).toHaveBeenCalledTimes(2);

    warnPasswordSignInDeprecated("auth.login", DEPRECATION_LOG_INTERVAL_MS + 1);
    expect(warn).toHaveBeenCalledTimes(3);
    const [fields] = warn.mock.calls[2] as unknown as [Record<string, unknown>];
    expect(fields.callsSinceLastWarning).toBe(3);
  });
});
