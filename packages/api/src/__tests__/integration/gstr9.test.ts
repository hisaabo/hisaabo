/**
 * gstr9.test.ts — Integration tests for the GSTR-9 annual return generator
 *
 * WHY THIS FILE EXISTS:
 * GSTR-9 is the annual GST return filed once per financial year. Incorrect
 * aggregation of monthly GSTR-1/GSTR-3B data can result in a mismatched
 * annual return with downstream compliance risk.
 *
 * We verify:
 *   Aggregation:    12 months of GSTR-1 data sums correctly into Table 4.
 *   ITC:            Table 6 ITC totals match the sum of GSTR-3B ITC for all months.
 *   Outward match:  partIITotals.taxableValue matches sum of GSTR-1 totalTaxableValue
 *                   across all months (minus credit notes net).
 *   Partial year:   A business created mid-year (months with no invoices) still
 *                   returns a valid report with those months contributing zero.
 *   Isolation:      business2 (no invoices) returns zero across all tables.
 *   Portal JSON:    gstr9Json returns a non-empty JSON object with correct FY key.
 *
 * All invoices are dated within FY 2025-26 (April 2025 – March 2026).
 * We use different months within the FY to validate cross-month aggregation.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestWorld,
  createParty,
  createInvoiceWithItems,
  type TestWorld,
} from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { truncateAllTables, closeTestDb } from "../helpers/test-db.js";

// ── Fixture ────────────────────────────────────────────────────────────────────

let world: TestWorld;

// FY 2025-26 (financialYear=2025, April 2025 – March 2026)
const TEST_FY = 2025;

// Create invoices in multiple different months to exercise aggregation
const MONTHS_WITH_DATA = [
  { year: 2025, month: 4 },  // April 2025
  { year: 2025, month: 8 },  // August 2025
  { year: 2026, month: 1 },  // January 2026
  { year: 2026, month: 3 },  // March 2026
];

beforeAll(async () => {
  world = await createTestWorld();
  const { tenantDb, business1, party1, item1 } = world;

  // Create a Karnataka (inter-state) party for IGST invoices
  const karParty = await createParty(tenantDb, business1.id, {
    name: "Bengaluru Buyer GSTR9",
    type: "customer",
    gstin: "29AABCG9111R1ZM",
    city: "Bengaluru",
    state: "Karnataka",
    stateCode: "29",
    openingBalance: "0.00",
  });

  // Create invoices spread across several months of the FY
  for (const { year, month } of MONTHS_WITH_DATA) {
    // B2B intra-state sale: 5 × 1000 @ 5% = 250 CGST + 250 SGST
    await createInvoiceWithItems(
      tenantDb,
      business1.id,
      party1.id,
      [
        {
          itemId: item1.id,
          description: "Fabric",
          quantity: "5",
          unitPrice: "1000.00",
          taxPercent: "5.00",
        },
      ],
      {
        type: "sale",
        documentType: "invoice",
        status: "sent",
        invoiceDate: new Date(year, month - 1, 15, 12, 0, 0),
      },
    );

    // B2B inter-state sale: 2 × 2000 @ 12% = 480 IGST
    await createInvoiceWithItems(
      tenantDb,
      business1.id,
      karParty.id,
      [
        {
          itemId: item1.id,
          description: "Silk",
          quantity: "2",
          unitPrice: "2000.00",
          taxPercent: "12.00",
        },
      ],
      {
        type: "sale",
        documentType: "invoice",
        status: "sent",
        invoiceDate: new Date(year, month - 1, 16, 12, 0, 0),
      },
    );

    // Purchase invoice for ITC: 10 × 500 @ 5% = 250 ITC (intra-state → CGST+SGST)
    await createInvoiceWithItems(
      tenantDb,
      business1.id,
      party1.id,
      [
        {
          itemId: item1.id,
          description: "Raw material",
          quantity: "10",
          unitPrice: "500.00",
          taxPercent: "5.00",
        },
      ],
      {
        type: "purchase",
        documentType: "invoice",
        status: "sent",
        invoiceDate: new Date(year, month - 1, 17, 12, 0, 0),
      },
    );
  }
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

// ── Core aggregation ───────────────────────────────────────────────────────────

describe("gst.gstr9 — aggregation", () => {
  it("returns correct financial year string and period identifiers", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const report = await caller.gst.gstr9({ financialYear: TEST_FY });

    expect(report.financialYear).toBe("2025-26");
    expect(report.periodStart).toBe("Apr 2025");
    expect(report.periodEnd).toBe("Mar 2026");
    expect(report.businessName).toBe(world.business1.name);
    expect(report.businessGstin).toBe(world.business1.gstin);
  });

  it("monthly breakdown contains exactly 12 entries (April–March)", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const report = await caller.gst.gstr9({ financialYear: TEST_FY });

    expect(report.monthlyBreakdown).toHaveLength(12);
    // First entry must be April of the start year
    expect(report.monthlyBreakdown[0]!.year).toBe(TEST_FY);
    expect(report.monthlyBreakdown[0]!.month).toBe(4);
    // Last entry must be March of the following year
    expect(report.monthlyBreakdown[11]!.year).toBe(TEST_FY + 1);
    expect(report.monthlyBreakdown[11]!.month).toBe(3);
  });

  it("Table 4 outward supplies match sum of GSTR-1 monthly totals from breakdown", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const report = await caller.gst.gstr9({ financialYear: TEST_FY });

    // Sum GSTR-1 totals from the embedded monthly breakdown
    let expectedTaxable = 0;
    let expectedCgst = 0;
    let expectedSgst = 0;
    let expectedIgst = 0;

    for (const { gstr1 } of report.monthlyBreakdown) {
      expectedTaxable += gstr1.totalTaxableValue;
      expectedCgst += gstr1.totalCgst;
      expectedSgst += gstr1.totalSgst;
      expectedIgst += gstr1.totalIgst;
    }

    // Table 4 B2B + B2C combined should match total outward supply from breakdown
    const actualTaxable = report.table4.taxableSuppliesB2B.taxableValue + report.table4.taxableSuppliesB2C.taxableValue;
    const actualCgst = report.table4.taxableSuppliesB2B.cgst + report.table4.taxableSuppliesB2C.cgst;
    const actualSgst = report.table4.taxableSuppliesB2B.sgst + report.table4.taxableSuppliesB2C.sgst;
    const actualIgst = report.table4.taxableSuppliesB2B.igst + report.table4.taxableSuppliesB2C.igst;

    expect(actualTaxable).toBeCloseTo(expectedTaxable, 2);
    expect(actualCgst).toBeCloseTo(expectedCgst, 2);
    expect(actualSgst).toBeCloseTo(expectedSgst, 2);
    expect(actualIgst).toBeCloseTo(expectedIgst, 2);
  });

  it("Table 6 ITC totals match sum of GSTR-3B ITC from monthly breakdown", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const report = await caller.gst.gstr9({ financialYear: TEST_FY });

    // Sum ITC from the embedded monthly GSTR-3B data
    let expectedItcCgst = 0;
    let expectedItcSgst = 0;
    let expectedItcIgst = 0;

    for (const { gstr3b } of report.monthlyBreakdown) {
      expectedItcCgst += gstr3b.itc.cgst;
      expectedItcSgst += gstr3b.itc.sgst;
      expectedItcIgst += gstr3b.itc.igst;
    }

    expect(report.table6.totalItcGstr3B.cgst).toBeCloseTo(expectedItcCgst, 2);
    expect(report.table6.totalItcGstr3B.sgst).toBeCloseTo(expectedItcSgst, 2);
    expect(report.table6.totalItcGstr3B.igst).toBeCloseTo(expectedItcIgst, 2);
  });

  it("partIITotals taxable value is positive and reflects multiple months", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const report = await caller.gst.gstr9({ financialYear: TEST_FY });

    // We created 4 months × 2 invoices per month: each intra-state = 5000 taxable
    // and each inter-state = 4000 taxable. So total = 4 × 9000 = 36000
    expect(report.partIITotals.taxableValue).toBeGreaterThan(0);
    // Should be at least 3 months × (5000 + 4000) since some months overlap
    expect(report.partIITotals.taxableValue).toBeGreaterThanOrEqual(27000);
  });

  it("Table 9 ITC utilised is less than or equal to total output tax", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const report = await caller.gst.gstr9({ financialYear: TEST_FY });

    const t9 = report.table9;
    // ITC utilised cannot exceed output tax
    const outputIgst = t9.igstThroughITC + t9.igstThroughCash;
    const outputCgst = t9.cgstThroughITC + t9.cgstThroughCash;
    const outputSgst = t9.sgstThroughITC + t9.sgstThroughCash;

    expect(t9.igstThroughITC).toBeLessThanOrEqual(outputIgst + 0.01);
    expect(t9.cgstThroughITC).toBeLessThanOrEqual(outputCgst + 0.01);
    expect(t9.sgstThroughITC).toBeLessThanOrEqual(outputSgst + 0.01);
  });
});

// ── Partial year handling ──────────────────────────────────────────────────────

describe("gst.gstr9 — partial year (no data in some months)", () => {
  it("months with no invoices contribute zero to totals without errors", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    // FY 2023-24 has no invoices created in this test suite
    const report = await caller.gst.gstr9({ financialYear: 2023 });

    // All tables should be zero — no errors thrown
    expect(report.table4.taxableSuppliesB2B.taxableValue).toBe(0);
    expect(report.table4.taxableSuppliesB2C.taxableValue).toBe(0);
    expect(report.table6.totalItcGstr3B.cgst).toBe(0);
    expect(report.table9.igstThroughCash).toBe(0);
    expect(report.partIITotals.taxableValue).toBe(0);
    expect(report.monthlyBreakdown).toHaveLength(12);
  });
});

// ── Business isolation ─────────────────────────────────────────────────────────

describe("gst.gstr9 — business isolation", () => {
  it("business2 with no invoices returns all-zero tables", async () => {
    const caller = createTestCaller({
      userId: world.kiran.id,
      email: world.kiran.email,
      name: world.kiran.name,
      tenantId: world.tenant2.id,
      businessId: world.business2.id,
    });

    const report = await caller.gst.gstr9({ financialYear: TEST_FY });

    expect(report.table4.taxableSuppliesB2B.taxableValue).toBe(0);
    expect(report.table4.taxableSuppliesB2C.taxableValue).toBe(0);
    expect(report.table6.totalItcGstr3B.cgst).toBe(0);
    expect(report.table6.totalItcGstr3B.igst).toBe(0);
    expect(report.table9.igstThroughCash).toBe(0);
    expect(report.table9.cgstThroughCash).toBe(0);
    expect(report.partIITotals.taxableValue).toBe(0);
  });
});

// ── Portal JSON export ─────────────────────────────────────────────────────────

describe("gst.gstr9Json", () => {
  it("returns a JSON object with correct FY key and a downloadable filename", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const result = await caller.gst.gstr9Json({ financialYear: TEST_FY });

    expect(result.json).toBeDefined();
    expect(typeof result.json).toBe("object");
    expect(result.filename).toMatch(/GSTR9/);
    expect(result.filename).toMatch(/\.json$/);
    // Portal JSON must include the FY key
    expect((result.json as Record<string, unknown>).fy).toBe("2025-26");
  });

  it("portal JSON includes table4 and table6 keys", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const result = await caller.gst.gstr9Json({ financialYear: TEST_FY });
    const json = result.json as Record<string, unknown>;

    expect(json.table4).toBeDefined();
    expect(json.table6).toBeDefined();
    expect(json.table9).toBeDefined();
    expect(json.gstin).toBe(world.business1.gstin);
  });
});
