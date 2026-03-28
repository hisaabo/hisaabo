/**
 * Tests for packages/shared/src/money.ts
 *
 * WHY THIS FILE EXISTS:
 * All monetary calculations in Hisaabo use fixed-point arithmetic (integers in paise)
 * instead of floating-point to avoid the classic JS precision bug where
 * 0.1 + 0.2 = 0.30000000000000004 instead of 0.30.
 * These tests verify that the money module is correct for every operation used
 * in invoice, payment, and reporting code. A single rounding error here would
 * propagate to every financial document the user generates.
 *
 * DESIGN: Tests use concrete INR amounts typical for Indian small businesses
 * (paise, rupees, lakhs, crores) so failures produce meaningful error messages.
 */

import { describe, it, expect } from "vitest";
import { money } from "../money.js";

// ─────────────────────────────────────────────────────────────────────────────
// money.add — addition of two money values
// ─────────────────────────────────────────────────────────────────────────────
describe("money.add — adds two money string/number values using paise arithmetic", () => {
  it("adds two positive rupee amounts correctly", () => {
    // Basic sanity: 100 + 200 = 300
    expect(money.add("100.00", "200.00")).toBe("300.00");
  });

  it("handles decimal precision without floating-point errors (0.1 + 0.2 = 0.30, not 0.30000000000000004)", () => {
    // This is THE critical test. Native JS: 0.1 + 0.2 = 0.30000000000000004.
    // Our fixed-point approach must return exactly "0.30".
    expect(money.add("0.1", "0.2")).toBe("0.30");
  });

  it("handles paise-level precision (0.01 + 0.01 = 0.02)", () => {
    // The smallest INR unit is 1 paise = ₹0.01. Ensure no rounding at this granularity.
    expect(money.add("0.01", "0.01")).toBe("0.02");
  });

  it("adds negative amounts (representing credit notes or refunds)", () => {
    // In Hisaabo a credit note may be represented as a negative value.
    // Adding a negative is effectively subtracting — must work correctly.
    expect(money.add("500.00", "-100.00")).toBe("400.00");
  });

  it("handles zero amounts on both sides", () => {
    expect(money.add("0", "250.75")).toBe("250.75");
    expect(money.add("250.75", "0")).toBe("250.75");
    expect(money.add("0", "0")).toBe("0.00");
  });

  it("handles lakh-scale amounts (₹1,00,000 + ₹50,000 = ₹1,50,000)", () => {
    // Many Indian SMB invoices are in the lakh range; verify no overflow.
    expect(money.add("100000.00", "50000.00")).toBe("150000.00");
  });

  it("handles crore-scale amounts without overflow", () => {
    // The DB column is NUMERIC(15,2) which supports up to ₹9,99,99,99,99,999.99.
    // Test that the JS layer doesn't lose precision at crore scale.
    expect(money.add("10000000.00", "5000000.00")).toBe("15000000.00");
  });

  it("accepts number arguments in addition to string arguments", () => {
    // The function signature accepts string | number. Both paths must work.
    expect(money.add(100, 200)).toBe("300.00");
    expect(money.add(100, "200.00")).toBe("300.00");
  });

  it("returns a string with exactly 2 decimal places in all cases", () => {
    // Callers display this value directly — it must always be formatted consistently.
    const result = money.add("1", "2");
    expect(result).toMatch(/^\d+\.\d{2}$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// money.sub — subtraction
// ─────────────────────────────────────────────────────────────────────────────
describe("money.sub — subtracts one money value from another", () => {
  it("subtracts a smaller amount from a larger one", () => {
    expect(money.sub("500.00", "200.00")).toBe("300.00");
  });

  it("handles paise-level subtraction (0.10 - 0.01 = 0.09)", () => {
    expect(money.sub("0.10", "0.01")).toBe("0.09");
  });

  it("returns a negative result when b > a (representing an overdraft or refund)", () => {
    // E.g. calculating balance remaining when over-allocated: sub("100", "150") = -50.
    const result = money.sub("100.00", "150.00");
    expect(result).toBe("-50.00");
  });

  it("returns 0.00 when the two values are equal", () => {
    expect(money.sub("750.00", "750.00")).toBe("0.00");
  });

  it("handles the classic floating-point trap (1.00 - 0.1 - 0.1 - 0.1 = 0.70)", () => {
    // Native JS would accumulate error here. Our paise approach must stay exact.
    const a = money.sub("1.00", "0.10");
    const b = money.sub(a, "0.10");
    const c = money.sub(b, "0.10");
    expect(c).toBe("0.70");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// money.mul — multiply by a quantity/factor
// ─────────────────────────────────────────────────────────────────────────────
describe("money.mul — multiplies a money value by a numeric factor (e.g. quantity)", () => {
  it("multiplies price × quantity for whole numbers", () => {
    // 10 units @ ₹25.00 = ₹250.00
    expect(money.mul("25.00", "10")).toBe("250.00");
  });

  it("multiplies with decimal quantity (e.g. 2.5 kg @ ₹40.00/kg = ₹100.00)", () => {
    expect(money.mul("40.00", "2.5")).toBe("100.00");
  });

  it("handles non-trivial decimal amounts without floating-point drift", () => {
    // 3 units @ ₹33.33 = ₹99.99 (not ₹99.990...001)
    expect(money.mul("33.33", "3")).toBe("99.99");
  });

  it("handles large quantities (500 units @ ₹12.75 = ₹6375.00)", () => {
    // Typical bulk-goods invoice line item.
    expect(money.mul("12.75", "500")).toBe("6375.00");
  });

  it("returns 0.00 when multiplying by zero quantity", () => {
    // A line item with quantity 0 should produce a zero total.
    expect(money.mul("999.99", "0")).toBe("0.00");
  });

  it("multiplies by decimal factor less than 1 (e.g. unit conversion: 0.5 dozen)", () => {
    // 0.5 dozen eggs @ ₹72/dozen = ₹36
    expect(money.mul("72.00", "0.5")).toBe("36.00");
  });

  it("accepts a number factor in addition to string", () => {
    expect(money.mul("100.00", 3)).toBe("300.00");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// money.percent — percentage of a value
// ─────────────────────────────────────────────────────────────────────────────
describe("money.percent — calculates amount × (percent / 100)", () => {
  it("calculates 18% GST on ₹1000 = ₹180", () => {
    // Standard GST rate for many goods and services.
    expect(money.percent("1000.00", "18")).toBe("180.00");
  });

  it("calculates 28% GST on ₹5000 = ₹1400", () => {
    // Highest GST slab used for luxury goods.
    expect(money.percent("5000.00", "28")).toBe("1400.00");
  });

  it("calculates 5% GST on ₹850 = ₹42.50", () => {
    // Result includes paise — must round correctly.
    expect(money.percent("850.00", "5")).toBe("42.50");
  });

  it("rounds correctly when the result is a repeating decimal", () => {
    // 1% of ₹33.33 = ₹0.3333... must round to ₹0.33
    expect(money.percent("33.33", "1")).toBe("0.33");
  });

  it("returns 0.00 for 0% tax", () => {
    expect(money.percent("5000.00", "0")).toBe("0.00");
  });

  it("returns the full amount for 100%", () => {
    expect(money.percent("999.00", "100")).toBe("999.00");
  });

  it("handles a fractional percent (0.5% surcharge)", () => {
    // Some states levy a 0.5% cess on top of GST.
    expect(money.percent("2000.00", "0.5")).toBe("10.00");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// money.sum — sum an array of values
// ─────────────────────────────────────────────────────────────────────────────
describe("money.sum — sums an array of money values", () => {
  it("sums a typical invoice line items array", () => {
    // Three line items: ₹200 + ₹350 + ₹150 = ₹700
    expect(money.sum(["200.00", "350.00", "150.00"])).toBe("700.00");
  });

  it("returns 0.00 for an empty array", () => {
    // Invoice with no line items should have ₹0 subtotal.
    expect(money.sum([])).toBe("0.00");
  });

  it("handles a single-element array", () => {
    expect(money.sum(["425.50"])).toBe("425.50");
  });

  it("accumulates without floating-point drift across many paise values", () => {
    // 10 identical amounts of ₹0.33 should sum to ₹3.30, not ₹3.3000...001
    const values = Array(10).fill("0.33");
    expect(money.sum(values)).toBe("3.30");
  });

  it("sums mixed positive and negative values (e.g. adjustments against base amounts)", () => {
    expect(money.sum(["1000.00", "-150.00", "50.00"])).toBe("900.00");
  });

  it("accepts number elements in the array", () => {
    expect(money.sum([100, 200, 300])).toBe("600.00");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// money.compare — comparison
// ─────────────────────────────────────────────────────────────────────────────
describe("money.compare — returns -1, 0, or 1 for comparison", () => {
  it("returns -1 when a < b", () => {
    expect(money.compare("100.00", "200.00")).toBe(-1);
  });

  it("returns 0 when a equals b", () => {
    expect(money.compare("500.00", "500.00")).toBe(0);
  });

  it("returns 1 when a > b", () => {
    expect(money.compare("750.00", "250.00")).toBe(1);
  });

  it("correctly compares amounts that differ only in paise", () => {
    // Floating-point would sometimes get this wrong.
    expect(money.compare("99.99", "100.00")).toBe(-1);
    expect(money.compare("100.01", "100.00")).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// money.isZero / isPositive — guard predicates
// ─────────────────────────────────────────────────────────────────────────────
describe("money.isZero and money.isPositive — boolean predicates", () => {
  it("isZero returns true for 0.00", () => {
    expect(money.isZero("0.00")).toBe(true);
    expect(money.isZero("0")).toBe(true);
  });

  it("isZero returns false for any positive amount", () => {
    expect(money.isZero("0.01")).toBe(false);
  });

  it("isZero returns false for negative amounts", () => {
    // A negative balance is not zero.
    expect(money.isZero("-0.01")).toBe(false);
  });

  it("isPositive returns true for amounts above zero", () => {
    expect(money.isPositive("1.00")).toBe(true);
    expect(money.isPositive("0.01")).toBe(true);
  });

  it("isPositive returns false for zero", () => {
    expect(money.isPositive("0.00")).toBe(false);
  });

  it("isPositive returns false for negative amounts", () => {
    expect(money.isPositive("-1.00")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// money.max0 — clamp to zero
// ─────────────────────────────────────────────────────────────────────────────
describe("money.max0 — returns max(0, value), clamping negatives to zero", () => {
  it("returns the value unchanged when positive", () => {
    expect(money.max0("500.00")).toBe("500.00");
  });

  it("returns 0.00 when the value is negative (e.g. over-reversed payment)", () => {
    // Used in payment deletion to avoid negative amountPaid on an invoice.
    expect(money.max0("-100.00")).toBe("0.00");
  });

  it("returns 0.00 for exactly zero", () => {
    expect(money.max0("0.00")).toBe("0.00");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// money.toNumber — convert to JS number for display only
// ─────────────────────────────────────────────────────────────────────────────
describe("money.toNumber — converts money string to JS number (display use only)", () => {
  it("converts a string money value to a number", () => {
    expect(money.toNumber("1234.56")).toBe(1234.56);
  });

  it("returns 0 for '0.00'", () => {
    expect(money.toNumber("0.00")).toBe(0);
  });

  it("handles negative values", () => {
    expect(money.toNumber("-99.99")).toBe(-99.99);
  });
});
