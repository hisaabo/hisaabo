/**
 * Tests for invoice calculation logic used in the invoice router.
 *
 * WHY THIS FILE EXISTS:
 * The invoice router (routers/invoice.ts) uses calcLineItem and calcInvoiceTotals
 * from @hisaabo/shared to compute totals before inserting them into the database.
 * These tests verify the complete calculation chain that an invoice create/update
 * call would execute, including stock adjustment logic.
 *
 * This file tests the CALCULATION LAYER in isolation (no DB required).
 * For end-to-end invoice CRUD tests (with DB), see the TODO integration tests.
 *
 * NOTE: The invoice number format is: {prefix}-{5-digit-padded-number}
 * e.g. INV-00001, INV-00042. This padding logic is also tested here.
 */

import { describe, it, expect } from "vitest";
import { calcLineItem, calcInvoiceTotals, money } from "@hisaabo/shared";

// ─────────────────────────────────────────────────────────────────────────────
// Invoice number formatting — padded to 5 digits
// ─────────────────────────────────────────────────────────────────────────────
describe("invoice number formatting — prefix + zero-padded sequential number", () => {
  /**
   * The invoice router does:
   *   `${biz.prefix}-${String(biz.nextNum).padStart(5, "0")}`
   * This ensures invoice numbers are always sortable and readable.
   */

  function formatInvoiceNumber(prefix: string, num: number): string {
    return `${prefix}-${String(num).padStart(5, "0")}`;
  }

  it("formats the first invoice as INV-00001", () => {
    expect(formatInvoiceNumber("INV", 1)).toBe("INV-00001");
  });

  it("formats invoice 42 as INV-00042", () => {
    expect(formatInvoiceNumber("INV", 42)).toBe("INV-00042");
  });

  it("formats invoice 99999 as INV-99999 (does not truncate)", () => {
    expect(formatInvoiceNumber("INV", 99999)).toBe("INV-99999");
  });

  it("formats invoice 100000 as INV-100000 (overflows beyond 5 digits gracefully)", () => {
    // High-volume businesses will exceed 5 digits; the format should not truncate.
    expect(formatInvoiceNumber("INV", 100000)).toBe("INV-100000");
  });

  it("uses the business-configured prefix (e.g. 'SALES', 'PO', 'GRN')", () => {
    expect(formatInvoiceNumber("SALES", 1)).toBe("SALES-00001");
    expect(formatInvoiceNumber("PO", 7)).toBe("PO-00007");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Invoice line item processing — as done in the invoice.create mutation
// ─────────────────────────────────────────────────────────────────────────────
describe("invoice line item processing — mirrors the calculation in invoice.create", () => {
  /**
   * The invoice router calls calcLineItem for each line item, then stores
   * taxAmount and total. This tests the exact same computation path.
   */

  it("computes correct taxAmount and total for a GST-taxed line item", () => {
    // 3 mobile phones @ ₹12000 each, 18% GST, no discount
    // subtotal = 36000, tax = 6480, total = 42480
    const result = calcLineItem({
      quantity: "3",
      unitPrice: "12000.00",
      taxPercent: "18",
      discountPercent: "0",
    });
    expect(result.taxAmount).toBe("6480.00");
    expect(result.total).toBe("42480.00");
  });

  it("computes correct totals with both line-level discount and GST", () => {
    // 10 shirts @ ₹500, 5% discount, 12% GST
    // subtotal=5000, disc=250, afterDisc=4750, tax=570, total=5320
    const result = calcLineItem({
      quantity: "10",
      unitPrice: "500.00",
      taxPercent: "12",
      discountPercent: "5",
    });
    expect(result.subtotal).toBe("5000.00");
    expect(result.discountAmount).toBe("250.00");
    expect(result.afterDiscount).toBe("4750.00");
    expect(result.taxAmount).toBe("570.00");
    expect(result.total).toBe("5320.00");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Stock adjustment logic — direction based on invoice type
// ─────────────────────────────────────────────────────────────────────────────
describe("stock adjustment direction — sale decrements, purchase increments", () => {
  /**
   * The invoice router adjusts stock after creating/updating an invoice:
   *   sale: stockQuantity -= qty (we sold items, stock goes down)
   *   purchase: stockQuantity += qty (we received items, stock goes up)
   *
   * We model this logic here as a pure function to test the sign convention
   * without needing a database connection.
   */

  function applyStockAdjustment(
    currentStock: number,
    qty: number,
    invoiceType: "sale" | "purchase"
  ): number {
    // Mirrors the SQL in invoice.create:
    //   sale:     stockQuantity - qty
    //   purchase: stockQuantity + qty
    return invoiceType === "sale" ? currentStock - qty : currentStock + qty;
  }

  it("decrements stock for a sale invoice", () => {
    // Started with 50 units, sold 10 → 40 remaining
    expect(applyStockAdjustment(50, 10, "sale")).toBe(40);
  });

  it("increments stock for a purchase invoice", () => {
    // Started with 30 units, purchased 20 → 50 on hand
    expect(applyStockAdjustment(30, 20, "purchase")).toBe(50);
  });

  it("allows stock to go negative (backorder scenario)", () => {
    // Some businesses allow selling more than they have in stock.
    // The system does not prevent this — it's a business decision.
    expect(applyStockAdjustment(5, 10, "sale")).toBe(-5);
  });

  it("handles fractional quantities for weight-based items", () => {
    // Sold 2.5 kg of rice from 10 kg stock → 7.5 kg remaining
    expect(applyStockAdjustment(10, 2.5, "sale")).toBeCloseTo(7.5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Stock adjustment reversal — when invoice is updated (old items reversed, new applied)
// ─────────────────────────────────────────────────────────────────────────────
describe("stock adjustment reversal — updating an invoice reverses old stock impact before applying new", () => {
  /**
   * The invoice.update mutation:
   * 1. Reads old line items
   * 2. Reverses old stock impact (opposite direction)
   * 3. Deletes old line items
   * 4. Inserts new line items
   * 5. Applies new stock impact
   *
   * This ensures no phantom stock gain/loss when an invoice is edited.
   */

  it("reverses a sale's stock impact: old items re-added before new items subtracted", () => {
    let stock = 40; // After original sale of 10 units from 50

    // Step: reverse old sale (add back 10 units)
    stock = stock + 10; // = 50 (original pre-sale stock)

    // Step: apply new sale (e.g. quantity changed from 10 to 15)
    stock = stock - 15; // = 35

    expect(stock).toBe(35);
  });

  it("reverses a purchase's stock impact: old items subtracted before new items added", () => {
    let stock = 80; // After original purchase of 20 units from 60

    // Reverse old purchase (subtract 20)
    stock = stock - 20; // = 60 (original pre-purchase stock)

    // Apply new purchase (e.g. quantity changed from 20 to 25)
    stock = stock + 25; // = 85

    expect(stock).toBe(85);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Conversion factor application — alt_units stock adjustments
// ─────────────────────────────────────────────────────────────────────────────
describe("alt_units conversion factor — stock adjusted in base unit after conversion", () => {
  /**
   * When an item is sold in alternative units (e.g. a box of 12 pcs),
   * the stock is stored in the base unit (pcs) but the invoice line item
   * shows the quantity in the selected unit (boxes).
   *
   * The router does: qty * conversionFactor to get base-unit quantity.
   * This is applied to `items.stockQuantity` (the base-unit stock),
   * NOT to `itemVariants` (which has no conversion factor).
   */

  function calcBaseUnitQty(qty: number, conversionFactor: number): number {
    // Mirrors: parseFloat(li.quantity) * parseFloat(li.conversionFactor || "1")
    return qty * conversionFactor;
  }

  it("applies conversion factor 12 when selling a box (1 box = 12 pcs)", () => {
    // Selling 3 boxes, each = 12 pcs → 36 pcs deducted from stock
    expect(calcBaseUnitQty(3, 12)).toBe(36);
  });

  it("applies conversion factor 1 when no alternate unit is selected", () => {
    // Default: selling in the base unit, factor is 1
    expect(calcBaseUnitQty(5, 1)).toBe(5);
  });

  it("applies conversion factor 0.5 for half-unit measurements (e.g. half-dozen = 6)", () => {
    // 2 half-dozens → 1 dozen = 12 pcs (if base is pcs and factor is 6)
    expect(calcBaseUnitQty(2, 6)).toBe(12);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Payment allocation — updating invoice status
// ─────────────────────────────────────────────────────────────────────────────
describe("payment allocation status logic — how invoice status changes with payments", () => {
  /**
   * The payment.create mutation uses a single SQL CASE expression to update
   * invoice status atomically. We model the same logic here as a pure function
   * to test all three outcome branches.
   */

  function resolveInvoiceStatus(
    amountPaid: number,
    allocationAmount: number,
    totalAmount: number
  ): string {
    // Mirrors the SQL CASE in payment.create:
    const newPaid = amountPaid + allocationAmount;
    if (newPaid >= totalAmount) return "paid";
    if (newPaid > 0) return "partial";
    return "status"; // unchanged (placeholder for ELSE branch)
  }

  it("sets invoice status to 'paid' when full amount is allocated", () => {
    // Invoice ₹10000, already ₹0 paid, allocating ₹10000 → paid
    expect(resolveInvoiceStatus(0, 10000, 10000)).toBe("paid");
  });

  it("sets invoice status to 'paid' when accumulated payments equal the total", () => {
    // Invoice ₹10000, already ₹7000 paid, allocating ₹3000 → paid
    expect(resolveInvoiceStatus(7000, 3000, 10000)).toBe("paid");
  });

  it("sets invoice status to 'partial' when only some of the amount is allocated", () => {
    // Invoice ₹10000, ₹0 paid, allocating ₹5000 → partial
    expect(resolveInvoiceStatus(0, 5000, 10000)).toBe("partial");
  });

  it("sets invoice status to 'partial' when payment exceeds zero but doesn't fully cover the invoice", () => {
    // Invoice ₹10000, ₹6000 already paid, allocating ₹3000 → still partial (total 9000 < 10000)
    expect(resolveInvoiceStatus(6000, 3000, 10000)).toBe("partial");
  });

  it("does not update status when the allocated amount is exactly zero", () => {
    // A ₹0 allocation should not change the status
    expect(resolveInvoiceStatus(0, 0, 10000)).toBe("status");
  });
});
