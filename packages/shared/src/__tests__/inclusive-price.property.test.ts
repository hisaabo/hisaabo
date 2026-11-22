/**
 * Property tests for the tax maths: random prices, GST rates, quantities and discounts,
 * checked against an INDEPENDENT exact reference (plain BigInt, written here, sharing no code
 * with the implementation) and against the invariants a tax invoice must keep.
 *
 * Seeded (mulberry32), so a failure reproduces: the failing case is in the assertion message.
 *
 * Rounding rule under test, everywhere: round HALF UP, ONCE, in integer paise.
 */
import { describe, it, expect } from "vitest";
import { calcLineItem, inclusiveFromExclusive, money, splitGstByLine, splitInclusive } from "../index.js";

// ── tiny seeded PRNG ─────────────────────────────────────────────────────────
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const pick = <T>(r: () => number, xs: readonly T[]) => xs[int(r, 0, xs.length - 1)]!;

// ── independent exact reference (BigInt, decimal strings parsed by hand) ─────
const ref = {
  /** "12.345" -> [12345n, 3] */
  dec(s: string): [bigint, number] {
    const [i, f = ""] = s.split(".");
    return [BigInt(i + f), f.length];
  },
  /** round half up of n / d, d > 0 */
  div(n: bigint, d: bigint): bigint {
    const q = (2n * n + d) / (2n * d);
    return (2n * n + d) % (2n * d) !== 0n && 2n * n + d < 0n ? q - 1n : q;
  },
  paise(s: string): bigint {
    const [n, sc] = ref.dec(s);
    return ref.div(n * 100n, 10n ** BigInt(sc));
  },
  fmt(p: bigint): string {
    const neg = p < 0n;
    const a = neg ? -p : p;
    return `${neg ? "-" : ""}${a / 100n}.${(a % 100n).toString().padStart(2, "0")}`;
  },
  /** qty x price, round half up once */
  mulQty(paise: bigint, qty: string): bigint {
    const [n, sc] = ref.dec(qty);
    return ref.div(paise * n, 10n ** BigInt(sc));
  },
  pct(paise: bigint, pct: string): bigint {
    const [n, sc] = ref.dec(pct);
    return ref.div(paise * n, 100n * 10n ** BigInt(sc));
  },
  /** taxable part of a tax-inclusive amount */
  base(gross: bigint, tax: string): bigint {
    const [n, sc] = ref.dec(tax);
    const hundred = 100n * 10n ** BigInt(sc);
    return ref.div(gross * hundred, hundred + n);
  },
};

const RATES = ["0", "5", "12", "18", "28", "40", "12.5", "2.5", "7.5", "0.25", "18"] as const;
const DISCOUNTS = ["0", "0", "0", "5", "10", "2.5", "12.5", "33.33", "50", "100"] as const;

function randomCase(r: () => number) {
  // prices skew small (₹0.01 .. ₹99) and large (up to ₹1,00,000); paise matter most
  const paise = r() < 0.5 ? int(r, 1, 9999) : int(r, 1, 10_000_000);
  const price = ref.fmt(BigInt(paise));
  const qty = r() < 0.5 ? String(int(r, 1, 200)) : `${int(r, 0, 99)}.${String(int(r, 1, 999)).padStart(3, "0")}`.replace(/^0\./, "0.");
  return { price, qty: Number(qty) > 0 ? qty : "1", tax: pick(r, RATES), disc: pick(r, DISCOUNTS) };
}

const N = 6000;

describe("tax-inclusive lines vs the exact reference", () => {
  it(`calcLineItem(taxInclusive) matches the reference on ${N} random lines, field by field`, () => {
    const r = rng(0x1ac10);
    for (let i = 0; i < N; i++) {
      const c = randomCase(r);
      const unit = ref.paise(c.price);
      const gross = ref.mulQty(unit, c.qty);
      const total = gross - ref.pct(gross, c.disc);
      const subtotal = ref.base(gross, c.tax);
      const after = ref.base(total, c.tax);
      const got = calcLineItem({ unitPrice: c.price, quantity: c.qty, taxPercent: c.tax, discountPercent: c.disc, taxInclusive: true });
      const label = JSON.stringify(c);
      expect(got.total, `total ${label}`).toBe(ref.fmt(total));
      expect(got.afterDiscount, `afterDiscount ${label}`).toBe(ref.fmt(after));
      expect(got.taxAmount, `taxAmount ${label}`).toBe(ref.fmt(total - after));
      expect(got.subtotal, `subtotal ${label}`).toBe(ref.fmt(subtotal));
      expect(got.discountAmount, `discountAmount ${label}`).toBe(ref.fmt(subtotal - after));
    }
  });

  it("with no discount the line total IS qty x inclusive price (round half up, once): the founder's rule", () => {
    const r = rng(0xbeef);
    for (let i = 0; i < N; i++) {
      const c = { ...randomCase(r), disc: "0" };
      const got = calcLineItem({ unitPrice: c.price, quantity: c.qty, taxPercent: c.tax, discountPercent: "0", taxInclusive: true });
      expect(got.total, JSON.stringify(c)).toBe(ref.fmt(ref.mulQty(ref.paise(c.price), c.qty)));
    }
  });

  it("taxable + GST = total to the paisa, GST is never negative, taxable never exceeds the total", () => {
    const r = rng(0xc0de);
    for (let i = 0; i < N; i++) {
      const c = randomCase(r);
      const got = calcLineItem({ unitPrice: c.price, quantity: c.qty, taxPercent: c.tax, discountPercent: c.disc, taxInclusive: true });
      const label = JSON.stringify(c);
      expect(money.add(got.afterDiscount, got.taxAmount), label).toBe(got.total);
      expect(money.compare(got.taxAmount, "0"), label).toBeGreaterThanOrEqual(0);
      expect(money.compare(got.afterDiscount, got.total), label).toBeLessThanOrEqual(0);
    }
  });
});

describe("tax-exclusive lines vs the exact reference (the path every bill takes)", () => {
  it(`calcLineItem matches the reference on ${N} random lines, field by field`, () => {
    const r = rng(0x5eed);
    for (let i = 0; i < N; i++) {
      const c = randomCase(r);
      const unit = ref.paise(c.price);
      const subtotal = ref.mulQty(unit, c.qty);
      const discount = ref.pct(subtotal, c.disc);
      const after = subtotal - discount;
      const tax = ref.pct(after, c.tax);
      const got = calcLineItem({ unitPrice: c.price, quantity: c.qty, taxPercent: c.tax, discountPercent: c.disc });
      const label = JSON.stringify(c);
      expect(got.subtotal, `subtotal ${label}`).toBe(ref.fmt(subtotal));
      expect(got.discountAmount, `discountAmount ${label}`).toBe(ref.fmt(discount));
      expect(got.afterDiscount, `afterDiscount ${label}`).toBe(ref.fmt(after));
      expect(got.taxAmount, `taxAmount ${label}`).toBe(ref.fmt(tax));
      expect(got.total, `total ${label}`).toBe(ref.fmt(after + tax));
    }
  });
});

describe("converting an inclusive price to a bill rate and back", () => {
  it("splitInclusive matches the reference, and base + GST is the price to the paisa", () => {
    const r = rng(0xa11);
    for (let i = 0; i < N; i++) {
      const c = randomCase(r);
      const out = splitInclusive(c.price, c.tax);
      const g = ref.paise(c.price);
      const label = JSON.stringify(c);
      expect(out.base, label).toBe(ref.fmt(ref.base(g, c.tax)));
      expect(money.add(out.base, out.tax), label).toBe(ref.fmt(g));
    }
  });

  it("price -> rate -> price returns the price to within one paisa (the rate is rounded to a paisa)", () => {
    const r = rng(0xf00d);
    for (let i = 0; i < N; i++) {
      const c = randomCase(r);
      const rate = splitInclusive(c.price, c.tax).base;
      const back = inclusiveFromExclusive(rate, c.tax);
      const diff = Number(ref.paise(back) - ref.paise(c.price));
      expect(Math.abs(diff), `${JSON.stringify(c)} rate ${rate} back ${back}`).toBeLessThanOrEqual(1);
    }
  });

  it("a bill made from the derived rate totals qty x inclusive price within the DOCUMENTED bound", () => {
    // rate = taxable value rounded to a paisa (error <= 0.5 paisa); the bill rounds rate x qty (+0.5) and the GST (+0.5):
    //   |total - qty x price| <= (0.5 + 0.5 x qty) x (1 + t/100) + 0.5   paise      (one unit is exact up to 1 paisa)
    const r = rng(0xb111);
    for (let i = 0; i < N; i++) {
      const c = randomCase(r);
      const rate = splitInclusive(c.price, c.tax).base;
      const bill = calcLineItem({ unitPrice: rate, quantity: c.qty, taxPercent: c.tax, discountPercent: "0" });
      const target = Number(ref.mulQty(ref.paise(c.price), c.qty)); // qty x price in paise, rounded once
      const diff = Math.abs(Number(ref.paise(bill.total)) - target);
      const bound = (0.5 + 0.5 * Number(c.qty)) * (1 + Number(c.tax) / 100) + 0.5 + 1; // +1: the target itself is rounded to a paisa
      expect(diff, `${JSON.stringify(c)} rate ${rate} bill ${bill.total}`).toBeLessThanOrEqual(bound);
    }
  });

  it("for ONE unit the bill is within a paisa of the shelf price: it does NOT always tie (inclusive-price.sweep.test.ts pins how often)", () => {
    const r = rng(0x0001);
    for (let i = 0; i < N; i++) {
      const c = { ...randomCase(r), qty: "1" };
      const rate = splitInclusive(c.price, c.tax).base;
      const bill = calcLineItem({ unitPrice: rate, quantity: "1", taxPercent: c.tax, discountPercent: "0" });
      const diff = Math.abs(Number(ref.paise(bill.total) - ref.paise(c.price)));
      expect(diff, `${JSON.stringify(c)} rate ${rate}`).toBeLessThanOrEqual(1);
    }
  });
});

describe("CGST + SGST = GST, line by line and in total", () => {
  it("every line's two halves add to its GST and differ by at most a paisa; the document total ties", () => {
    const r = rng(0x65e);
    for (let doc = 0; doc < 600; doc++) {
      const lines = Array.from({ length: int(r, 1, 8) }, () => {
        const c = randomCase(r);
        return calcLineItem({ unitPrice: c.price, quantity: c.qty, taxPercent: c.tax, discountPercent: c.disc, taxInclusive: r() < 0.5 });
      });
      for (const l of lines) {
        const [cgst, sgst] = money.splitHalf(l.taxAmount);
        expect(money.add(cgst, sgst), `line GST ${l.taxAmount}`).toBe(l.taxAmount);
        expect(Math.abs(Number(ref.paise(cgst) - ref.paise(sgst))), `halves of ${l.taxAmount}`).toBeLessThanOrEqual(1);
      }
      const split = splitGstByLine(lines.map((l) => l.taxAmount));
      expect(money.add(split.cgst, split.sgst), "document CGST + SGST").toBe(money.sum(lines.map((l) => l.taxAmount)));
    }
  });
});

describe("money.mul / money.percent are exact (no float rounding)", () => {
  it("ties that the old float product got wrong now round half up: ₹0.85 x 0.7 = ₹0.60", () => {
    // 85 paise x 0.7 = 59.5 exactly -> 60. The float product 85 x 0.7 is 59.49999999999999 -> 59.
    expect(money.mul("0.85", "0.7")).toBe("0.60");
    // 50 paise x 0.29 = 14.5 -> 15 (float: 14.499999999999998 -> 14)
    expect(money.mul("0.50", "0.29")).toBe("0.15");
    // 190 paise x 1.15 = 218.5 -> 219 (float: 218.49999999999997 -> 218)
    expect(money.mul("1.90", "1.15")).toBe("2.19");
  });

  it("matches the reference on random amounts and 3-decimal factors", () => {
    const r = rng(0x7777);
    for (let i = 0; i < N; i++) {
      const paise = int(r, 0, 99_999_999);
      const f = `${int(r, 0, 500)}.${String(int(r, 0, 999)).padStart(3, "0")}`;
      expect(money.mul(ref.fmt(BigInt(paise)), f), `${paise} x ${f}`).toBe(ref.fmt(ref.mulQty(BigInt(paise), f)));
    }
  });

  it("percent matches the reference on random amounts and rates", () => {
    const r = rng(0x8888);
    for (let i = 0; i < N; i++) {
      const paise = int(r, 0, 99_999_999);
      const p = pick(r, RATES);
      expect(money.percent(ref.fmt(BigInt(paise)), p), `${paise} x ${p}%`).toBe(ref.fmt(ref.pct(BigInt(paise), p)));
    }
  });
});
