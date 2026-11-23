/**
 * business-day.ts — the mobile app's date ranges and picked dates on the BUSINESS calendar (IST).
 *
 * A document date is stored as an instant but means a calendar day, and which day an instant is on
 * depends on a time zone. The business calendar is IST on every surface (API, web, mobile, CLI), see
 * @hisaabo/shared business-time. Before this, the dashboard computed "This Month" in UTC and the
 * reports screen in the phone's own zone: for a document dated 1 Nov 03:00 IST (2026-10-31T21:30Z)
 * the first said October.
 *
 * Presets are half-open IST windows whose `toDate` is the last millisecond before the next period
 * (see `windowToQuery`); a picked day is written as 00:00 IST.
 */
import {
  resolveDatePreset,
  windowToQuery,
  businessDayStart,
  businessDateParts,
  addDaysYmd,
  businessToday,
  pickedDateToISO,
  pickedDateToEndISO,
  type DatePresetKey,
} from "@hisaabo/shared";

export type MobilePeriod = "month" | "quarter" | "fy" | "all";

const PRESET_OF: Record<Exclude<MobilePeriod, "all">, DatePresetKey> = {
  month: "this-month",
  quarter: "this-quarter",
  fy: "this-fy",
};

const pad2 = (n: number) => String(n).padStart(2, "0");

/** The calendar day a device-local picker Date stands for, "YYYY-MM-DD" (the day the user picked). */
export function pickerDay(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * The instant to store for a picked Date: 00:00 IST of the calendar day the user picked on the
 * device, whatever the device's zone. A Date picker returns the device's local day.
 */
export function pickerDateToISO(date: Date): string {
  return pickedDateToISO(pickerDay(date))!;
}

/** The Date a device-local picker should show for a stored instant: its IST calendar day (at noon, clear of DST edges). */
export function storedToPickerDate(stored: string | Date): Date {
  const { year, month, day } = businessDateParts(new Date(stored));
  return new Date(year, month - 1, day, 12, 0, 0);
}

/** `fromDate` / `toDate` for a named period; `{}` for all time. */
export function getPeriodDates(period: MobilePeriod, now: Date = new Date()): { fromDate?: string; toDate?: string } {
  if (period === "all") return {};
  return windowToQuery(resolveDatePreset(PRESET_OF[period], now));
}

/** `fromDate` / `toDate` for a custom range of two picked days (both inclusive). Either side may be absent. */
export function getCustomRangeDates(from: Date | null | undefined, to: Date | null | undefined): { fromDate?: string; toDate?: string } {
  return {
    ...(from ? { fromDate: pickerDateToISO(from) } : {}),
    ...(to ? { toDate: pickedDateToEndISO(pickerDay(to)) } : {}),
  };
}

/** The audit-log filter of the account screen: the last 7 days, or this month, to the end of today. */
export function getAccountTimeRange(filter: "week" | "month" | "all", now: Date = new Date()): { fromDate?: string; toDate?: string } {
  if (filter === "all") return {};
  if (filter === "month") return windowToQuery(resolveDatePreset("this-month", now));
  const today = businessToday(now);
  return windowToQuery({ from: businessDayStart(addDaysYmd(today, -7)), before: businessDayStart(addDaysYmd(today, 1)) });
}
