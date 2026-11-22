/**
 * Exact decimal helpers for money and tax: BigInt only, no floating point.
 *
 * A decimal string ("118.00", "0.285", "-12.5") is held as `{ int, scale }`
 * meaning int / 10^scale. Every operation that has to round does it ONCE, at the
 * end, half-up (toward +infinity on a tie, the same as `Math.round`, which is
 * what the rest of `money` has always done), so a result never depends on the
 * order the digits were produced in.
 */

export interface Decimal {
  int: bigint;
  scale: number;
}

const DECIMAL_RE = /^(-?)(\d+)(?:\.(\d+))?$/;

/** Parse a plain decimal string exactly; null for anything else (exponent, NaN, "", ...). */
export function parseDecimal(value: string | number): Decimal | null {
  const text = typeof value === "number" ? numberToPlainString(value) : value.trim();
  if (text === null) return null;
  const m = DECIMAL_RE.exec(text);
  if (!m) return null;
  const frac = m[3] ?? "";
  const int = BigInt(`${m[1]}${m[2]}${frac}`);
  return { int, scale: frac.length };
}

/** A JS number as a plain decimal string, or null when it has no short exact form (NaN, Infinity, exponent). */
function numberToPlainString(n: number): string | null {
  if (!Number.isFinite(n)) return null;
  const s = String(n);
  return /e/i.test(s) ? null : s;
}

const pow10Cache = new Map<number, bigint>();
export function pow10(n: number): bigint {
  let v = pow10Cache.get(n);
  if (v === undefined) {
    v = 10n ** BigInt(n);
    pow10Cache.set(n, v);
  }
  return v;
}

/** round-half-up(num / den) for den > 0: floor((2*num + den) / (2*den)). */
export function divRoundHalfUp(num: bigint, den: bigint): bigint {
  const twice = 2n * num + den;
  const d = 2n * den;
  let q = twice / d;
  if (twice % d !== 0n && twice < 0n) q -= 1n; // BigInt division truncates toward zero; we need floor
  return q;
}

/** An amount in paise (integer) from a decimal string, rounded half-up to the paisa. Null when not a plain decimal. */
export function toPaiseExact(value: string | number): bigint | null {
  const d = parseDecimal(value);
  if (!d) return null;
  return divRoundHalfUp(d.int * 100n, pow10(d.scale));
}

/** Integer paise as a 2dp string ("12345" -> "123.45", "-5" -> "-0.05"). */
export function formatPaise(paise: bigint): string {
  const neg = paise < 0n;
  const abs = neg ? -paise : paise;
  const rupees = abs / 100n;
  const rest = abs % 100n;
  return `${neg ? "-" : ""}${rupees}.${rest.toString().padStart(2, "0")}`;
}
