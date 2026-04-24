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

/**
 * User-visible fallback for an absent or malformed date. Every list row and
 * detail field routes through `formatDate` / `formatDateShort`, so an
 * uncaught invalid input used to leak the literal string "Invalid Date"
 * straight onto the screen (the JS engine's default output for a NaN Date).
 * The em-dash matches the fallback already used at several call sites
 * (e.g. `item.paymentDate ? formatDateShort(...) : "—"`) so the visible
 * output is consistent whether the caller guards or not.
 */
const INVALID_DATE_FALLBACK = "—";

// Month abbreviations for the manual Indian-locale fallback below.
const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * Coerce an incoming date value to a valid JS Date or return `null` if the
 * input is nullish, empty, or parses to `Invalid Date`. Dates reach
 * `formatDate` from three sources:
 *
 *   1. superjson-deserialised `Date` objects from the tRPC client
 *   2. raw ISO strings (nullable DB columns surface as `string | null`)
 *   3. user-supplied strings from form inputs
 *
 * Any of these can be undefined/null/empty at runtime even when TS thinks
 * otherwise, so the coercion must be defensive.
 */
function coerceDate(date: Date | string | null | undefined): Date | null {
  if (date === null || date === undefined) return null;
  if (typeof date === "string" && date.trim() === "") return null;
  const d = typeof date === "string" ? new Date(date) : date;
  if (!(d instanceof Date)) return null;
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/**
 * Format a date as "28 Mar 2026" (Indian locale) with a defensive fallback.
 *
 * WHY WE DON'T TRUST `Intl.DateTimeFormat` ALONE:
 * Hermes (the JS engine used by the release-mode Android app — see
 * `app.json` + default RN 0.83.4 config) has incomplete `en-IN` ICU data
 * on some devices. In production this surfaced as every invoice/payment
 * row showing the literal string "Invalid Date" even though the Date
 * object itself was valid — the engine returned "Invalid Date" from
 * `toLocaleDateString("en-IN", { day, month, year })` while happily
 * formatting the same Date under `"en-US"`.
 *
 * To stay robust across Hermes + JSC + Node/jsdom we:
 *   1. Validate the input (see `coerceDate`) and return the em-dash
 *      fallback for null / "" / NaN dates.
 *   2. Try `Intl` with `en-IN`; if the engine returns the failure string
 *      or throws, fall through.
 *   3. Hand-format "{day} {Mon} {year}" — this matches what merchants
 *      expect in India without depending on ICU locale data.
 */
export function formatDate(date: Date | string | null | undefined): string {
  const d = coerceDate(date);
  if (!d) return INVALID_DATE_FALLBACK;
  try {
    const out = d.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    // Hermes on Android has been observed to return the literal string
    // "Invalid Date" from toLocaleDateString for otherwise-valid Date
    // objects when en-IN + options are not supported by the bundled
    // ICU data. Detect that and fall through to the manual formatter.
    if (out && !out.toLowerCase().includes("invalid")) return out;
  } catch {
    // Intl threw — fall through to manual formatting.
  }
  return `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Compact date for list rows — "28 Mar" (no year). Same defensive
 * posture as `formatDate`; see that function's doc comment for the
 * rationale on avoiding a bare `Intl.DateTimeFormat` call.
 */
export function formatDateShort(date: Date | string | null | undefined): string {
  const d = coerceDate(date);
  if (!d) return INVALID_DATE_FALLBACK;
  try {
    const out = d.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
    });
    if (out && !out.toLowerCase().includes("invalid")) return out;
  } catch {
    // Intl threw — fall through to manual formatting.
  }
  return `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}`;
}
