import {
  parseYmd,
  businessDayStart,
  businessDateParts,
  businessDateOf,
  businessToday,
  BUSINESS_UTC_OFFSET_MS,
} from "@hisaabo/shared";

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Dynamic quantity formatting (no trailing zeros, up to 3 decimals) lives in
// @hisaabo/shared so web, mobile and the PDF layer format quantities
// identically. Re-exported here so call sites pull it from the same module as
// formatCurrency / formatDate. It uses Intl.NumberFormat("en-IN") — the same
// engine path as formatCurrency below — so it is Hermes-safe on Android.
export { formatQuantity } from "@hisaabo/shared";

export function formatCurrency(value: string | number): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "₹0";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(num);
}

// User-visible fallback for an absent or malformed date. Every list row and
// detail field routes through formatDate / formatDateShort, so an uncaught
// invalid input used to leak the literal string "Invalid Date" straight onto
// the screen (the JS engine's default output for a NaN Date). The em-dash
// matches the fallback already used at several call sites (e.g.
// `item.paymentDate ? formatDateShort(...) : "—"`) so the visible output is
// consistent whether the caller guards or not.
const INVALID_DATE_FALLBACK = "—";

// WHY DAYJS: `toLocaleDateString("en-IN", ...)` returns "Invalid Date" on
// Hermes (Android release builds) for otherwise-valid Date objects when the
// engine's ICU data does not include the locale. dayjs's `format` tokens do
// not depend on engine locale data, so the output is identical across
// Hermes, JSC, and Node/jsdom. If we later add Intl-based locales for other
// regions, dayjs's `localizedFormat` plugin supports that without changing
// call sites.
// Dates are read on the BUSINESS calendar (IST), never the phone's: a stored instant is one calendar
// day for every viewer (see @hisaabo/shared business-time). A date-only "YYYY-MM-DD" string is that day.
function toInstant(date: Date | string | null | undefined): Date | null {
  if (date === null || date === undefined || date === "") return null;
  if (typeof date === "string" && parseYmd(date)) return businessDayStart(date);
  const d = date instanceof Date ? date : new Date(date);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(date: Date | string | null | undefined): string {
  const d = toInstant(date);
  if (!d) return INVALID_DATE_FALLBACK;
  const { year, month, day } = businessDateParts(d);
  return `${day} ${MONTH_ABBR[month - 1]} ${year}`;
}

export function formatDateShort(date: Date | string | null | undefined): string {
  const d = toInstant(date);
  if (!d) return INVALID_DATE_FALLBACK;
  const { month, day } = businessDateParts(d);
  return `${day} ${MONTH_ABBR[month - 1]}`;
}

// Date + time label for list rows that need a timestamp (e.g. API-key expiry,
// audit events). Separate helper so the format token is single-sourced. The date and the time are
// both IST (the business calendar).
export function formatDateTime(date: Date | string | null | undefined): string {
  const d = toInstant(date);
  if (!d) return INVALID_DATE_FALLBACK;
  const { year, month, day } = businessDateParts(d);
  const istMinutes = Math.floor((d.getTime() + BUSINESS_UTC_OFFSET_MS) / 60000) % (24 * 60);
  const h24 = Math.floor(istMinutes / 60);
  const min = istMinutes % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${day} ${MONTH_ABBR[month - 1]} ${year}, ${h12}:${String(min).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

// `YYYY-MM-DD` for form / API serialisation. Returns "" for absent or invalid
// inputs so an empty date picker stays empty.
export function formatDateInput(date: Date | string | null | undefined): string {
  const d = toInstant(date);
  return d ? businessDateOf(d) : "";
}

// "Today" in YYYY-MM-DD on the business calendar — mobile form defaults and the start date of recurring templates.
export function todayISODate(): string {
  return businessToday();
}

/** True only for absolute http(s) URLs; guards user-supplied links against other schemes. */
export function isHttpUrl(value: string | null | undefined): value is string {
  return !!value && /^https?:\/\//i.test(value.trim());
}
