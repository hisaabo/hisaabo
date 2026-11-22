/**
 * business-time.ts — dates and date ranges on the BUSINESS calendar, in one place.
 *
 * WHY: a document date (invoice, payment, expense...) is stored as an instant (timestamptz) but means
 * a CALENDAR DAY. Which day an instant belongs to depends on a time zone, and "This Month" is a
 * window of days, so every surface (API, web, mobile, CLI) must agree on the zone. The Indian
 * business tool fixes it to India: IST, UTC+05:30. Computing "This Month" in UTC sends
 * 2026-10-31T18:30Z (= 1 Nov 00:00 IST) as the end of October, so a document dated 1 Nov 03:00 IST
 * (2026-10-31T21:30Z) falls in October; computing it in the browser's own zone gives a different
 * answer for every viewer. Here boundaries are always IST midnights and windows are HALF-OPEN,
 * [from, before): nothing falls between two periods and nothing is in two.
 *
 * IST is a fixed UTC+05:30 (India has no daylight saving), so the offset is a constant and the
 * results do not depend on the TZ of the machine running the code.
 *
 * TODO(0.11.0): `businesses` has no time zone column, and every business is Indian today. When one is
 * added, pass it in here instead of the constant (and add the migration then, not before).
 */

/** The zone every business calendar is in until a per-business zone exists (0.11.0). */
export const BUSINESS_TIME_ZONE = "Asia/Kolkata";
/** IST = UTC + 5h30m, all year. */
export const BUSINESS_UTC_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A calendar date, "YYYY-MM-DD". */
export type Ymd = string;

export interface DateParts {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** The calendar date an instant falls on, on the business calendar. */
export function businessDateParts(instant: Date): DateParts {
  const s = new Date(instant.getTime() + BUSINESS_UTC_OFFSET_MS);
  return { year: s.getUTCFullYear(), month: s.getUTCMonth() + 1, day: s.getUTCDate() };
}

/** The calendar date of an instant as "YYYY-MM-DD" (what a date input shows). */
export function businessDateOf(instant: Date): Ymd {
  const { year, month, day } = businessDateParts(instant);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Today's date on the business calendar. */
export function businessToday(now: Date = new Date()): Ymd {
  return businessDateOf(now);
}

/** Parse a strict "YYYY-MM-DD" that is a real calendar date; null otherwise. */
export function parseYmd(value: string): DateParts | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** The instant of 00:00 on the business calendar of the given date. */
export function businessDayStart(date: Ymd | DateParts): Date {
  const p = typeof date === "string" ? parseYmd(date) : date;
  if (!p) throw new RangeError(`Not a calendar date: ${String(date)}`);
  return new Date(Date.UTC(p.year, p.month - 1, p.day) - BUSINESS_UTC_OFFSET_MS);
}

/** The calendar date `days` after (or before, negative) a date, "YYYY-MM-DD". */
export function addDaysYmd(date: Ymd, days: number): Ymd {
  const p = parseYmd(date);
  if (!p) throw new RangeError(`Not a calendar date: ${date}`);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day) + days * DAY_MS);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** The instant of 00:00 on day 1 of month `month` (1-12) of `year`; months past 12 (or below 1) roll over. */
export function businessMonthStart(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 1) - BUSINESS_UTC_OFFSET_MS);
}

/** The calendar year and month (1-12) an instant falls in on the business calendar. */
export function businessYearMonth(instant: Date): { year: number; month: number } {
  const { year, month } = businessDateParts(instant);
  return { year, month };
}

/** Milliseconds since 00:00 on the business calendar of the instant's day (the time of day in IST). */
export function businessTimeOfDayMs(instant: Date): number {
  return (((instant.getTime() + BUSINESS_UTC_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS;
}

/** The instant `timeOfDayMs` after 00:00 on the business calendar of `date`. */
export function businessInstant(date: Ymd | DateParts, timeOfDayMs = 0): Date {
  return new Date(businessDayStart(date).getTime() + timeOfDayMs);
}

/**
 * A calendar date `months` months later (or earlier, negative), with the day kept when the target
 * month has it and otherwise clamped to the month's last day: 31 Jan + 1 month is 28 Feb (29 in a
 * leap year), 30 Apr + 1 month is 30 May.
 */
export function addMonthsClampedYmd(date: DateParts, months: number): DateParts {
  const total = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = (((total % 12) + 12) % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { year, month, day: Math.min(date.day, lastDay) };
}

// ── Half-open windows ──────────────────────────────────────────────────────────

/** A half-open window of instants: `from` inclusive, `before` exclusive. */
export interface DateWindow {
  from: Date;
  before: Date;
}

/** One calendar month on the business calendar. */
export function businessMonthWindow(year: number, month: number): DateWindow {
  return { from: businessMonthStart(year, month), before: businessMonthStart(year, month + 1) };
}

/**
 * The window of the Indian financial year starting 1 April of `startYear` (2025 = FY 2025-26):
 * [00:00 1 Apr 2025, 00:00 1 Apr 2026).
 */
export function businessFinancialYearWindow(startYear: number): DateWindow {
  return { from: businessMonthStart(startYear, 4), before: businessMonthStart(startYear + 1, 4) };
}

/** The start year of the Indian financial year (April-March) a date falls in. */
export function businessFinancialYearStartYear(now: Date = new Date()): number {
  const { year, month } = businessYearMonth(now);
  return month >= 4 ? year : year - 1;
}

/** The named periods of the date pickers. */
export type DatePresetKey = "this-month" | "last-month" | "last-30" | "this-quarter" | "this-fy" | "last-fy";

/**
 * The window of a named period, as of `now`, on the business calendar.
 *   this-month    the whole calendar month containing today
 *   last-month    the whole previous calendar month
 *   last-30       the 30 days before today through the end of today (31 calendar days)
 *   this-quarter  the start of this calendar quarter through the end of today
 *   this-fy       1 April of the current Indian financial year through the end of today
 *   last-fy       the whole previous Indian financial year
 * "Through the end of today" is the start of tomorrow, a constant for the whole day: a range ending
 * at `now` changes every millisecond, which makes query keys unstable.
 */
export function resolveDatePreset(preset: DatePresetKey, now: Date = new Date()): DateWindow {
  const today = businessDateParts(now);
  const todayYmd = businessDateOf(now);
  const endOfToday = businessDayStart(addDaysYmd(todayYmd, 1));
  switch (preset) {
    case "this-month":
      return businessMonthWindow(today.year, today.month);
    case "last-month":
      return businessMonthWindow(today.year, today.month - 1);
    case "last-30":
      return { from: businessDayStart(addDaysYmd(todayYmd, -30)), before: endOfToday };
    case "this-quarter": {
      const firstMonthOfQuarter = Math.floor((today.month - 1) / 3) * 3 + 1;
      return { from: businessMonthStart(today.year, firstMonthOfQuarter), before: endOfToday };
    }
    case "this-fy":
      return { from: businessFinancialYearWindow(businessFinancialYearStartYear(now)).from, before: endOfToday };
    case "last-fy":
      return businessFinancialYearWindow(businessFinancialYearStartYear(now) - 1);
  }
}

/**
 * A range picked as two calendar days, both INCLUSIVE ("1 Nov" to "30 Nov" is all of November):
 * [00:00 of the first day, 00:00 of the day after the last). Either side may be empty (open).
 * An invalid date is treated as empty.
 */
export function resolveDayRange(fromDay?: Ymd | null, toDay?: Ymd | null): Partial<DateWindow> {
  const out: Partial<DateWindow> = {};
  if (fromDay && parseYmd(fromDay)) out.from = businessDayStart(fromDay);
  if (toDay && parseYmd(toDay)) out.before = businessDayStart(addDaysYmd(toDay, 1));
  return out;
}

/**
 * The query inputs the API takes (`fromDate`, `toDate`, ISO datetimes). `toDate` is INCLUSIVE there, so
 * it is the last millisecond before `before`; stored dates have millisecond precision, so
 * "<= toDate" and "< before" select the same documents.
 */
export function windowToQuery(w: Partial<DateWindow>): { fromDate?: string; toDate?: string } {
  return {
    ...(w.from ? { fromDate: w.from.toISOString() } : {}),
    ...(w.before ? { toDate: new Date(w.before.getTime() - 1).toISOString() } : {}),
  };
}

// ── Writing a picked date ──────────────────────────────────────────────────────

/**
 * A picked date as the instant to store. A date-only "YYYY-MM-DD" becomes 00:00 on the business
 * calendar, whatever the browser's or phone's zone (the stored instant then reads back as that
 * day on every surface). A full ISO datetime or a Date is an instant already and is kept as is.
 * Returns undefined for an empty or invalid value.
 */
export function pickedDateToISO(value: string | Date | null | undefined): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  if (parseYmd(value)) return businessDayStart(value).toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/**
 * The END of a picked date as an inclusive upper bound: the last millisecond of that day on the
 * business calendar. A full datetime is kept as is.
 */
export function pickedDateToEndISO(value: string | Date | null | undefined): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "string" && parseYmd(value)) {
    return new Date(businessDayStart(addDaysYmd(value, 1)).getTime() - 1).toISOString();
  }
  return pickedDateToISO(value);
}

// ── Reading a stored instant ───────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "01 Nov 2026": the business-calendar date of an instant. */
export function formatBusinessDate(instant: Date): string {
  const { year, month, day } = businessDateParts(instant);
  return `${pad2(day)} ${MONTHS[month - 1]} ${year}`;
}

/** "1 Nov": the business-calendar day and month, no year. */
export function formatBusinessDateShort(instant: Date): string {
  const { month, day } = businessDateParts(instant);
  return `${day} ${MONTHS[month - 1]}`;
}

/** "Nov 26": the business-calendar month and two-digit year. */
export function formatBusinessMonthYearShort(instant: Date): string {
  const { year, month } = businessDateParts(instant);
  return `${MONTHS[month - 1]} ${String(year).slice(-2)}`;
}

/** "DD/MM/YYYY": the format of the IRP and the e-way bill. */
export function formatBusinessDateSlashes(instant: Date): string {
  const { year, month, day } = businessDateParts(instant);
  return `${pad2(day)}/${pad2(month)}/${year}`;
}
