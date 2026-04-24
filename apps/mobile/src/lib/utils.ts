import dayjs from "dayjs";

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
export function formatDate(date: Date | string | null | undefined): string {
  if (date === null || date === undefined || date === "") return INVALID_DATE_FALLBACK;
  const d = dayjs(date);
  if (!d.isValid()) return INVALID_DATE_FALLBACK;
  return d.format("D MMM YYYY");
}

export function formatDateShort(date: Date | string | null | undefined): string {
  if (date === null || date === undefined || date === "") return INVALID_DATE_FALLBACK;
  const d = dayjs(date);
  if (!d.isValid()) return INVALID_DATE_FALLBACK;
  return d.format("D MMM");
}

// Date + time label for list rows that need a timestamp (e.g. API-key expiry,
// audit events). Separate helper so the format token is single-sourced.
export function formatDateTime(date: Date | string | null | undefined): string {
  if (date === null || date === undefined || date === "") return INVALID_DATE_FALLBACK;
  const d = dayjs(date);
  if (!d.isValid()) return INVALID_DATE_FALLBACK;
  return d.format("D MMM YYYY, h:mm A");
}

// `YYYY-MM-DD` for form / API serialisation. Returns "" for absent or invalid
// inputs so an empty date picker stays empty.
export function formatDateInput(date: Date | string | null | undefined): string {
  if (date === null || date === undefined || date === "") return "";
  const d = dayjs(date);
  if (!d.isValid()) return "";
  return d.format("YYYY-MM-DD");
}

// "Today" in YYYY-MM-DD — mobile form defaults and the start date of recurring templates.
export function todayISODate(): string {
  return dayjs().format("YYYY-MM-DD");
}
