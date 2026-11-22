/**
 * Money on the storefront.
 *
 * Amounts arrive as decimal strings ("1570.00") and are never run through
 * floating point: they are read into whole paise, summed as integers and
 * formatted from those. One rule for every screen: Indian digit grouping
 * (12,34,567), and paise only when there are some, so "₹1,570" but "₹640.50".
 */

const DECIMAL = /^(-)?(\d+)(?:\.(\d+))?$/;

/** Read a decimal string (or a number) as whole paise. Anything unreadable is 0. */
export function toPaise(value: string | number | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 100) : 0;
  const match = DECIMAL.exec(value.trim());
  if (!match) return 0;
  const [, sign, whole, fraction = ""] = match;
  const paise = Number(whole) * 100 + Number(`${fraction}00`.slice(0, 2));
  // Round half up on the third decimal, as the server does for display.
  const roundUp = fraction.length > 2 && Number(fraction[2]) >= 5 ? 1 : 0;
  return (sign ? -1 : 1) * (paise + roundUp);
}

/** "1234567" -> "12,34,567" (last three digits, then pairs). */
export function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${head},${digits.slice(-3)}`;
}

function groupWestern(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function currencySymbol(currency: string): string {
  return currency === "INR" ? "₹" : `${currency} `;
}

export function formatPaise(paise: number, currency = "INR"): string {
  const negative = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const rupees = String(Math.floor(abs / 100));
  const rest = abs % 100;
  const whole = currency === "INR" ? groupIndian(rupees) : groupWestern(rupees);
  const amount = rest === 0 ? whole : `${whole}.${String(rest).padStart(2, "0")}`;
  return `${negative ? "-" : ""}${currencySymbol(currency)}${amount}`;
}

/** Format a decimal string (or number) of rupees. */
export function formatMoney(value: string | number | null | undefined, currency = "INR"): string {
  return formatPaise(toPaise(value), currency);
}

/** Price of `quantity` units at a decimal-string unit price, in paise. */
export function linePaise(unitPrice: string, quantity: number): number {
  return toPaise(unitPrice) * quantity;
}

/** Sum of a cart's lines in paise. */
export function cartPaise(lines: ReadonlyArray<{ effectivePrice: string; quantity: number }>): number {
  return lines.reduce((sum, line) => sum + linePaise(line.effectivePrice, line.quantity), 0);
}
