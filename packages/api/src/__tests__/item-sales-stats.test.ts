/**
 * Tests for the item.salesStats calculation logic.
 *
 * WHY THIS FILE EXISTS:
 * The item router's `salesStats` query computes aggregate sales metrics for an
 * item by joining invoice_items → invoices and summing quantities, revenue, and
 * deriving average sale prices. The SQL is non-trivial because:
 *
 * 1. Quantities must be converted to BASE UNITS using conversionFactor.
 *    e.g. If base unit is "box" and someone sells 2 kg where 1 kg = 5 boxes,
 *    the base-unit qty is 2 × 5 = 10 boxes.
 *
 * 2. We report TWO average prices per base unit:
 *
 *    a) Avg GROSS price (list price):
 *       SUM(unitPrice × quantity) / SUM(quantity × conversionFactor)
 *       → What we listed the item at, before any discount or tax.
 *       → Useful for: comparing against current sale price, spotting drift.
 *
 *    b) Avg NET price (realized price):
 *       SUM(totalAmount − taxAmount) / SUM(quantity × conversionFactor)
 *       → What we actually received per unit, after discounts, excluding tax.
 *       → Useful for: margin analysis, actual revenue per unit.
 *
 *    WHY both? Gross tells you "are we holding price?" Net tells you "are
 *    discounts eroding margin?" A widening gap between them signals trouble.
 *
 * 3. The gross formula simplifies elegantly:
 *       avgGross = SUM(unitPrice × qty) / SUM(qty × cf)
 *    This is a weighted average of (unitPrice / cf) — price per base unit —
 *    weighted by base-unit quantity. The conversionFactor cancels in the
 *    numerator: SUM((unitPrice/cf) × (qty×cf)) = SUM(unitPrice × qty).
 *
 * This file tests the CALCULATION LAYER in isolation (no DB required).
 * Each function mirrors the exact SQL expression from the salesStats query.
 */

import { describe, it, expect } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Types — mirrors what an invoice_items row contributes to the aggregation
// ─────────────────────────────────────────────────────────────────────────────

interface SaleLineItem {
  /** Quantity in the invoice's unit (e.g. 2 kg, 3 boxes) */
  quantity: number;
  /** Price per invoice unit, before tax/discount (e.g. ₹200/kg) */
  unitPrice: number;
  /** Base units per invoice unit (e.g. 1 kg = 5 boxes → factor = 5) */
  conversionFactor: number;
  /** Tax amount for this line (e.g. 18% GST on subtotal after discount) */
  taxAmount: number;
  /** Total line amount including tax and after discount */
  totalAmount: number;
  /** "sale" or "purchase" — only "sale" lines contribute to sale stats */
  invoiceType: "sale" | "purchase";
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure functions — mirror the SQL expressions in item.salesStats
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mirrors:
 *   SUM(CASE WHEN type = 'sale'
 *     THEN quantity::numeric * COALESCE(conversionFactor::numeric, 1)
 *   ELSE 0 END)
 */
function calcTotalSaleQty(lines: SaleLineItem[]): number {
  return lines
    .filter((l) => l.invoiceType === "sale")
    .reduce((sum, l) => sum + l.quantity * l.conversionFactor, 0);
}

/**
 * Avg GROSS price per base unit — the list price before any discount or tax.
 *
 * Mirrors:
 *   ROUND(
 *     SUM(CASE WHEN type='sale' THEN unitPrice * quantity ELSE 0 END)
 *     / NULLIF(SUM(CASE WHEN type='sale' THEN quantity * COALESCE(cf, 1) ELSE 0 END), 0),
 *   2)
 */
function calcAvgGrossPrice(lines: SaleLineItem[]): number {
  const saleLines = lines.filter((l) => l.invoiceType === "sale");
  const numerator = saleLines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const denominator = saleLines.reduce((sum, l) => sum + l.quantity * l.conversionFactor, 0);
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 100) / 100;
}

/**
 * Avg NET price per base unit — the realized price after discount, excluding tax.
 *
 * Mirrors:
 *   ROUND(
 *     SUM(CASE WHEN type='sale' THEN (totalAmount - taxAmount) ELSE 0 END)
 *     / NULLIF(SUM(CASE WHEN type='sale' THEN quantity * COALESCE(cf, 1) ELSE 0 END), 0),
 *   2)
 */
function calcAvgNetPrice(lines: SaleLineItem[]): number {
  const saleLines = lines.filter((l) => l.invoiceType === "sale");
  const numerator = saleLines.reduce((sum, l) => sum + (l.totalAmount - l.taxAmount), 0);
  const denominator = saleLines.reduce((sum, l) => sum + l.quantity * l.conversionFactor, 0);
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 100) / 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper — builds a line item with realistic tax/total calculations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Constructs a SaleLineItem with correct taxAmount and totalAmount derived
 * from the input parameters, so test data is internally consistent.
 */
function makeLine(opts: {
  quantity: number;
  unitPrice: number;
  conversionFactor?: number;
  discountPercent?: number;
  taxPercent?: number;
  invoiceType?: "sale" | "purchase";
}): SaleLineItem {
  const cf = opts.conversionFactor ?? 1;
  const discPct = opts.discountPercent ?? 0;
  const taxPct = opts.taxPercent ?? 18; // default 18% GST
  const subtotal = opts.unitPrice * opts.quantity;
  const discount = subtotal * discPct / 100;
  const afterDiscount = subtotal - discount;
  const taxAmount = Math.round(afterDiscount * taxPct / 100 * 100) / 100;
  const totalAmount = Math.round((afterDiscount + taxAmount) * 100) / 100;
  return {
    quantity: opts.quantity,
    unitPrice: opts.unitPrice,
    conversionFactor: cf,
    taxAmount,
    totalAmount,
    invoiceType: opts.invoiceType ?? "sale",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Total sale quantity — converted to base units
// ─────────────────────────────────────────────────────────────────────────────
describe("totalSaleQty — all quantities normalized to the item's base unit", () => {
  /**
   * The salesStats query sums (quantity × conversionFactor) across all sale
   * invoice lines for an item. This converts every line's quantity into the
   * item's base unit before summing.
   *
   * Example: Item "Strawberry" has base unit "box".
   * - Invoice A sells 2 kg (1 kg = 5 boxes) → 2 × 5 = 10 boxes
   * - Invoice B sells 3 boxes directly      → 3 × 1 = 3 boxes
   * - Total: 13 boxes
   */

  it("sums quantities in same unit (conversionFactor = 1)", () => {
    const lines = [
      makeLine({ quantity: 5, unitPrice: 150 }),
      makeLine({ quantity: 3, unitPrice: 150 }),
      makeLine({ quantity: 2, unitPrice: 150 }),
    ];
    // 5 + 3 + 2 = 10 boxes
    expect(calcTotalSaleQty(lines)).toBe(10);
  });

  it("converts alt-unit quantities to base unit via conversionFactor", () => {
    // Strawberry: base unit = box, 1 kg = 5 boxes (conversionFactor = 5)
    // Sold 2 kg → should count as 10 boxes
    const lines = [makeLine({ quantity: 2, unitPrice: 750, conversionFactor: 5 })];
    expect(calcTotalSaleQty(lines)).toBe(10);
  });

  it("mixes base-unit and alt-unit sales correctly", () => {
    // Strawberry: base = box, 1 kg = 5 boxes
    // Invoice 1: 3 boxes (cf=1) → 3
    // Invoice 2: 2 kg (cf=5) → 10
    // Invoice 3: 1 box (cf=1) → 1
    // Total: 14 boxes
    const lines = [
      makeLine({ quantity: 3, unitPrice: 150, conversionFactor: 1 }),
      makeLine({ quantity: 2, unitPrice: 750, conversionFactor: 5 }),
      makeLine({ quantity: 1, unitPrice: 150, conversionFactor: 1 }),
    ];
    expect(calcTotalSaleQty(lines)).toBe(14);
  });

  it("excludes purchase invoices from the sale total", () => {
    const lines = [
      makeLine({ quantity: 5, unitPrice: 150 }),
      makeLine({ quantity: 100, unitPrice: 120, invoiceType: "purchase" }),
    ];
    expect(calcTotalSaleQty(lines)).toBe(5);
  });

  it("returns 0 when there are no sale invoices", () => {
    const lines = [makeLine({ quantity: 50, unitPrice: 120, invoiceType: "purchase" })];
    expect(calcTotalSaleQty(lines)).toBe(0);
  });

  it("handles fractional quantities (e.g. 0.5 kg = 2.5 boxes)", () => {
    const lines = [makeLine({ quantity: 0.5, unitPrice: 750, conversionFactor: 5 })];
    expect(calcTotalSaleQty(lines)).toBeCloseTo(2.5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Avg GROSS price — list price per base unit, before discount and tax
// ─────────────────────────────────────────────────────────────────────────────
describe("avgGrossPrice — weighted average of list price per base unit", () => {
  /**
   * WHAT IT ANSWERS: "On average, what list price did we quote per base unit?"
   *
   * This is the unitPrice (before any discount or tax) normalized to the base
   * unit. Useful for checking whether the team is holding the list price or
   * whether different customers/channels are getting different quotes.
   *
   * Formula: SUM(unitPrice × quantity) / SUM(quantity × conversionFactor)
   */

  it("returns the unit price directly when all sales use the base unit", () => {
    // All sales at ₹150/box, conversionFactor = 1
    // avg = (150×5 + 150×3) / (5 + 3) = 1200 / 8 = ₹150.00/box
    const lines = [
      makeLine({ quantity: 5, unitPrice: 150 }),
      makeLine({ quantity: 3, unitPrice: 150 }),
    ];
    expect(calcAvgGrossPrice(lines)).toBe(150);
  });

  it("normalizes alt-unit price to base-unit price via conversionFactor", () => {
    // Sold 2 kg at ₹750/kg, where 1 kg = 5 boxes (cf=5)
    // Per box = 750/5 = ₹150. avg = (750×2) / (2×5) = 1500/10 = ₹150.00
    const lines = [makeLine({ quantity: 2, unitPrice: 750, conversionFactor: 5 })];
    expect(calcAvgGrossPrice(lines)).toBe(150);
  });

  it("mixed base + alt unit sales at same effective price average correctly", () => {
    // 4 boxes @ ₹150 (cf=1) + 2 kg @ ₹750 (cf=5) → both = ₹150/box
    // avg = (150×4 + 750×2) / (4 + 10) = 2100/14 = ₹150.00
    const lines = [
      makeLine({ quantity: 4, unitPrice: 150, conversionFactor: 1 }),
      makeLine({ quantity: 2, unitPrice: 750, conversionFactor: 5 }),
    ];
    expect(calcAvgGrossPrice(lines)).toBe(150);
  });

  it("weights by volume — higher-qty sales pull the average", () => {
    // 6 boxes @ ₹140 + 4 boxes @ ₹160
    // Weighted avg = (840 + 640) / 10 = ₹148 (NOT simple avg ₹150)
    const lines = [
      makeLine({ quantity: 6, unitPrice: 140 }),
      makeLine({ quantity: 4, unitPrice: 160 }),
    ];
    expect(calcAvgGrossPrice(lines)).toBe(148);
  });

  it("handles mixed units AND different prices", () => {
    // 10 boxes @ ₹140 (cf=1) → 10 base units
    // 1 kg @ ₹800/kg (cf=5) → 5 base units, effective ₹160/box
    // avg = (140×10 + 800×1) / (10 + 5) = 2200/15 = ₹146.67
    const lines = [
      makeLine({ quantity: 10, unitPrice: 140, conversionFactor: 1 }),
      makeLine({ quantity: 1, unitPrice: 800, conversionFactor: 5 }),
    ];
    expect(calcAvgGrossPrice(lines)).toBe(146.67);
  });

  it("is unaffected by discounts — gross means list price", () => {
    // Same unit price, one with 10% discount, one without.
    // Gross avg should be identical since it uses unitPrice, not totalAmount.
    const noDiscount = makeLine({ quantity: 5, unitPrice: 200, discountPercent: 0 });
    const withDiscount = makeLine({ quantity: 5, unitPrice: 200, discountPercent: 10 });
    expect(calcAvgGrossPrice([noDiscount])).toBe(calcAvgGrossPrice([withDiscount]));
    expect(calcAvgGrossPrice([noDiscount, withDiscount])).toBe(200);
  });

  it("excludes purchase lines", () => {
    const lines = [
      makeLine({ quantity: 5, unitPrice: 150 }),
      makeLine({ quantity: 100, unitPrice: 120, invoiceType: "purchase" }),
    ];
    expect(calcAvgGrossPrice(lines)).toBe(150);
  });

  it("returns 0 when no sale lines exist", () => {
    expect(calcAvgGrossPrice([])).toBe(0);
    expect(calcAvgGrossPrice([makeLine({ quantity: 5, unitPrice: 100, invoiceType: "purchase" })])).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Avg NET price — realized price per base unit, after discount, excl. tax
// ─────────────────────────────────────────────────────────────────────────────
describe("avgNetPrice — realized revenue per base unit, after discount, excluding tax", () => {
  /**
   * WHAT IT ANSWERS: "On average, how much did we actually pocket per base unit?"
   *
   * This strips tax (which is pass-through to the government) and includes
   * discounts (which reduce what we actually keep). It's the number that
   * matters for margin analysis.
   *
   * Formula: SUM(totalAmount − taxAmount) / SUM(quantity × conversionFactor)
   *
   * The gap between avgGrossPrice and avgNetPrice reveals discount erosion:
   *   grossPrice = 150, netPrice = 142.50 → avg 5% discount being given
   */

  it("equals gross price when there are no discounts", () => {
    // ₹150/box, 18% GST, no discount
    // totalAmount = 150 × 1.18 = 177, taxAmount = 27
    // net per unit = (177 - 27) / 1 = ₹150
    const lines = [makeLine({ quantity: 1, unitPrice: 150, discountPercent: 0, taxPercent: 18 })];
    expect(calcAvgNetPrice(lines)).toBe(calcAvgGrossPrice(lines));
    expect(calcAvgNetPrice(lines)).toBe(150);
  });

  it("reflects discount erosion — net is lower than gross when discounts applied", () => {
    // ₹200/box, 10% discount, 18% GST
    // subtotal = 200, discount = 20, afterDiscount = 180
    // tax = 32.40, total = 212.40
    // net = (212.40 - 32.40) / 1 = ₹180 per box
    // gross = 200 per box
    const lines = [makeLine({ quantity: 1, unitPrice: 200, discountPercent: 10, taxPercent: 18 })];
    expect(calcAvgGrossPrice(lines)).toBe(200);
    expect(calcAvgNetPrice(lines)).toBe(180);
  });

  it("produces correct weighted net price across multiple discounted lines", () => {
    // Line 1: 6 boxes @ ₹150, 5% discount, 18% GST
    //   sub=900, disc=45, after=855, tax=153.90, total=1008.90
    //   net revenue = 1008.90 - 153.90 = 855
    // Line 2: 4 boxes @ ₹150, 0% discount, 18% GST
    //   sub=600, disc=0, after=600, tax=108, total=708
    //   net revenue = 708 - 108 = 600
    // Total base qty = 10
    // avg net = (855 + 600) / 10 = ₹145.50/box
    // avg gross = (150×6 + 150×4) / 10 = ₹150/box
    const lines = [
      makeLine({ quantity: 6, unitPrice: 150, discountPercent: 5, taxPercent: 18 }),
      makeLine({ quantity: 4, unitPrice: 150, discountPercent: 0, taxPercent: 18 }),
    ];
    expect(calcAvgGrossPrice(lines)).toBe(150);
    expect(calcAvgNetPrice(lines)).toBe(145.5);
  });

  it("works correctly with mixed units and discounts", () => {
    // Strawberry: base = box, 1 kg = 5 boxes
    // Line 1: 4 boxes @ ₹150, no discount, 18% GST → 4 base units
    //   net revenue = 4 × 150 = 600
    // Line 2: 2 kg @ ₹750/kg (cf=5), 10% discount, 18% GST → 10 base units
    //   sub=1500, disc=150, after=1350, tax=243, total=1593
    //   net revenue = 1593 - 243 = 1350
    // Total base qty = 14
    // avg net = (600 + 1350) / 14 = ₹139.29/box
    // avg gross = (150×4 + 750×2) / 14 = 2100/14 = ₹150/box
    const lines = [
      makeLine({ quantity: 4, unitPrice: 150, conversionFactor: 1, discountPercent: 0 }),
      makeLine({ quantity: 2, unitPrice: 750, conversionFactor: 5, discountPercent: 10 }),
    ];
    expect(calcAvgGrossPrice(lines)).toBe(150);
    expect(calcAvgNetPrice(lines)).toBe(139.29);
  });

  it("handles zero-tax items (exempt goods)", () => {
    // Some items are tax-exempt. Net should equal subtotal after discount.
    // ₹100/unit, 5% discount, 0% tax → net = ₹95/unit
    const lines = [makeLine({ quantity: 10, unitPrice: 100, discountPercent: 5, taxPercent: 0 })];
    expect(calcAvgNetPrice(lines)).toBe(95);
    expect(calcAvgGrossPrice(lines)).toBe(100);
  });

  it("excludes purchase lines", () => {
    const lines = [
      makeLine({ quantity: 5, unitPrice: 150 }),
      makeLine({ quantity: 100, unitPrice: 120, invoiceType: "purchase" }),
    ];
    expect(calcAvgNetPrice(lines)).toBe(150);
  });

  it("returns 0 when no sale lines exist", () => {
    expect(calcAvgNetPrice([])).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Gross vs Net gap — detecting discount erosion
// ─────────────────────────────────────────────────────────────────────────────
describe("gross vs net gap — surfacing discount erosion in practice", () => {
  /**
   * The difference between avgGrossPrice and avgNetPrice directly reveals
   * how much revenue is being lost to discounts. This is the key business
   * insight from reporting both numbers:
   *
   *   discount erosion % = (gross - net) / gross × 100
   *
   * If gross=150 and net=142.50, that's 5% erosion — meaning on average
   * every sale is giving away 5% in discounts.
   */

  it("no erosion when no discounts are given", () => {
    const lines = [
      makeLine({ quantity: 10, unitPrice: 200, discountPercent: 0 }),
      makeLine({ quantity: 5, unitPrice: 200, discountPercent: 0 }),
    ];
    const gross = calcAvgGrossPrice(lines);
    const net = calcAvgNetPrice(lines);
    expect(gross).toBe(net);
    expect(gross - net).toBe(0);
  });

  it("uniform 5% discount shows 5% erosion", () => {
    const lines = [
      makeLine({ quantity: 10, unitPrice: 200, discountPercent: 5 }),
      makeLine({ quantity: 10, unitPrice: 200, discountPercent: 5 }),
    ];
    const gross = calcAvgGrossPrice(lines);
    const net = calcAvgNetPrice(lines);
    expect(gross).toBe(200);
    expect(net).toBe(190);
    const erosion = ((gross - net) / gross) * 100;
    expect(erosion).toBeCloseTo(5);
  });

  it("mixed discount rates show volume-weighted erosion", () => {
    // 8 units at full price + 2 units at 20% off
    // gross = 200 across the board
    // net = (8×200 + 2×160) / 10 = 1920/10 = 192
    // erosion = (200-192)/200 = 4%
    const lines = [
      makeLine({ quantity: 8, unitPrice: 200, discountPercent: 0 }),
      makeLine({ quantity: 2, unitPrice: 200, discountPercent: 20 }),
    ];
    const gross = calcAvgGrossPrice(lines);
    const net = calcAvgNetPrice(lines);
    expect(gross).toBe(200);
    expect(net).toBe(192);
    expect(((gross - net) / gross) * 100).toBeCloseTo(4);
  });
});
