/**
 * Items priced INCLUDING tax: the conversion to the tax-exclusive bill rate, the exact
 * inclusive line maths, and the form behaviour (derive, re-derive on a GST edit, hint).
 *
 * Every expected value is a hand-computed literal with the arithmetic beside it (paise in
 * brackets). Nothing is computed with the code under test. Rounding rule everywhere:
 * round HALF UP, ONCE, in integer paise.
 *
 *   split:  base = round(gross x 100 / (100 + t))      tax = gross - base      (so base + tax = gross)
 *   back:   gross = round(base x (100 + t) / 100)
 */
import { describe, it, expect } from "vitest";
import {
  applyLineEdit,
  billRateFromItemPrice,
  calcLineItem,
  exclusiveRateFromInclusive,
  inclusiveBreakdown,
  inclusiveFromExclusive,
  lineFieldsFromItemPrice,
  money,
  priceIsTaxInclusive,
  splitInclusive,
  type InclusiveLine,
} from "../index.js";

describe("splitInclusive: golden table (gross incl. tax, rate) -> [taxable, GST]", () => {
  // gross  rate  paise arithmetic                                   taxable  GST
  const table: Array<[string, string, string, string]> = [
    // the five GST slabs on a price that divides exactly
    ["105.00", "5", "10500 x 100 / 105 = 10000", "100.00"],
    ["112.00", "12", "11200 x 100 / 112 = 10000", "100.00"],
    ["118.00", "18", "11800 x 100 / 118 = 10000", "100.00"],
    ["128.00", "28", "12800 x 100 / 128 = 10000", "100.00"],
    ["140.00", "40", "14000 x 100 / 140 = 10000", "100.00"],
    // 0%: nothing to take out
    ["118.00", "0", "11800 x 100 / 100 = 11800", "118.00"],
    // prices that need paise rounding
    ["99.00", "18", "9900 x 100 / 118 = 8389.83 -> 8390", "83.90"],
    ["99.00", "5", "9900 x 100 / 105 = 9428.57 -> 9429", "94.29"],
    ["99.00", "12", "9900 x 100 / 112 = 8839.29 -> 8839", "88.39"],
    ["99.00", "28", "9900 x 100 / 128 = 7734.375 -> 7734", "77.34"],
    ["99.00", "40", "9900 x 100 / 140 = 7071.43 -> 7071", "70.71"],
    ["1.00", "5", "100 x 100 / 105 = 95.24 -> 95", "0.95"],
    ["1.00", "12", "100 x 100 / 112 = 89.29 -> 89", "0.89"],
    ["1.00", "18", "100 x 100 / 118 = 84.75 -> 85", "0.85"],
    ["1.00", "28", "100 x 100 / 128 = 78.125 -> 78", "0.78"],
    ["1.00", "40", "100 x 100 / 140 = 71.43 -> 71", "0.71"],
    ["0.01", "18", "1 x 100 / 118 = 0.85 -> 1", "0.01"],
    ["0.01", "5", "1 x 100 / 105 = 0.95 -> 1", "0.01"],
    ["99.99", "12", "9999 x 100 / 112 = 8927.68 -> 8928", "89.28"],
    // ₹1,00,000
    ["100000.00", "5", "10000000 x 100 / 105 = 9523809.52 -> 9523810", "95238.10"],
    ["100000.00", "12", "10000000 x 100 / 112 = 8928571.43 -> 8928571", "89285.71"],
    ["100000.00", "18", "10000000 x 100 / 118 = 8474576.27 -> 8474576", "84745.76"],
    ["100000.00", "28", "10000000 x 100 / 128 = 7812500 exactly", "78125.00"],
    ["100000.00", "40", "10000000 x 100 / 140 = 7142857.14 -> 7142857", "71428.57"],
    // a rate with decimals
    ["112.50", "12.5", "11250 x 100 / 112.5 = 10000", "100.00"],
  ];
  const gst: Record<string, string> = {
    "105.00@5": "5.00", "112.00@12": "12.00", "118.00@18": "18.00", "128.00@28": "28.00", "140.00@40": "40.00",
    "118.00@0": "0.00", "99.00@18": "15.10", "99.00@5": "4.71", "99.00@12": "10.61", "99.00@28": "21.66", "99.00@40": "28.29",
    "1.00@5": "0.05", "1.00@12": "0.11", "1.00@18": "0.15", "1.00@28": "0.22", "1.00@40": "0.29",
    "0.01@18": "0.00", "0.01@5": "0.00", "99.99@12": "10.71",
    "100000.00@5": "4761.90", "100000.00@12": "10714.29", "100000.00@18": "15254.24", "100000.00@28": "21875.00", "100000.00@40": "28571.43",
    "112.50@12.5": "12.50",
  };

  it.each(table)("%s incl. %s%% (%s) -> taxable %s", (gross, rate, _arithmetic, taxable) => {
    const out = splitInclusive(gross, rate);
    expect(out.base).toBe(taxable);
    // GST is what is left: taxable + GST is the inclusive price to the paisa
    expect(out.tax).toBe(gst[`${gross}@${rate}`]);
    expect(money.add(out.base, out.tax)).toBe(money.add(gross, "0"));
    expect(exclusiveRateFromInclusive(gross, rate)).toBe(taxable);
  });

  it("rejects what is not a plain amount or rate (no silent float fallback)", () => {
    expect(() => splitInclusive("abc", "18")).toThrow();
    expect(() => splitInclusive("118", "-1")).toThrow();
    expect(() => splitInclusive("1e3", "18")).toThrow();
  });
});

describe("inclusiveFromExclusive: golden", () => {
  it.each([
    // rate, GST, gross arithmetic, inclusive price
    ["100.00", "18", "10000 x 118 / 100 = 11800", "118.00"],
    ["100.00", "5", "10000 x 105 / 100 = 10500", "105.00"],
    ["100.00", "28", "10000 x 128 / 100 = 12800", "128.00"],
    ["83.90", "18", "8390 x 118 / 100 = 9900.2 -> 9900", "99.00"],
    ["0.85", "18", "85 x 118 / 100 = 100.3 -> 100", "1.00"],
    ["0.01", "18", "1 x 118 / 100 = 1.18 -> 1", "0.01"],
    ["84745.76", "18", "8474576 x 118 / 100 = 10000000.0 (9999999.68 -> 10000000)", "100000.00"],
    ["50.00", "12.5", "5000 x 112.5 / 100 = 5625", "56.25"],
    ["105.00", "0", "10500 x 100 / 100", "105.00"],
  ])("%s + %s%% GST (%s) = %s", (rate, tax, _arithmetic, gross) => {
    expect(inclusiveFromExclusive(rate, tax)).toBe(gross);
  });
});

describe("calcLineItem, tax-inclusive: exact, and the total is exactly qty x price", () => {
  const line = (unitPrice: string, quantity: string, taxPercent: string, discountPercent = "0") =>
    calcLineItem({ unitPrice, quantity, taxPercent, discountPercent, taxInclusive: true });

  it("₹118 incl. 18%: base 100.00, GST 18.00, total 118.00", () => {
    // 11800 x 100 / 118 = 10000 -> base 100.00, GST 11800 - 10000 = 1800
    expect(line("118.00", "1", "18")).toEqual({
      subtotal: "100.00", discountAmount: "0.00", afterDiscount: "100.00", taxAmount: "18.00", total: "118.00",
    });
  });

  it("₹99 incl. 18%: base 83.90, GST 15.10, total 99.00 (the rounding lands in the base, the total stays 99.00)", () => {
    // 9900 x 100 / 118 = 8389.83 -> 8390 (83.90); GST = 9900 - 8390 = 1510 (15.10); total = 9900
    expect(line("99.00", "1", "18")).toEqual({
      subtotal: "83.90", discountAmount: "0.00", afterDiscount: "83.90", taxAmount: "15.10", total: "99.00",
    });
  });

  it("3 x ₹99 incl. 18%: total 297.00 exactly (the old per-unit rounding gave 297.01)", () => {
    // gross = 3 x 9900 = 29700; base = 29700 x 100 / 118 = 25169.49 -> 25169 (251.69); GST = 29700 - 25169 = 4531
    // (old: per-unit base 83.90 x 3 = 251.70, GST 251.70 x 18% = 45.31, total 297.01: a paisa too much)
    expect(line("99.00", "3", "18")).toEqual({
      subtotal: "251.69", discountAmount: "0.00", afterDiscount: "251.69", taxAmount: "45.31", total: "297.00",
    });
  });

  it("fractional quantity: 2.5 x ₹99 incl. 18% = 247.50", () => {
    // gross = 9900 x 2.5 = 24750; base = 24750 x 100 / 118 = 20974.58 -> 20975 (209.75); GST = 24750 - 20975 = 3775
    expect(line("99.00", "2.5", "18")).toEqual({
      subtotal: "209.75", discountAmount: "0.00", afterDiscount: "209.75", taxAmount: "37.75", total: "247.50",
    });
  });

  it("0.333 x ₹99 incl. 18% = 32.97 (gross rounds first: 3296.7 -> 3297)", () => {
    // gross = 9900 x 0.333 = 3296.7 -> 3297; base = 3297 x 100 / 118 = 2794.07 -> 2794 (27.94); GST = 3297 - 2794 = 503
    expect(line("99.00", "0.333", "18")).toEqual({
      subtotal: "27.94", discountAmount: "0.00", afterDiscount: "27.94", taxAmount: "5.03", total: "32.97",
    });
  });

  it("line discount comes off the inclusive amount once: 3 x ₹99 incl. 18%, 10% off", () => {
    // gross 29700; discount 29700 x 10% = 2970; total = 26730
    // subtotal = 29700 -> 25169 (251.69); afterDiscount = 26730 x 100 / 118 = 22652.54 -> 22653 (226.53)
    // discountAmount = 251.69 - 226.53 = 25.16; GST = 26730 - 22653 = 4077
    expect(line("99.00", "3", "18", "10")).toEqual({
      subtotal: "251.69", discountAmount: "25.16", afterDiscount: "226.53", taxAmount: "40.77", total: "267.30",
    });
  });

  it("7 x ₹99 incl. 12%, 5% off", () => {
    // gross 69300; discount 69300 x 5% = 3465; total 65835
    // subtotal = 69300 x 100 / 112 = 61875 (618.75); afterDiscount = 65835 x 100 / 112 = 58781.25 -> 58781 (587.81)
    // discountAmount = 618.75 - 587.81 = 30.94; GST = 65835 - 58781 = 7054
    expect(line("99.00", "7", "12", "5")).toEqual({
      subtotal: "618.75", discountAmount: "30.94", afterDiscount: "587.81", taxAmount: "70.54", total: "658.35",
    });
  });

  it("13 x ₹99.99 incl. 12%, 2.5% off (decimal discount)", () => {
    // gross = 9999 x 13 = 129987; discount = 129987 x 2.5% = 3249.675 -> 3250; total = 126737
    // subtotal = 129987 x 100 / 112 = 116059.82 -> 116060 (1160.60); afterDiscount = 126737 x 100 / 112 = 113158.04 -> 113158 (1131.58)
    // discountAmount = 1160.60 - 1131.58 = 29.02; GST = 126737 - 113158 = 13579
    expect(line("99.99", "13", "12", "2.5")).toEqual({
      subtotal: "1160.60", discountAmount: "29.02", afterDiscount: "1131.58", taxAmount: "135.79", total: "1267.37",
    });
  });

  it("boundaries: ₹1,00,000, ₹1, ₹0.01 and the 40% slab", () => {
    // 10000000 x 100 / 118 = 8474576.27 -> 8474576; GST = 10000000 - 8474576 = 1525424
    expect(line("100000.00", "1", "18")).toMatchObject({ afterDiscount: "84745.76", taxAmount: "15254.24", total: "100000.00" });
    // 100 x 100 / 128 = 78.125 -> 78; GST 22
    expect(line("1.00", "1", "28")).toMatchObject({ afterDiscount: "0.78", taxAmount: "0.22", total: "1.00" });
    // 1 x 100 / 118 = 0.85 -> 1; GST 0
    expect(line("0.01", "1", "18")).toMatchObject({ afterDiscount: "0.01", taxAmount: "0.00", total: "0.01" });
    // 2 x 14000 = 28000; 28000 x 100 / 140 = 20000; GST 8000
    expect(line("140.00", "2", "40")).toMatchObject({ afterDiscount: "200.00", taxAmount: "80.00", total: "280.00" });
  });

  it("a 100% discount is a free line with no tax", () => {
    expect(line("118.00", "2", "18", "100")).toMatchObject({ afterDiscount: "0.00", taxAmount: "0.00", total: "0.00" });
  });
});

describe("the exclusive bill path from a derived rate (what the forms send)", () => {
  const bill = (rate: string, qty: string, tax: string) => calcLineItem({ unitPrice: rate, quantity: qty, taxPercent: tax, discountPercent: "0" });

  it("₹118 incl. 18% on a bill: rate 100.00 -> 100.00 + 18.00 = 118.00 (not the 139.24 of taxing it twice)", () => {
    expect(billRateFromItemPrice({ price: "118.00", inclusive: true, taxPercent: "18" }).rate).toBe("100.00");
    expect(bill("100.00", "1", "18")).toMatchObject({ afterDiscount: "100.00", taxAmount: "18.00", total: "118.00" });
    // what the unconverted price did: 118.00 + 21.24
    expect(bill("118.00", "1", "18")).toMatchObject({ taxAmount: "21.24", total: "139.24" });
  });

  it("₹99 incl. 18%: rate 83.90 -> 83.90 + 15.10 = 99.00 for one unit", () => {
    expect(billRateFromItemPrice({ price: "99.00", inclusive: true, taxPercent: "18" }).rate).toBe("83.90");
    expect(bill("83.90", "1", "18")).toMatchObject({ taxAmount: "15.10", total: "99.00" });
  });

  it("several units of a price that needs rounding can differ by a paisa or two: DOCUMENTED, bounded", () => {
    // 3 x 83.90 = 251.70; GST 251.70 x 18% = 45.306 -> 45.31; total 297.01 (297.00 inclusive)
    expect(bill("83.90", "3", "18")).toMatchObject({ afterDiscount: "251.70", taxAmount: "45.31", total: "297.01" });
    // 10 x 83.90 = 839.00; GST 151.02; total 990.02 (990.00 inclusive): two paise over
    expect(bill("83.90", "10", "18")).toMatchObject({ afterDiscount: "839.00", taxAmount: "151.02", total: "990.02" });
  });
});

describe("priceIsTaxInclusive: sale prices only", () => {
  it("purchase prices are tax-exclusive whatever the flag says", () => {
    expect(priceIsTaxInclusive({ taxInclusive: true }, "sale")).toBe(true);
    expect(priceIsTaxInclusive({ taxInclusive: true }, "purchase")).toBe(false);
    expect(priceIsTaxInclusive({ taxInclusive: false }, "sale")).toBe(false);
    expect(priceIsTaxInclusive({ taxInclusive: null }, "sale")).toBe(false);
  });
});

describe("billRateFromItemPrice", () => {
  it("passes tax-exclusive prices, empty prices and 0% lines through unchanged", () => {
    expect(billRateFromItemPrice({ price: "450.00", inclusive: false, taxPercent: "18" })).toEqual({ rate: "450.00", inclusivePrice: null, unitTax: null });
    expect(billRateFromItemPrice({ price: null, inclusive: true, taxPercent: "18" })).toEqual({ rate: "", inclusivePrice: null, unitTax: null });
    expect(billRateFromItemPrice({ price: "118.00", inclusive: true, taxPercent: "0" }).rate).toBe("118.00");
    expect(billRateFromItemPrice({ price: "not a price", inclusive: true, taxPercent: "18" }).rate).toBe("not a price");
  });

  it("converts at the LINE's rate and reports the GST inside", () => {
    expect(billRateFromItemPrice({ price: "118.00", inclusive: true, taxPercent: "18" })).toEqual({ rate: "100.00", inclusivePrice: "118.00", unitTax: "18.00" });
    // same shelf price, 12% line: 11800 x 100 / 112 = 10535.71 -> 10536 (105.36), GST 12.64
    expect(billRateFromItemPrice({ price: "118.00", inclusive: true, taxPercent: "12" })).toEqual({ rate: "105.36", inclusivePrice: "118.00", unitTax: "12.64" });
  });
});

describe("bill-line behaviour (web and mobile forms)", () => {
  const picked = (): InclusiveLine => ({
    taxPercent: "18",
    ...lineFieldsFromItemPrice({ price: "118.00", inclusive: true, taxPercent: "18" }),
  });

  it("picking an inclusive item starts the line at the exclusive rate, remembers the shelf price and shows the hint", () => {
    const li = picked();
    expect(li).toMatchObject({ unitPrice: "100.00", originalUnitPrice: "100.00", inclusivePrice: "118.00", itemPriceIncludesTax: true });
    expect(inclusiveBreakdown(li)).toEqual({ inclusive: "118.00", base: "100.00", tax: "18.00" });
  });

  it("an exclusive item has no derivation and no hint", () => {
    const li: InclusiveLine = { taxPercent: "18", ...lineFieldsFromItemPrice({ price: "100.00", inclusive: false, taxPercent: "18" }) };
    expect(li).toMatchObject({ unitPrice: "100.00", inclusivePrice: undefined, itemPriceIncludesTax: false });
    expect(inclusiveBreakdown(li)).toBeNull();
  });

  it("editing the GST % keeps the shelf price: the taxable rate follows, and it is not a price edit", () => {
    // ₹118 incl.; GST 18 -> 12: 11800 x 100 / 112 = 10535.71 -> 10536 -> rate 105.36 (105.36 + 12.64 = 118.00)
    const li = applyLineEdit(picked(), "taxPercent", "12");
    expect(li).toMatchObject({ taxPercent: "12", unitPrice: "105.36", originalUnitPrice: "105.36", inclusivePrice: "118.00" });
    expect(inclusiveBreakdown(li)).toEqual({ inclusive: "118.00", base: "105.36", tax: "12.64" });
    // and back to 18: 100.00 again
    expect(applyLineEdit(li, "taxPercent", "18")).toMatchObject({ unitPrice: "100.00", originalUnitPrice: "100.00" });
  });

  it("GST 0%: the rate is the whole price, and no hint is shown", () => {
    const li = applyLineEdit(picked(), "taxPercent", "0");
    expect(li.unitPrice).toBe("118.00");
    expect(inclusiveBreakdown(li)).toBeNull();
  });

  it("typing the rate states the exclusive rate: the derivation ends, later GST edits leave the rate alone", () => {
    const typed = applyLineEdit(picked(), "unitPrice", "110");
    expect(typed).toMatchObject({ unitPrice: "110", inclusivePrice: undefined, originalUnitPrice: "100.00" });
    expect(inclusiveBreakdown(typed)).toBeNull();
    expect(applyLineEdit(typed, "taxPercent", "12")).toMatchObject({ unitPrice: "110", taxPercent: "12" });
  });

  it("any other field is set as is", () => {
    expect(applyLineEdit(picked(), "quantity" as never, "3")).toMatchObject({ quantity: "3", unitPrice: "100.00" });
  });
});
