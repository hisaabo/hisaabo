/**
 * gst-period.ts — the statutory GST return periods, in one place.
 *
 * The GST financial year is ALWAYS 1 April to 31 March, whatever financial year the business
 * keeps its own books on (`businesses.financialYearStart`, which only moves the accounting
 * reports: trial balance, P&L, balance sheet, dashboard). A business whose books start in
 * January or July still files GSTR-1 / 3B by calendar month, GSTR-9 for April to March, and
 * CMP-08 for the April-June, July-September, October-December and January-March quarters.
 *
 * Years here are the START year of the GST financial year: 2025 is FY 2025-26, April 2025
 * to March 2026.
 */

/** Start year of the GST financial year that calendar month `month` (1-12) of `year` falls in. */
export function gstFinancialYearStartYear(year: number, month: number): number {
  return month >= 4 ? year : year - 1;
}

/** The GST financial year label ("2025-26") of calendar month `month` (1-12) of `year`. */
export function gstFinancialYearLabel(year: number, month: number): string {
  const start = gstFinancialYearStartYear(year, month);
  return `${start}-${String(start + 1).slice(2)}`;
}

/** GSTR-1 / GSTR-3B filing period (`fp`) for a month: MMYYYY, e.g. "012026". */
export function gstFilingPeriod(year: number, month: number): string {
  return String(month).padStart(2, "0") + String(year);
}

/**
 * The months of GST quarter `quarter` (1-4) of the financial year starting in `fyStartYear`:
 * Q1 = April-June, Q2 = July-September, Q3 = October-December, Q4 = January-March of the
 * following calendar year. Returns the first month and the calendar year it falls in, and
 * the last month and its year.
 */
export function gstQuarterMonths(fyStartYear: number, quarter: number): {
  startYear: number; startMonth: number; endYear: number; endMonth: number;
} {
  if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) {
    throw new RangeError(`GST quarter must be 1-4, got ${quarter}`);
  }
  // Months counted from April of the start year: Q1 = 0-2, Q2 = 3-5, Q3 = 6-8, Q4 = 9-11.
  const first = (quarter - 1) * 3;
  const last = first + 2;
  const at = (offset: number) => {
    const month = ((3 + offset) % 12) + 1; // April = 4
    const year = fyStartYear + Math.floor((3 + offset) / 12);
    return { year, month };
  };
  const s = at(first);
  const e = at(last);
  return { startYear: s.year, startMonth: s.month, endYear: e.year, endMonth: e.month };
}
