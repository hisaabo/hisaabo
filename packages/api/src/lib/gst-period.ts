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
 *
 * TIME ZONE. A document's date is an instant (timestamptz), and which month it belongs to is
 * decided on the BUSINESS calendar, which Hisaabo fixes to India (IST, see
 * `BUSINESS_TIME_ZONE` in tds-sections.ts): the web app sends a date-only "1 April" as the
 * browser's local midnight, which is 31 March 18:30 UTC. Windows are therefore built from IST
 * midnights and are HALF-OPEN, [first instant of the month, first instant of the next month),
 * never "up to 23:59:59": nothing falls between two months and nothing is in both. IST is a
 * fixed UTC+05:30 (India has no daylight saving), so the offset is a constant and the result
 * does not depend on the time zone of the server.
 */

/** IST = UTC + 5h30m, all year. */
export const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** The instant of 00:00 IST on day 1 of calendar month `month` (1-12) of `year`; months past 12 roll into the next year. */
export function istMonthStart(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 1) - IST_OFFSET_MS);
}

/** Half-open window of one calendar month on the IST calendar: `from` inclusive, `before` exclusive. */
export function gstMonthWindow(year: number, month: number): { from: Date; before: Date } {
  return { from: istMonthStart(year, month), before: istMonthStart(year, month + 1) };
}

/** The calendar year and month (1-12) an instant falls in on the IST calendar. */
export function istYearMonth(instant: Date): { year: number; month: number } {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 };
}

/** The ITC / GSTR-2B return period ("2026-03") an instant belongs to, on the IST calendar. */
export function gstReturnPeriodOf(instant: Date): string {
  const { year, month } = istYearMonth(instant);
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** An instant as DD/MM/YYYY on the IST calendar, the date format of the IRP and the e-way bill. */
export function formatIstDate(instant: Date): string {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MS);
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${shifted.getUTCFullYear()}`;
}

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
 * Half-open IST window of GST quarter `quarter` (1-4) of the financial year starting in `fyStartYear`.
 */
export function gstQuarterWindow(fyStartYear: number, quarter: number): { from: Date; before: Date } {
  const q = gstQuarterMonths(fyStartYear, quarter);
  return { from: istMonthStart(q.startYear, q.startMonth), before: istMonthStart(q.endYear, q.endMonth + 1) };
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
