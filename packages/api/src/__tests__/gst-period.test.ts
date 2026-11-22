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
