import {
  csvRow,
  parseYmd,
  businessDayStart,
  businessDateOf,
  businessToday,
  pickedDateToISO,
  pickedDateToEndISO,
  formatBusinessDate,
  formatBusinessDateShort,
  formatBusinessMonthYearShort,
} from "@hisaabo/shared";

// Dynamic quantity formatting (no trailing zeros, up to 3 decimals) lives in
// @hisaabo/shared so web, mobile and the PDF layer format quantities
// identically. Re-exported here so call sites pull it from the same module as
// formatCurrency / formatDate.
export { formatQuantity } from "@hisaabo/shared";

export function formatCurrency(amount: string | number, currency = "INR"): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

// User-visible fallback for an absent or malformed date (see
// apps/mobile/src/lib/utils.ts for the fuller rationale). Web and mobile
// must agree so screenshots and E2E assertions stay in sync.
const INVALID_DATE_FALLBACK = "\u2014";

// A date is shown, picked and compared on the BUSINESS calendar (IST), never the browser's: the
// same stored instant must read as the same day for every viewer (see @hisaabo/shared business-time).
// A date-only "YYYY-MM-DD" string is that calendar day; anything else is an instant.
function toInstant(date: string | Date | null | undefined): Date | null {
  if (date === null || date === undefined || date === "") return null;
  if (typeof date === "string" && parseYmd(date)) return businessDayStart(date);
  const d = date instanceof Date ? date : new Date(date);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(date: string | Date | null | undefined): string {
  const d = toInstant(date);
  return d ? formatBusinessDate(d) : INVALID_DATE_FALLBACK;
}

// Short day+month label (no year) — used in chart week labels and other
// compact list contexts where the year is implied by the surrounding filter.
// e.g. "3 Mar".
export function formatDateShort(date: string | Date | null | undefined): string {
  const d = toInstant(date);
  return d ? formatBusinessDateShort(d) : INVALID_DATE_FALLBACK;
}

// Short month+year label for monthly chart axes, e.g. "Mar 25".
export function formatMonthYearShort(date: string | Date | null | undefined): string {
  const d = toInstant(date);
  return d ? formatBusinessMonthYearShort(d) : INVALID_DATE_FALLBACK;
}

export function formatDateInput(date: string | Date | null | undefined): string {
  const d = toInstant(date);
  return d ? businessDateOf(d) : "";
}

// Centralised "today in YYYY-MM-DD" on the business calendar — used as a form default for
// <input type="date"> and as the TODAY_ISO module constant.
export function todayISODate(): string {
  return businessToday();
}

// Convert a `YYYY-MM-DD` input value (or a Date) to a full ISO string suitable
// for tRPC mutation inputs guarded by `z.string().datetime()`. A picked day is stored as
// 00:00 on the business calendar (IST), whatever the browser's zone. Returns undefined for
// absent / invalid input so callers can pass it straight to an optional field.
export function toISOString(date: string | Date | null | undefined): string | undefined {
  return pickedDateToISO(date);
}

// End-of-day variant for range filters: upper-bound "to" inputs should include
// the whole day, so this is the last millisecond of that day on the business calendar.
export function toISOStringEndOfDay(date: string | Date | null | undefined): string | undefined {
  return pickedDateToEndISO(date);
}

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

export function getStatusColor(status: string): string {
  switch (status) {
    case "paid": return "text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950";
    case "sent": return "text-blue-700 bg-blue-50 dark:text-blue-400 dark:bg-blue-950";
    case "draft": return "text-text-secondary bg-surface-2";
    case "partial": return "text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-950";
    case "overdue": return "text-red-700 bg-red-50 dark:text-red-400 dark:bg-red-950";
    case "cancelled": return "text-text-tertiary bg-surface-2";
    default: return "text-text-secondary bg-surface-2";
  }
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function getDocumentTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    invoice: "Invoice",
    quotation: "Quotation",
    credit_note: "Credit Note",
    debit_note: "Debit Note",
    delivery_challan: "Delivery Challan",
    proforma: "Proforma Invoice",
    sales_return: "Sales Return",
    purchase_return: "Purchase Return",
  };
  return labels[type] || type;
}

export function getDocumentTypeColor(type: string): string {
  const colors: Record<string, string> = {
    invoice: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400",
    quotation: "bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-400",
    credit_note: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
    debit_note: "bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-400",
    delivery_challan: "bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-400",
    proforma: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400",
    sales_return: "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-400",
    purchase_return: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400",
  };
  return colors[type] || "bg-surface-2 text-text-secondary";
}

export function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const csv = [csvRow(headers), ...rows.map((r) => csvRow(r))].join("\n");

  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** True only for absolute http(s) URLs; guards user-supplied hrefs against javascript:/data: schemes. */
export function isHttpUrl(value: string | null | undefined): value is string {
  return !!value && /^https?:\/\//i.test(value.trim());
}
