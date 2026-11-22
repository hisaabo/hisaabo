/**
 * The statutory GST periods (lib/gst-period.ts): the financial year is always April-March,
 * whatever the business's own accounting year.
 */
import { describe, it, expect } from "vitest";
import {
  gstFinancialYearStartYear,
  gstFinancialYearLabel,
  gstFilingPeriod,
  gstQuarterMonths,
  istMonthStart,
  gstMonthWindow,
  gstQuarterWindow,
  istYearMonth,
  gstReturnPeriodOf,
  formatIstDate,
} from "../lib/gst-period.js";

describe("GST financial year of a calendar month", () => {
  it.each([
    [2025, 3, 2024, "2024-25"], // March: last month of the previous FY
    [2025, 4, 2025, "2025-26"], // April: first month of the FY
    [2025, 12, 2025, "2025-26"],
    [2026, 1, 2025, "2025-26"], // January belongs to the FY that began the previous April
    [2026, 3, 2025, "2025-26"],
    [2026, 4, 2026, "2026-27"],
    [2099, 12, 2099, "2099-00"], // label keeps the last two digits of the end year
  ])("%i-%i -> FY starting %i, labelled %s", (year, month, startYear, label) => {
    expect(gstFinancialYearStartYear(year, month)).toBe(startYear);
    expect(gstFinancialYearLabel(year, month)).toBe(label);
  });
});

describe("GSTR-1 / 3B filing period", () => {
  it("is MMYYYY, zero-padded", () => {
    expect(gstFilingPeriod(2026, 1)).toBe("012026");
    expect(gstFilingPeriod(2025, 12)).toBe("122025");
  });
});

describe("GST quarters (CMP-08): Q1 = Apr-Jun, Q2 = Jul-Sep, Q3 = Oct-Dec, Q4 = Jan-Mar of the next year", () => {
  it.each([
    [2025, 1, { startYear: 2025, startMonth: 4, endYear: 2025, endMonth: 6 }],
    [2025, 2, { startYear: 2025, startMonth: 7, endYear: 2025, endMonth: 9 }],
    [2025, 3, { startYear: 2025, startMonth: 10, endYear: 2025, endMonth: 12 }],
    [2025, 4, { startYear: 2026, startMonth: 1, endYear: 2026, endMonth: 3 }],
    [2026, 1, { startYear: 2026, startMonth: 4, endYear: 2026, endMonth: 6 }],
  ])("FY %i Q%i", (fyStartYear, quarter, expected) => {
    expect(gstQuarterMonths(fyStartYear, quarter)).toEqual(expected);
  });

  it("rejects a quarter outside 1-4", () => {
    expect(() => gstQuarterMonths(2025, 0)).toThrow(RangeError);
    expect(() => gstQuarterMonths(2025, 5)).toThrow(RangeError);
  });
});


// ── IST calendar windows (half-open) ───────────────────────────────────────────

describe("windows are half-open and start at 00:00 IST (UTC+05:30)", () => {
  it("a month starts at 00:00 IST on day 1, i.e. 18:30 UTC the day before", () => {
    expect(istMonthStart(2026, 4).toISOString()).toBe("2026-03-31T18:30:00.000Z");
    expect(istMonthStart(2026, 1).toISOString()).toBe("2025-12-31T18:30:00.000Z");
  });

  it("month 13 rolls into January of the next year (so December's `before` is the next January's start)", () => {
    expect(istMonthStart(2025, 13).toISOString()).toBe("2025-12-31T18:30:00.000Z");
    expect(gstMonthWindow(2025, 12).before.toISOString()).toBe("2025-12-31T18:30:00.000Z");
  });

  it("consecutive months share a boundary: one month's `before` is the next month's `from`", () => {
    for (let month = 1; month <= 12; month++) {
      expect(gstMonthWindow(2026, month).before.getTime()).toBe(gstMonthWindow(2026, month + 1).from.getTime());
    }
  });

  it("March 2026: from 2026-02-28T18:30Z (1 Mar 00:00 IST), before 2026-03-31T18:30Z (1 Apr 00:00 IST)", () => {
    const w = gstMonthWindow(2026, 3);
    expect([w.from.toISOString(), w.before.toISOString()]).toEqual(["2026-02-28T18:30:00.000Z", "2026-03-31T18:30:00.000Z"]);
  });

  it("a GST quarter spans three months and ends where the next begins (Q4 of FY 2025-26 = Jan-Mar 2026)", () => {
    const q4 = gstQuarterWindow(2025, 4);
    expect([q4.from.toISOString(), q4.before.toISOString()]).toEqual(["2025-12-31T18:30:00.000Z", "2026-03-31T18:30:00.000Z"]);
    expect(gstQuarterWindow(2026, 1).from.getTime()).toBe(q4.before.getTime());
    expect(gstQuarterWindow(2025, 1).before.getTime()).toBe(gstQuarterWindow(2025, 2).from.getTime());
  });
});

describe("the IST month of an instant", () => {
  it.each([
    ["2026-03-31T18:29:59.999Z", 2026, 3, "2026-03", "31/03/2026"], // the last millisecond of March in IST
    ["2026-03-31T18:30:00.000Z", 2026, 4, "2026-04", "01/04/2026"], // 1 April 00:00:00.000 IST
    ["2025-12-31T18:30:00.000Z", 2026, 1, "2026-01", "01/01/2026"], // New Year's midnight in IST
    ["2025-12-31T18:29:59.999Z", 2025, 12, "2025-12", "31/12/2025"],
    ["2026-01-31T18:29:59.500Z", 2026, 1, "2026-01", "31/01/2026"],
  ])("%s -> %i-%i (%s, %s)", (iso, year, month, period, ddmmyyyy) => {
    const d = new Date(iso);
    expect(istYearMonth(d)).toEqual({ year, month });
    expect(gstReturnPeriodOf(d)).toBe(period);
    expect(formatIstDate(d)).toBe(ddmmyyyy);
  });
});
