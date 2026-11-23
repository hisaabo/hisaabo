/**
 * Old (floating-point) money helpers against the new (exact) ones, over large deterministic sweeps.
 *
 * 0.10.1 made `money.mul`, `money.percent` and string parsing exact: the product of integer paise and a decimal
 * factor is computed in BigInt and rounded half-up ONCE. The old versions did `Math.round(paise * parseFloat(f))`,
 * which is wrong at exact half-paisa ties whenever the float product lands just below .5 (85p x 0.7 = 59.5p is the
 * double 59.49999999999999, so the old result was 59p = 0.59 where half-up gives 60p = 0.60).
 *
 * This test inlines the OLD helpers and proves, over every grid below:
 *   1. wherever the exact product is NOT a tie, old == new (nothing changed for ordinary bills);
 *   2. wherever they differ, it IS an exact half-paisa tie, the old result is one paisa below, and the new one is the
 *      correct half-up (so the change is only ever "a tie now rounds up as written");
 *   3. the number of ties and of differences is pinned. The literals were computed ONCE with an independent
 *      implementation (Python, IEEE doubles, exact integers for the reference), not by this code.
 *
 * Tie classes: integer quantities and the standard GST rates / whole-percent discounts never differ at all; 1-dp,
 * 2-dp and 3-dp quantities, 1-dp discounts and amount strings with more than two decimals do, at ties only.
 */
import { describe, it, expect } from "vitest";
import { money } from "../money.js";

// ── The OLD helpers, verbatim from release/0.10.1 (packages/shared/src/money.ts) ────────────────────────────────
const SCALE = 100;
function oldToPaise(value: string | number): number {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return 0;
  return Math.round(num * SCALE);
}
function oldFromPaise(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  return `${sign}${Math.floor(abs / SCALE)}.${String(abs % SCALE).padStart(2, "0")}`;
}
const old = {
  mul(amount: string | number, factor: string | number): string {
    const a = oldToPaise(amount);
    const f = typeof factor === "string" ? parseFloat(factor) : factor;
    return oldFromPaise(Math.round(a * f));
  },
  percent(amount: string | number, pct: string | number): string {
    const a = oldToPaise(amount);
    const p = typeof pct === "string" ? parseFloat(pct) : pct;
    return oldFromPaise(Math.round((a * p) / 100));
  },
  add(a: string | number, b: string | number): string {
    return oldFromPaise(oldToPaise(a) + oldToPaise(b));
  },
};

// ── helpers (integers only) ─────────────────────────────────────────────────────────────────────────────────────
const paiseStr = (p: number) => `${Math.floor(p / 100)}.${String(p % 100).padStart(2, "0")}`;
/** `q` thousandths/hundredths/tenths as a decimal string: (7, 1) -> "0.7", (125, 3) -> "0.125", (30, 0) -> "30" */
const decStr = (q: number, scale: number) => (scale === 0 ? String(q) : `${Math.floor(q / 10 ** scale)}.${String(q % 10 ** scale).padStart(scale, "0")}`);
/** round half up of num / den, num >= 0 */
const halfUp = (num: number, den: number) => Math.floor((2 * num + den) / (2 * den));

interface Tally { total: number; ties: number; diffs: number }

/** amount (paise) x quantity (q / 10^scale) */
function sweepMul(amounts: number, qtyMax: number, qtyScale: number): Tally {
  const den = 10 ** qtyScale;
  const t: Tally = { total: 0, ties: 0, diffs: 0 };
  for (let a = 1; a <= amounts; a++) {
    const aStr = paiseStr(a);
    for (let q = 1; q <= qtyMax; q++) {
      const qStr = decStr(q, qtyScale);
      const num = a * q;
      const exact = halfUp(num, den);
      const tie = (2 * num) % (2 * den) === den;
      const n = money.mul(aStr, qStr);
      const o = old.mul(aStr, qStr);
      t.total++;
      if (tie) t.ties++;
      if (n !== paiseStr(exact)) throw new Error(`new mul(${aStr}, ${qStr}) = ${n}, exact half-up ${paiseStr(exact)}`);
      if (o !== n) {
        t.diffs++;
        if (!(tie && o === paiseStr(exact - 1))) throw new Error(`mul(${aStr}, ${qStr}): old ${o}, new ${n}, tie ${tie}`);
      }
    }
  }
  return t;
}

/** amount (paise) x percentage (p / 10^scale) / 100 */
function sweepPercent(amounts: number, pcts: number[], pctScale: number): Tally {
  const den = 100 * 10 ** pctScale;
  const t: Tally = { total: 0, ties: 0, diffs: 0 };
  for (let a = 1; a <= amounts; a++) {
    const aStr = paiseStr(a);
    for (const p of pcts) {
      const pStr = decStr(p, pctScale);
      const num = a * p;
      const exact = halfUp(num, den);
      const tie = (2 * num) % (2 * den) === den;
      const n = money.percent(aStr, pStr);
      const o = old.percent(aStr, pStr);
      t.total++;
      if (tie) t.ties++;
      if (n !== paiseStr(exact)) throw new Error(`new percent(${aStr}, ${pStr}) = ${n}, exact half-up ${paiseStr(exact)}`);
      if (o !== n) {
        t.diffs++;
        if (!(tie && o === paiseStr(exact - 1))) throw new Error(`percent(${aStr}, ${pStr}): old ${o}, new ${n}, tie ${tie}`);
      }
    }
  }
  return t;
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe("money.mul: old float vs new exact (amount 2 dp x quantity)", () => {
  it("integer quantities 1..100 x every amount 0.01..30.00: identical, no ties at all", () => {
    expect(sweepMul(3000, 100, 0)).toEqual({ total: 300000, ties: 0, diffs: 0 });
  });

  it("1-dp quantities 0.1..30.0 x amounts 0.01..25.00: 67,500 exact ties, the old code rounded 1,192 of them DOWN", () => {
    expect(sweepMul(2500, 300, 1)).toEqual({ total: 750000, ties: 67500, diffs: 1192 });
  });

  it("2-dp quantities 0.01..10.00 x amounts 0.01..10.00: 26,000 ties, 977 differ", () => {
    expect(sweepMul(1000, 1000, 2)).toEqual({ total: 1000000, ties: 26000, diffs: 977 });
  });

  it("3-dp quantities 0.001..1.000 x amounts 0.01..5.00 (e.g. 0.125 kg): 2,800 ties, 45 differ", () => {
    expect(sweepMul(500, 1000, 3)).toEqual({ total: 500000, ties: 2800, diffs: 45 });
  });

  it("the documented example: ₹0.85 x 0.7 is 0.60 (exact 59.5p half-up); it was 0.59", () => {
    expect(old.mul("0.85", "0.7")).toBe("0.59");
    expect(money.mul("0.85", "0.7")).toBe("0.60");
  });
});

describe("money.percent: old float vs new exact (amount 2 dp x percentage)", () => {
  // GST rates in hundredths of a percent: 0, 0.25, 0.5, 1, 1.5, 3, 5, 12, 18, 28, 40
  const GST_RATES = [0, 25, 50, 100, 150, 300, 500, 1200, 1800, 2800, 4000];

  it("standard GST rates x amounts 0.01..50.00: 513 exact ties, NO difference", () => {
    expect(sweepPercent(5000, GST_RATES, 2)).toEqual({ total: 55000, ties: 513, diffs: 0 });
  });

  it("whole-percent discounts 1..100 x amounts 0.01..30.00: 7,800 ties, NO difference", () => {
    expect(sweepPercent(3000, range(1, 100), 0)).toEqual({ total: 300000, ties: 7800, diffs: 0 });
  });

  it("1-dp discounts 0.1..30.0 x amounts 0.01..15.00: 2,355 ties, 26 differ (old rounded down)", () => {
    expect(sweepPercent(1500, range(1, 300), 1)).toEqual({ total: 450000, ties: 2355, diffs: 26 });
  });
});

describe("parsing an amount string with more than two decimals (never produced by validated input)", () => {
  it("0.000..99.999: 10,000 ties (third decimal exactly 5), the old float parse rounded 572 of them DOWN, none else", () => {
    let ties = 0;
    let diffs = 0;
    for (let t = 0; t < 100000; t++) {
      const s = `${Math.floor(t / 1000)}.${String(t % 1000).padStart(3, "0")}`;
      const exact = halfUp(t, 10);
      const tie = t % 10 === 5;
      const n = money.add(s, "0");
      const o = old.add(s, "0");
      if (tie) ties++;
      expect(n, s).toBe(paiseStr(exact));
      if (o !== n) {
        diffs++;
        expect(tie && o === paiseStr(exact - 1), `${s}: old ${o}, new ${n}`).toBe(true);
      }
    }
    expect({ ties, diffs }).toEqual({ ties: 10000, diffs: 572 });
  });

  it("2-dp amount strings up to 99,999,999.99 parse identically (the only shape the API accepts): 200,000 random-ish values", () => {
    // deterministic spread over the whole range, including the large values where doubles are coarsest
    let seed = 0x9e3779b9;
    const next = () => {
      seed = (Math.imul(seed ^ (seed >>> 15), 1 | seed) + 0x6d2b79f5) | 0;
      return (seed >>> 0) / 2 ** 32;
    };
    for (let i = 0; i < 200000; i++) {
      const paise = Math.floor(next() * 9_999_999_999); // up to 99,999,999.99
      const s = `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, "0")}`;
      expect(money.add(s, "0"), s).toBe(old.add(s, "0"));
      expect(money.add(s, "0"), s).toBe(s);
    }
  });
});
