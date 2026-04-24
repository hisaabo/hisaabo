/**
 * AccountTab — pure helper unit tests.
 *
 * timeAgo renders "Active now / 5m ago / 3h ago / 2d ago / <fallback date>"
 * from a Date, ISO string, or null. Used across sessions, activity, and API
 * key rows on the Account tab.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/trpc", () => ({ trpc: {} }));

import { timeAgo } from "../AccountTab";

const FIXED_NOW_MS = Date.parse("2025-07-16T10:00:00.000Z");

describe("timeAgo", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: FIXED_NOW_MS });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'Unknown' when date is null", () => {
    expect(timeAgo(null)).toBe("Unknown");
  });

  it("returns 'Active now' when the diff is under one minute", () => {
    const tenSecondsAgo = new Date(FIXED_NOW_MS - 10_000);
    expect(timeAgo(tenSecondsAgo)).toBe("Active now");
  });

  it("returns minutes-ago for diffs under an hour", () => {
    const fiveMinutesAgo = new Date(FIXED_NOW_MS - 5 * 60_000);
    expect(timeAgo(fiveMinutesAgo)).toBe("5m ago");
  });

  it("returns hours-ago for diffs under a day", () => {
    const threeHoursAgo = new Date(FIXED_NOW_MS - 3 * 60 * 60_000);
    expect(timeAgo(threeHoursAgo)).toBe("3h ago");
  });

  it("returns days-ago for diffs under 30 days", () => {
    const fiveDaysAgo = new Date(FIXED_NOW_MS - 5 * 24 * 60 * 60_000);
    expect(timeAgo(fiveDaysAgo)).toBe("5d ago");
  });

  it("falls back to a localized en-IN date string for diffs of 30+ days", () => {
    const sixtyDaysAgo = new Date(FIXED_NOW_MS - 60 * 24 * 60 * 60_000);
    const out = timeAgo(sixtyDaysAgo);
    // Should no longer be the "Xd ago" shape — should be a formatted date
    expect(out).not.toMatch(/\d+d ago/);
    expect(out).toMatch(/\d{4}/); // contains a year
  });

  it("accepts ISO strings and Date objects interchangeably", () => {
    const iso = new Date(FIXED_NOW_MS - 2 * 60 * 60_000).toISOString();
    const obj = new Date(FIXED_NOW_MS - 2 * 60 * 60_000);
    expect(timeAgo(iso)).toBe("2h ago");
    expect(timeAgo(obj)).toBe("2h ago");
  });

  it("boundary: exactly 60 minutes → '1h ago'", () => {
    const oneHourAgo = new Date(FIXED_NOW_MS - 60 * 60_000);
    expect(timeAgo(oneHourAgo)).toBe("1h ago");
  });

  it("boundary: exactly 24 hours → '1d ago'", () => {
    const oneDayAgo = new Date(FIXED_NOW_MS - 24 * 60 * 60_000);
    expect(timeAgo(oneDayAgo)).toBe("1d ago");
  });

  it("boundary: exactly 59 seconds → 'Active now' (minutes = 0)", () => {
    const justNow = new Date(FIXED_NOW_MS - 59_000);
    expect(timeAgo(justNow)).toBe("Active now");
  });
});
