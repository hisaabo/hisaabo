/**
 * Fixed-point decimal arithmetic for money.
 * Stores values as integers in the smallest unit (paise for INR).
 * All operations return string results with 2 decimal places.
 */

const SCALE = 100; // 2 decimal places

/** Parse a string/number to integer paise */
function toPaise(value: string | number): number {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return 0;
  return Math.round(num * SCALE);
}

/** Format paise back to a decimal string */
function fromPaise(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / SCALE);
  const paisePart = abs % SCALE;
  return `${sign}${rupees}.${String(paisePart).padStart(2, "0")}`;
}

export const money = {
  /** Add two money values */
  add(a: string | number, b: string | number): string {
    return fromPaise(toPaise(a) + toPaise(b));
  },

  /** Subtract b from a */
  sub(a: string | number, b: string | number): string {
    return fromPaise(toPaise(a) - toPaise(b));
  },

  /** Multiply a money value by a factor (e.g., quantity) */
  mul(amount: string | number, factor: string | number): string {
    const a = toPaise(amount);
    const f = typeof factor === "string" ? parseFloat(factor) : factor;
    return fromPaise(Math.round(a * f));
  },

  /** Calculate percentage of a value: amount * (percent / 100) */
  percent(amount: string | number, pct: string | number): string {
    const a = toPaise(amount);
    const p = typeof pct === "string" ? parseFloat(pct) : pct;
    return fromPaise(Math.round((a * p) / 100));
  },

  /** Sum an array of money values */
  sum(values: (string | number)[]): string {
    const total = values.reduce<number>((acc, v) => acc + toPaise(v), 0);
    return fromPaise(total);
  },

  /** Compare: returns -1, 0, or 1 */
  compare(a: string | number, b: string | number): number {
    const diff = toPaise(a) - toPaise(b);
    return diff < 0 ? -1 : diff > 0 ? 1 : 0;
  },

  /** Check if value is zero */
  isZero(value: string | number): boolean {
    return toPaise(value) === 0;
  },

  /** Check if value is positive */
  isPositive(value: string | number): boolean {
    return toPaise(value) > 0;
  },

  /** Max of 0 and value */
  max0(value: string | number): string {
    return fromPaise(Math.max(0, toPaise(value)));
  },

  /** Parse to number (for display only — not for further calculation) */
  toNumber(value: string | number): number {
    return toPaise(value) / SCALE;
  },
};
