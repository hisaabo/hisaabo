import dayjs from "dayjs";

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
const INVALID_DATE_FALLBACK = "—";

export function formatDate(date: string | Date | null | undefined): string {
  if (date === null || date === undefined || date === "") return INVALID_DATE_FALLBACK;
  const d = dayjs(date);
  if (!d.isValid()) return INVALID_DATE_FALLBACK;
  return d.format("DD MMM YYYY");
}

// Short day+month label (no year) — used in chart week labels and other
// compact list contexts where the year is implied by the surrounding filter.
// e.g. "3 Mar".
export function formatDateShort(date: string | Date | null | undefined): string {
  if (date === null || date === undefined || date === "") return INVALID_DATE_FALLBACK;
  const d = dayjs(date);
  if (!d.isValid()) return INVALID_DATE_FALLBACK;
  return d.format("D MMM");
}

// Short month+year label for monthly chart axes, e.g. "Mar 25".
// Kept separate from formatDate so callers don't need to inline `dayjs(...).format(...)`.
export function formatMonthYearShort(date: string | Date | null | undefined): string {
  if (date === null || date === undefined || date === "") return INVALID_DATE_FALLBACK;
  const d = dayjs(date);
  if (!d.isValid()) return INVALID_DATE_FALLBACK;
  return d.format("MMM YY");
}

export function formatDateInput(date: string | Date | null | undefined): string {
  if (date === null || date === undefined || date === "") return "";
  const d = dayjs(date);
  if (!d.isValid()) return "";
  return d.format("YYYY-MM-DD");
}

// Centralised "today in YYYY-MM-DD" — used as a form default for
// <input type="date"> and as the TODAY_ISO module constant. Goes through
// dayjs so tests can freeze time and so the format is single-sourced.
export function todayISODate(): string {
  return dayjs().format("YYYY-MM-DD");
}

// Convert a `YYYY-MM-DD` input value (or a Date) to a full ISO string suitable
// for tRPC mutation inputs guarded by `z.string().datetime()`. Returns undefined
// for absent / invalid input so callers can pass it straight to an optional field.
export function toISOString(date: string | Date | null | undefined): string | undefined {
  if (date === null || date === undefined || date === "") return undefined;
  const d = dayjs(date);
  if (!d.isValid()) return undefined;
  return d.toISOString();
}

// End-of-day variant for range filters: upper-bound "to" inputs should include
// the whole day, so we push to 23:59:59.999 before emitting ISO.
export function toISOStringEndOfDay(date: string | Date | null | undefined): string | undefined {
  if (date === null || date === undefined || date === "") return undefined;
  const d = dayjs(date);
  if (!d.isValid()) return undefined;
  return d.endOf("day").toISOString();
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
  const csv = [
    headers.join(","),
    ...rows.map((r) =>
      r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
    ),
  ].join("\n");

  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
