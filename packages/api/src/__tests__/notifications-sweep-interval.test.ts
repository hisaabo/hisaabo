/**
 * Multi-tenant full-scan interval of the notification dispatcher (no database needed).
 */

import { describe, it, expect } from "vitest";
import { fullSweepMs } from "../lib/notifications/dispatcher.js";

describe("fullSweepMs (multi-tenant full-scan interval)", () => {
  it("defaults to 60 s", () => {
    expect(fullSweepMs({})).toBe(60_000);
  });

  it("is configurable through NOTIFICATIONS_FULL_SWEEP_SECONDS", () => {
    expect(fullSweepMs({ NOTIFICATIONS_FULL_SWEEP_SECONDS: "300" })).toBe(300_000);
  });

  it("ignores junk and values that would hammer every tenant database", () => {
    expect(fullSweepMs({ NOTIFICATIONS_FULL_SWEEP_SECONDS: "abc" })).toBe(60_000);
    expect(fullSweepMs({ NOTIFICATIONS_FULL_SWEEP_SECONDS: "" })).toBe(60_000);
    expect(fullSweepMs({ NOTIFICATIONS_FULL_SWEEP_SECONDS: "0" })).toBe(60_000);
    expect(fullSweepMs({ NOTIFICATIONS_FULL_SWEEP_SECONDS: "1" })).toBe(60_000);
    expect(fullSweepMs({ NOTIFICATIONS_FULL_SWEEP_SECONDS: "-30" })).toBe(60_000);
  });
});
