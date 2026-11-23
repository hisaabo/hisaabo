/**
 * The paisa miss on a tax-inclusive price, pinned over EVERY whole-rupee price ₹1 – ₹5000 at every GST slab.
 *
 * A bill line is tax-exclusive: rate = round(price x 100 / (100 + t)) in paise, and the bill takes
 * GST = round(rate x t / 100), so the line total is rate + GST. That is NOT always the shelf price, even for
 * one unit:  ₹10.00 incl. 18% -> 8.47 + 1.52 = 9.99,  ₹41 -> 34.75 + 6.26 = 41.01,  ₹2 -> 1.69 + 0.30 = 1.99.
 *
 * The expected COUNTS below are literals computed once with an independent tool (Python fractions, same
 * rounding rule), not by this code:
 *
 *   slab  prices that tie   short by 1 paisa   over by 1 paisa   share that misses
 *    5%       4762               0                 238              4.76%
 *   12%       5000               0                   0              0%        (the 12% slab never misses)
 *   18%       4239             340                 421             15.22%
 *   28%       4375               0                 625             12.50%
 *   40%       3571             715                 714             28.58%
 *
 * and the invoice round-off (inclusiveTieOut + autoRoundOff) brings EVERY one of them back to the shelf price.
 */
import { describe, it, expect } from "vitest";
import { autoRoundOff, calcLineItem, inclusiveTieOut, lineFieldsFromItemPrice, money, splitInclusive } from "../index.js";

const EXPECTED: Record<string, { tie: number; short: number; over: number }> = {
  "5": { tie: 4762, short: 0, over: 238 },
  "12": { tie: 5000, short: 0, over: 0 },
  "18": { tie: 4239, short: 340, over: 421 },
  "28": { tie: 4375, short: 0, over: 625 },
  "40": { tie: 3571, short: 715, over: 714 },
};

/** the bill's total for ONE unit at the derived rate, as paise */
function billedPaise(price: string, tax: string): number {
  const rate = splitInclusive(price, tax).base;
  const total = calcLineItem({ unitPrice: rate, quantity: "1", taxPercent: tax, discountPercent: "0" }).total;
  return Number(total.replace(".", "")); // "9.99" -> 999 without any float arithmetic
}

describe("whole-rupee prices ₹1–₹5000: how often one unit misses the shelf price", () => {
  for (const [tax, want] of Object.entries(EXPECTED)) {
    it(`${tax}%: ${want.tie} tie, ${want.short} short by a paisa, ${want.over} over by a paisa`, () => {
      const got = { tie: 0, short: 0, over: 0 };
      for (let rupees = 1; rupees <= 5000; rupees++) {
        const diff = billedPaise(`${rupees}.00`, tax) - rupees * 100;
        expect(Math.abs(diff), `₹${rupees} at ${tax}%`).toBeLessThanOrEqual(1); // never more than a paisa for one unit
        if (diff === 0) got.tie++;
        else if (diff < 0) got.short++;
        else got.over++;
      }
      expect(got).toEqual(want);
    });
  }

  it("the cases quoted in the docs", () => {
    expect(billedPaise("10.00", "18")).toBe(999); // 8.47 + 1.52
    expect(billedPaise("41.00", "18")).toBe(4101); // 34.75 + 6.26
    expect(billedPaise("2.00", "18")).toBe(199); // 1.69 + 0.30
    expect(billedPaise("19.00", "5")).toBe(1901); // 18.10 + 0.91 (5%: ₹19 is the first price that misses)
    expect(billedPaise("4.00", "28")).toBe(401); // 3.13 + 0.88
    expect(billedPaise("1.00", "40")).toBe(99); // 0.71 + 0.28
    expect(billedPaise("118.00", "18")).toBe(11800); // ties
  });
});

describe("the round-off brings every one of them back to the shelf price", () => {
  it("for each price and slab: tie-out = -(miss), and raw total + auto round-off = the shelf price exactly", () => {
    for (const tax of Object.keys(EXPECTED)) {
      for (let rupees = 1; rupees <= 5000; rupees++) {
        const price = `${rupees}.00`;
        const f = lineFieldsFromItemPrice({ price, inclusive: true, taxPercent: tax });
        const billed = calcLineItem({ unitPrice: f.unitPrice, quantity: "1", taxPercent: tax, discountPercent: "0" }).total;
        const tie = inclusiveTieOut([{ ...f, taxPercent: tax, quantity: "1", discountPercent: "0" }]);
        const off = autoRoundOff(billed, tie, false);
        expect(money.add(billed, off), `₹${rupees} at ${tax}%`).toBe(price);
        // and with "round down to a whole rupee" on, the shelf price is already a whole rupee: same result
        expect(autoRoundOff(billed, tie, true), `₹${rupees} at ${tax}% (round down)`).toBe(off);
      }
    }
  });

  it("the invoice from the docs: ₹10.00 incl. 18% x 1 = line 9.99, round-off +0.01, total 10.00", () => {
    const f = lineFieldsFromItemPrice({ price: "10.00", inclusive: true, taxPercent: "18" });
    const line = calcLineItem({ unitPrice: f.unitPrice, quantity: "1", taxPercent: "18", discountPercent: "0" });
    expect([f.unitPrice, line.taxAmount, line.total]).toEqual(["8.47", "1.52", "9.99"]);
    const off = autoRoundOff(line.total, inclusiveTieOut([{ ...f, taxPercent: "18", quantity: "1", discountPercent: "0" }]), true);
    expect(off).toBe("0.01");
    expect(money.add(line.total, off)).toBe("10.00");
  });

  it("small quantities too: qty 1-20 of every whole-rupee price below ₹300 at 18%, 28% and 40%: the tie-out is within +/- 1.00 and restores qty x price", () => {
    for (const tax of ["18", "28", "40"]) {
      for (let rupees = 1; rupees < 300; rupees++) {
        for (let qty = 1; qty <= 20; qty++) {
          const price = `${rupees}.00`;
          const f = lineFieldsFromItemPrice({ price, inclusive: true, taxPercent: tax });
          const input = { ...f, taxPercent: tax, quantity: String(qty), discountPercent: "0" };
          const billed = calcLineItem({ unitPrice: f.unitPrice, quantity: String(qty), taxPercent: tax, discountPercent: "0" }).total;
          const tie = inclusiveTieOut([input]);
          expect(Math.abs(Number(tie)), `${qty} x ₹${rupees} at ${tax}%`).toBeLessThan(1);
          expect(money.add(billed, autoRoundOff(billed, tie, false)), `${qty} x ₹${rupees} at ${tax}%`).toBe(`${rupees * qty}.00`);
        }
      }
    }
  });
});
