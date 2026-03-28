/**
 * Tests for packages/shared/src/calc.ts
 *
 * WHY THIS FILE EXISTS:
 * calcLineItem and calcInvoiceTotals are the core financial calculation engine
 * used every time a user creates or edits an invoice. Mistakes here directly
 * result in incorrect customer billing, wrong GST filings, or stock ledger
 * errors. Each test case represents a real-world invoice scenario that a
 * contributor could encounter while running an Indian small business.
 *
 * GST NOTE: India's Goods and Services Tax requires tracking subtotal,
 * discount, tax-exclusive base, and final amount separately. The tests
 * mirror the actual invoice structure rather than simplified models.
 */

import { describe, it, expect } from "vitest";
import { calcLineItem, calcInvoiceTotals } from "../calc.js";
import type { LineItemInput } from "../calc.js";

// ─────────────────────────────────────────────────────────────────────────────
// calcLineItem — single invoice line item calculations
// ─────────────────────────────────────────────────────────────────────────────
describe("calcLineItem — calculates subtotal, discount, tax and total for a single invoice line", () => {

  it("calculates basic subtotal: quantity × unitPrice (no tax, no discount)", () => {
    // 5 units of rice @ ₹50 each — the simplest possible sale.
    const result = calcLineItem({
      quantity: "5",
      unitPrice: "50.00",
      taxPercent: "0",
      discountPercent: "0",
    });
    expect(result.subtotal).toBe("250.00");
    expect(result.discountAmount).toBe("0.00");
    expect(result.afterDiscount).toBe("250.00");
    expect(result.taxAmount).toBe("0.00");
    expect(result.total).toBe("250.00");
  });

  it("applies 18% GST to the subtotal when there is no discount", () => {
    // Selling software services: 1 unit @ ₹1000 + 18% GST.
    // Expected: subtotal=1000, tax=180, total=1180.
    const result = calcLineItem({
      quantity: "1",
      unitPrice: "1000.00",
      taxPercent: "18",
      discountPercent: "0",
    });
    expect(result.subtotal).toBe("1000.00");
    expect(result.taxAmount).toBe("180.00");
    expect(result.total).toBe("1180.00");
  });

  it("applies percentage discount before calculating tax (discount reduces taxable base)", () => {
    // This is the legally correct GST treatment: tax is applied after discount.
    // 10 kg cement @ ₹100, 10% discount, 28% GST.
    // subtotal = 1000, discount = 100, afterDiscount = 900, tax = 252, total = 1152.
    const result = calcLineItem({
      quantity: "10",
      unitPrice: "100.00",
      taxPercent: "28",
      discountPercent: "10",
    });
    expect(result.subtotal).toBe("1000.00");
    expect(result.discountAmount).toBe("100.00");
    expect(result.afterDiscount).toBe("900.00");
    expect(result.taxAmount).toBe("252.00");
    expect(result.total).toBe("1152.00");
  });

  it("handles tax-inclusive pricing — back-calculates base price from gross price", () => {
    // When a retailer sets MRP (Maximum Retail Price) which already includes GST,
    // the system must reverse-calculate the base price.
    // ₹118 MRP at 18% GST → base = 118 / 1.18 = 100, tax = 18, total = 118.
    const result = calcLineItem({
      quantity: "1",
      unitPrice: "118.00",
      taxPercent: "18",
      discountPercent: "0",
      taxInclusive: true,
    });
    // Base price should be ₹100 (rounded to 2dp)
    expect(result.subtotal).toBe("100.00");
    expect(result.taxAmount).toBe("18.00");
    // Total should equal the original inclusive price
    expect(result.total).toBe("118.00");
  });

  it("handles tax-inclusive pricing with a discount — discount applied to base (post-split) amount", () => {
    // ₹118 MRP (18% GST inclusive), 10% discount.
    // base = 100, discount = 10, afterDiscount = 90, tax = 16.20, total = 106.20
    const result = calcLineItem({
      quantity: "1",
      unitPrice: "118.00",
      taxPercent: "18",
      discountPercent: "10",
      taxInclusive: true,
    });
    expect(result.subtotal).toBe("100.00");
    expect(result.discountAmount).toBe("10.00");
    expect(result.afterDiscount).toBe("90.00");
    expect(result.taxAmount).toBe("16.20");
    expect(result.total).toBe("106.20");
  });

  it("handles 100% discount (zero total) — e.g. complimentary goods on an invoice", () => {
    // Sales teams sometimes add a free item to an invoice at 100% discount.
    const result = calcLineItem({
      quantity: "2",
      unitPrice: "500.00",
      taxPercent: "12",
      discountPercent: "100",
    });
    expect(result.discountAmount).toBe("1000.00");
    expect(result.afterDiscount).toBe("0.00");
    expect(result.taxAmount).toBe("0.00");
    expect(result.total).toBe("0.00");
  });

  it("handles zero quantity — all amounts are zero", () => {
    // Although the validator rejects quantity ≤ 0, the function itself is also
    // tested directly to ensure it doesn't produce NaN or undefined.
    const result = calcLineItem({
      quantity: "0",
      unitPrice: "200.00",
      taxPercent: "5",
      discountPercent: "0",
    });
    expect(result.subtotal).toBe("0.00");
    expect(result.total).toBe("0.00");
  });

  it("handles very small amounts at paise granularity (₹0.01 × 1, 0% tax)", () => {
    // Edge case: invoicing at minimum INR granularity.
    const result = calcLineItem({
      quantity: "1",
      unitPrice: "0.01",
      taxPercent: "0",
      discountPercent: "0",
    });
    expect(result.total).toBe("0.01");
  });

  it("handles large quantities with decimal prices (500.5 units × ₹12.75 = ₹6381.38)", () => {
    // Bulk commodity: 500.5 kg of wheat @ ₹12.75/kg.
    // 500.5 × 12.75 = 6381.375, rounds to 6381.38
    const result = calcLineItem({
      quantity: "500.5",
      unitPrice: "12.75",
      taxPercent: "0",
      discountPercent: "0",
    });
    expect(result.subtotal).toBe("6381.38");
  });

  it("handles 5% GST on an odd amount without floating-point error", () => {
    // 5% of ₹850 = ₹42.50 — tests that paise multiplication is exact.
    const result = calcLineItem({
      quantity: "1",
      unitPrice: "850.00",
      taxPercent: "5",
      discountPercent: "0",
    });
    expect(result.taxAmount).toBe("42.50");
    expect(result.total).toBe("892.50");
  });

  it("handles multiple quantity with decimal tax producing an odd paise result", () => {
    // 3 units @ ₹33.33, 18% GST.
    // subtotal = 99.99, tax = 17.998... rounds to 18.00, total = 117.99
    const result = calcLineItem({
      quantity: "3",
      unitPrice: "33.33",
      taxPercent: "18",
      discountPercent: "0",
    });
    expect(result.subtotal).toBe("99.99");
    // Tax = Math.round(9999 * 18 / 100) = Math.round(1799.82) = 1800 paise = 18.00
    expect(result.taxAmount).toBe("18.00");
    expect(result.total).toBe("117.99");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// calcInvoiceTotals — aggregate multiple line items with invoice-level adjustments
// ─────────────────────────────────────────────────────────────────────────────
describe("calcInvoiceTotals — aggregates line items with invoice-level discounts, charges, and round-off", () => {

  // Helper: a standard two-line invoice for Sharma Traders
  function sharmaInvoiceInput() {
    return {
      lineItems: [
        // Line 1: 10 kg wheat @ ₹50/kg, no tax, no discount
        { quantity: "10", unitPrice: "50.00", taxPercent: "0", discountPercent: "0" },
        // Line 2: 5 kg sugar @ ₹40/kg, 5% GST, no discount
        { quantity: "5", unitPrice: "40.00", taxPercent: "5", discountPercent: "0" },
      ],
    };
  }

  it("sums multiple line items correctly", () => {
    // Line 1: subtotal=500, tax=0, total=500
    // Line 2: subtotal=200, tax=10, total=210
    // Invoice subtotal (afterDiscount sum) = 700, taxTotal = 10, total = 710
    const result = calcInvoiceTotals(sharmaInvoiceInput());
    expect(result.subtotal).toBe("700.00");
    expect(result.taxTotal).toBe("10.00");
    expect(result.total).toBe("710.00");
  });

  it("applies an invoice-level discount as a fixed amount (type='amount')", () => {
    // Sharma Traders gets a ₹50 loyalty discount on the whole invoice.
    // subtotal=700, invoiceDiscount=50, tax=10, total = 700 - 50 + 10 = 660
    const result = calcInvoiceTotals({
      ...sharmaInvoiceInput(),
      invoiceDiscount: "50",
      invoiceDiscountType: "amount",
    });
    expect(result.invoiceDiscountAmount).toBe("50");
    expect(result.total).toBe("660.00");
  });

  it("applies an invoice-level discount as a percentage (type='percent')", () => {
    // 10% discount on the post-line-discount subtotal of ₹700 = ₹70 discount.
    // tax=10, total = 700 - 70 + 10 = 640
    const result = calcInvoiceTotals({
      ...sharmaInvoiceInput(),
      invoiceDiscount: "10",
      invoiceDiscountType: "percent",
    });
    expect(result.invoiceDiscountAmount).toBe("70.00");
    expect(result.total).toBe("640.00");
  });

  it("adds additional charges (e.g. delivery charges, packing fees)", () => {
    // ₹50 delivery fee added on top of the invoice total.
    // subtotal=700, tax=10, charges=50, total=760
    const result = calcInvoiceTotals({
      ...sharmaInvoiceInput(),
      charges: [{ amount: "50.00" }],
    });
    expect(result.chargesTotal).toBe("50.00");
    expect(result.total).toBe("760.00");
  });

  it("applies multiple named charges and sums them into chargesTotal", () => {
    // ₹30 delivery + ₹20 packing = ₹50 charges total.
    const result = calcInvoiceTotals({
      ...sharmaInvoiceInput(),
      charges: [{ amount: "30.00" }, { amount: "20.00" }],
    });
    expect(result.chargesTotal).toBe("50.00");
  });

  it("applies a positive round-off (adds to final total)", () => {
    // GST invoices sometimes include a small positive round-off to get a whole rupee total.
    const result = calcInvoiceTotals({
      ...sharmaInvoiceInput(),
      roundOff: "0.50",
    });
    expect(result.roundOff).toBe("0.50");
    expect(result.total).toBe("710.50");
  });

  it("applies a negative round-off (reduces final total)", () => {
    // A small deduction to round down to the nearest rupee.
    const result = calcInvoiceTotals({
      ...sharmaInvoiceInput(),
      roundOff: "-0.25",
    });
    expect(result.roundOff).toBe("-0.25");
    expect(result.total).toBe("709.75");
  });

  it("handles an empty line items array (all zeros)", () => {
    // An invoice with no line items should not throw — it's a valid intermediate state.
    const result = calcInvoiceTotals({ lineItems: [] });
    expect(result.subtotal).toBe("0.00");
    expect(result.taxTotal).toBe("0.00");
    expect(result.total).toBe("0.00");
  });

  it("defaults invoiceDiscountType to 'amount' when not provided", () => {
    // When the caller omits the type, the discount is treated as a fixed rupee amount.
    const result = calcInvoiceTotals({
      lineItems: [{ quantity: "1", unitPrice: "1000.00", taxPercent: "0", discountPercent: "0" }],
      invoiceDiscount: "100",
      // invoiceDiscountType intentionally omitted
    });
    expect(result.invoiceDiscountAmount).toBe("100");
    expect(result.total).toBe("900.00");
  });

  it("returns lineDiscountTotal as the sum of all line-level discount amounts", () => {
    // Both lines have a 10% discount — the aggregate discount should be visible on the invoice.
    const result = calcInvoiceTotals({
      lineItems: [
        { quantity: "10", unitPrice: "100.00", taxPercent: "0", discountPercent: "10" }, // disc=100
        { quantity: "5", unitPrice: "200.00", taxPercent: "0", discountPercent: "10" }, // disc=100
      ],
    });
    expect(result.lineDiscountTotal).toBe("200.00");
    // After line discounts: 900 + 900 = 1800 subtotal
    expect(result.subtotal).toBe("1800.00");
  });

  it("combines all adjustments correctly: discount + charges + roundOff + multiple lines", () => {
    // Full scenario: Mehta Electronics invoice
    // Line 1: 2 phones @ ₹15000, 12% GST, 5% discount
    //   subtotal=30000, disc=1500, afterDisc=28500, tax=3420, total=31920
    // Line 2: 1 charger @ ₹500, 12% GST, no discount
    //   subtotal=500, disc=0, afterDisc=500, tax=60, total=560
    // Invoice-level: ₹200 flat discount, ₹100 delivery charge, +₹0.80 roundoff
    // Combined subtotal (afterDisc) = 28500 + 500 = 29000
    // taxTotal = 3420 + 60 = 3480
    // invoiceDiscount = 200
    // chargesTotal = 100
    // roundOff = 0.80
    // total = 29000 + 3480 - 200 + 100 + 0.80 = 32380.80
    const result = calcInvoiceTotals({
      lineItems: [
        { quantity: "2", unitPrice: "15000.00", taxPercent: "12", discountPercent: "5" },
        { quantity: "1", unitPrice: "500.00", taxPercent: "12", discountPercent: "0" },
      ],
      invoiceDiscount: "200",
      invoiceDiscountType: "amount",
      charges: [{ amount: "100.00" }],
      roundOff: "0.80",
    });
    expect(result.subtotal).toBe("29000.00");
    expect(result.taxTotal).toBe("3480.00");
    expect(result.invoiceDiscountAmount).toBe("200");
    expect(result.chargesTotal).toBe("100.00");
    expect(result.total).toBe("32380.80");
  });
});
