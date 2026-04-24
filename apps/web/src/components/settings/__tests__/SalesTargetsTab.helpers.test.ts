/**
 * SalesTargetsTab — pure helper unit tests.
 *
 * getDefaultPeriodDates computes sensible start/end boundaries for a
 * sales-target period (daily / weekly / monthly / quarterly / custom).
 * formatTargetValue renders a target row — currency for order_value, count
 * suffixes for order_count / item_quantity.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Stub trpc — importing the component module evaluates the trpc import even
// though the helpers themselves do not need it.
vi.mock("@/lib/trpc", () => ({ trpc: {} }));

import {
  getDefaultPeriodDates,
  formatTargetValue,
} from "../SalesTargetsTab";

// Pin "now" to Wed 2025-07-16 so weekly (Sun-Sat), monthly, quarterly are
// deterministic. Using local time because the helper uses Date() + local
// getters, not UTC.
const FIXED_NOW = new Date("2025-07-16T12:00:00");

describe("getDefaultPeriodDates", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: FIXED_NOW });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("daily: start === end === today (YYYY-MM-DD)", () => {
    const { start, end } = getDefaultPeriodDates("daily");
    expect(start).toBe("2025-07-16");
    expect(end).toBe(start);
  });

  it("weekly: range spans Sunday → Saturday containing today", () => {
    // 2025-07-16 is a Wednesday → Sunday = 2025-07-13, Saturday = 2025-07-19
    const { start, end } = getDefaultPeriodDates("weekly");
    expect(start).toBe("2025-07-13");
    expect(end).toBe("2025-07-19");
  });

  it("monthly: start is 1st of current month, end is last day of current month", () => {
    const { start, end } = getDefaultPeriodDates("monthly");
    expect(start).toBe("2025-07-01");
    expect(end).toBe("2025-07-31");
  });

  it("quarterly: start is 1st of quarter, end is last day of quarter", () => {
    // July falls in Q3 → Jul 1 to Sep 30
    const { start, end } = getDefaultPeriodDates("quarterly");
    expect(start).toBe("2025-07-01");
    expect(end).toBe("2025-09-30");
  });

  it("custom: falls through to default → today/today", () => {
    const { start, end } = getDefaultPeriodDates("custom");
    expect(start).toBe("2025-07-16");
    expect(end).toBe("2025-07-16");
  });

  it("weekly edge: on a Sunday, start === today and end === Saturday six days later", () => {
    // 2025-07-13 is a Sunday
    vi.setSystemTime(new Date("2025-07-13T12:00:00"));
    const { start, end } = getDefaultPeriodDates("weekly");
    expect(start).toBe("2025-07-13");
    expect(end).toBe("2025-07-19");
  });

  it("quarterly edge: Jan 1 → Q1 = Jan 1 to Mar 31", () => {
    vi.setSystemTime(new Date("2025-01-01T12:00:00"));
    const { start, end } = getDefaultPeriodDates("quarterly");
    expect(start).toBe("2025-01-01");
    expect(end).toBe("2025-03-31");
  });

  it("monthly edge: February handles non-leap-year last day", () => {
    vi.setSystemTime(new Date("2025-02-10T12:00:00"));
    const { end } = getDefaultPeriodDates("monthly");
    expect(end).toBe("2025-02-28");
  });

  it("monthly edge: February in a leap year ends on the 29th", () => {
    vi.setSystemTime(new Date("2024-02-10T12:00:00"));
    const { end } = getDefaultPeriodDates("monthly");
    expect(end).toBe("2024-02-29");
  });
});

// ── formatTargetValue ──────────────────────────────────────────────────────

function mkTarget(overrides: Partial<{ targetType: string; targetValue: string }>): any {
  return {
    id: "t-1",
    userId: "u-1",
    targetType: overrides.targetType ?? "order_count",
    targetValue: overrides.targetValue ?? "100",
    itemId: null,
    periodType: "monthly",
    periodStart: new Date(),
    periodEnd: new Date(),
    notes: null,
    createdAt: new Date(),
  };
}

describe("formatTargetValue", () => {
  it("order_count: shows the number with ' orders' suffix and en-IN grouping", () => {
    expect(formatTargetValue(mkTarget({ targetType: "order_count", targetValue: "100" }))).toBe("100 orders");
    expect(formatTargetValue(mkTarget({ targetType: "order_count", targetValue: "1500" }))).toBe("1,500 orders");
  });

  it("item_quantity: shows the number with ' units' suffix", () => {
    expect(formatTargetValue(mkTarget({ targetType: "item_quantity", targetValue: "42" }))).toBe("42 units");
  });

  it("order_value: routes through formatCurrency (₹ prefix, 2 decimals)", () => {
    const out = formatTargetValue(mkTarget({ targetType: "order_value", targetValue: "2500" }));
    // formatCurrency output includes the rupee symbol; we don't assert the
    // exact glyph (varies by ICU) — just the digits and decimal portion.
    expect(out).toMatch(/2,?500\.00|2500\.00/);
    expect(out).not.toContain(" orders");
    expect(out).not.toContain(" units");
  });
});
