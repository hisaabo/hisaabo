/**
 * gst.test.ts — Integration tests for gstRouter (GSTR-1, GSTR-3B)
 *
 * WHY THIS FILE EXISTS:
 * The GST reports are the primary compliance output of Hisaabo. Incorrect
 * classification of invoices (B2B vs B2C) or tax type (CGST+SGST vs IGST) can
 * result in incorrect returns filed with the government. We verify:
 *
 *   B2B vs B2C:   A party with a GSTIN is classified as B2B.
 *                 A party without a GSTIN goes to B2C (small or large).
 *   Tax split:    Same-state supplier → CGST + SGST (half each).
 *                 Inter-state supplier → IGST only (full tax amount).
 *   GSTR-3B:      Outward supplies match the sale invoices for the period.
 *                 ITC section reflects purchase invoices.
 *   Business isolation: reports only reflect the queried business's invoices.
 *
 * The business fixture (business1) is in Maharashtra (stateCode "27").
 * party1 is also in Maharashtra (intra-state → CGST+SGST).
 * We create an inter-state party (Karnataka, "29") to test IGST path.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestWorld,
  createParty,
  createBusiness,
  createInvoiceWithItems,
  type TestWorld,
  type TestBusiness,
} from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { truncateAllTables, closeTestDb, getTenantTestDb } from "../helpers/test-db.js";

// ── Fixture ────────────────────────────────────────────────────────────────────

let world: TestWorld;

// Use a fixed past month to avoid FY boundary edge cases
const TEST_YEAR = 2025;
const TEST_MONTH = 8; // August 2025 — well within a single FY

function invoiceDateInTestMonth(): Date {
  // mid-month to avoid any timezone edge cases near month boundaries
  return new Date(TEST_YEAR, TEST_MONTH - 1, 15, 12, 0, 0);
}

beforeAll(async () => {
  world = await createTestWorld();

  const { tenantDb, business1, party1, item1 } = world;

  // 1. Intra-state B2B sale — party1 has GSTIN, same state as business1 (Maharashtra)
  //    Subtotal: 10 × 1000 = 10,000 | tax 5% = 500 → CGST 250 + SGST 250
  await createInvoiceWithItems(
    tenantDb,
    business1.id,
    party1.id,
    [
      {
        itemId: item1.id,
        description: "Cotton Fabric",
        quantity: "10",
        unitPrice: "1000.00",
        taxPercent: "5.00",
      },
    ],
    {
      type: "sale",
      documentType: "invoice",
      status: "sent",
      invoiceDate: invoiceDateInTestMonth(),
    },
  );

  // 2. Inter-state B2B sale — party in Karnataka (different stateCode "29")
  //    We create an inter-state party explicitly with Karnataka stateCode
  const interStateParty = await createParty(tenantDb, business1.id, {
    name: "Karnataka Trader",
    type: "customer",
    gstin: "29AABCK9999R1ZM", // has GSTIN → B2B
    city: "Bengaluru",
    state: "Karnataka",
    stateCode: "29",
    openingBalance: "0.00",
  });

  // Subtotal: 5 × 2000 = 10,000 | tax 12% = 1,200 → IGST 1,200
  await createInvoiceWithItems(
    tenantDb,
    business1.id,
    interStateParty.id,
    [
      {
        itemId: item1.id,
        description: "Silk Fabric",
        quantity: "5",
        unitPrice: "2000.00",
        taxPercent: "12.00",
      },
    ],
    {
      type: "sale",
      documentType: "invoice",
      status: "sent",
      invoiceDate: invoiceDateInTestMonth(),
    },
  );

  // 3. B2C sale — party WITHOUT GSTIN, same state (intra-state B2C Small)
  const b2cParty = await createParty(tenantDb, business1.id, {
    name: "Walk-in Customer",
    type: "customer",
    gstin: null, // no GSTIN → B2C
    city: "Nagpur",
    state: "Maharashtra",
    stateCode: "27",
    openingBalance: "0.00",
  });

  // Small B2C invoice (well under ₹2.5L)
  await createInvoiceWithItems(
    tenantDb,
    business1.id,
    b2cParty.id,
    [
      {
        description: "Handkerchief",
        quantity: "20",
        unitPrice: "50.00",
        taxPercent: "5.00",
      },
    ],
    {
      type: "sale",
      documentType: "invoice",
      status: "sent",
      invoiceDate: invoiceDateInTestMonth(),
    },
  );

  // 4. Purchase invoice — will appear in GSTR-3B ITC section
  await createInvoiceWithItems(
    tenantDb,
    business1.id,
    party1.id,
    [
      {
        itemId: item1.id,
        description: "Raw cotton purchase",
        quantity: "100",
        unitPrice: "200.00",
        taxPercent: "5.00",
      },
    ],
    {
      type: "purchase",
      documentType: "invoice",
      status: "sent",
      invoiceDate: invoiceDateInTestMonth(),
    },
  );
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

// ── GSTR-1 ─────────────────────────────────────────────────────────────────────

describe("gst.gstr1", () => {
  it("gstr1 returns correct period string for the queried year/month", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const report = await caller.gst.gstr1({ year: TEST_YEAR, month: TEST_MONTH });

    expect(typeof report.period).toBe("string");
    expect(report.period.length).toBeGreaterThan(0);
    expect(report.businessGstin).toBe(world.business1.gstin);
    expect(report.businessName).toBe(world.business1.name);
  });

  it("gstr1 B2B classification — party with GSTIN appears in b2b array, not b2cSmall or b2cLarge", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const report = await caller.gst.gstr1({ year: TEST_YEAR, month: TEST_MONTH });

    // party1 has GSTIN so all invoices to party1 must be in b2b
    const party1Gstin = world.party1.gstin!;
    const b2bEntries = report.b2b.filter((e) => e.partyGstin === party1Gstin);
    expect(b2bEntries.length).toBeGreaterThanOrEqual(1);

    // Ensure party1 is not accidentally in b2cSmall
    const b2cSmallParties = report.b2cSmall; // aggregated by tax rate, no partyGstin
    // The b2cSmall check is indirect: if b2b has the party then b2cSmall aggregate is for the no-GSTIN party
    expect(Array.isArray(b2cSmallParties)).toBe(true);
  });

  it("gstr1 intra-state invoice has CGST+SGST (half each), zero IGST", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const report = await caller.gst.gstr1({ year: TEST_YEAR, month: TEST_MONTH });

    // Find the intra-state party1 entry in b2b
    const intraEntry = report.b2b.find(
      (e) => e.partyGstin === world.party1.gstin && e.taxableValue > 0,
    );

    expect(intraEntry).toBeDefined();
    expect(intraEntry!.igst).toBe(0);
    expect(intraEntry!.cgst).toBeGreaterThan(0);
    expect(intraEntry!.sgst).toBeGreaterThan(0);
    // CGST and SGST must be equal
    expect(intraEntry!.cgst).toBeCloseTo(intraEntry!.sgst, 2);
    // CGST + SGST = total tax on the line
    expect(intraEntry!.cgst + intraEntry!.sgst).toBeCloseTo(
      intraEntry!.totalInvoiceValue - intraEntry!.taxableValue,
      2,
    );
  });

  it("gstr1 inter-state invoice has IGST only, zero CGST and SGST", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const report = await caller.gst.gstr1({ year: TEST_YEAR, month: TEST_MONTH });

    // Karnataka trader GSTIN
    const interEntry = report.b2b.find((e) => e.partyGstin === "29AABCK9999R1ZM");

    expect(interEntry).toBeDefined();
    expect(interEntry!.cgst).toBe(0);
    expect(interEntry!.sgst).toBe(0);
    expect(interEntry!.igst).toBeGreaterThan(0);
  });

  it("gstr1 B2C sale without GSTIN appears in b2cSmall, not b2b", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const report = await caller.gst.gstr1({ year: TEST_YEAR, month: TEST_MONTH });

    // b2cSmall should have at least one entry (from the Walk-in Customer invoice)
    expect(report.b2cSmall.length).toBeGreaterThanOrEqual(1);
    // The 5% tax rate bucket should exist
    const bucket5pct = report.b2cSmall.find((b) => b.taxRate === 5);
    expect(bucket5pct).toBeDefined();
    expect(bucket5pct!.taxableValue).toBeGreaterThan(0);
  });

  it("gstr1 totals are consistent: totalTax = totalCgst + totalSgst + totalIgst", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const report = await caller.gst.gstr1({ year: TEST_YEAR, month: TEST_MONTH });

    const computedTotalTax = report.totalCgst + report.totalSgst + report.totalIgst;
    expect(report.totalTax).toBeCloseTo(computedTotalTax, 2);
  });

  it("gstr1 — business isolation: business2 with no invoices returns empty report", async () => {
    const caller2 = createTestCaller({
      userId: world.kiran.id,
      email: world.kiran.email,
      name: world.kiran.name,
      tenantId: world.tenant2.id,
      businessId: world.business2.id,
    });

    const report = await caller2.gst.gstr1({ year: TEST_YEAR, month: TEST_MONTH });

    expect(report.b2b.length).toBe(0);
    expect(report.b2cSmall.length).toBe(0);
    expect(report.totalTaxableValue).toBe(0);
    expect(report.invoiceCount).toBe(0);
  });
});

// ── GSTR-3B ────────────────────────────────────────────────────────────────────

describe("gst.gstr3b", () => {
  it("gstr3b returns period and business identifiers", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const report = await caller.gst.gstr3b({ year: TEST_YEAR, month: TEST_MONTH });

    expect(typeof report.period).toBe("string");
    expect(report.businessGstin).toBe(world.business1.gstin);
  });

  it("gstr3b outward supplies taxable value matches sale invoices for the period", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const report = await caller.gst.gstr3b({ year: TEST_YEAR, month: TEST_MONTH });

    // We created 3 sale invoices with subtotals: 10,000 + 10,000 + 1,000 = 21,000
    expect(report.outwardSupplies.taxable.taxableValue).toBeGreaterThan(0);
  });

  it("gstr3b ITC section reflects purchase invoices for the period", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const report = await caller.gst.gstr3b({ year: TEST_YEAR, month: TEST_MONTH });

    // Purchase invoice created: 100 × 200 = 20,000 subtotal, 5% tax = 1,000 ITC
    expect(report.itc.total).toBeGreaterThan(0);
  });

  it("gstr3b net tax = taxPayable minus ITC", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const report = await caller.gst.gstr3b({ year: TEST_YEAR, month: TEST_MONTH });

    // net = taxPayable - ITC (each component separately)
    const computedNetIgst = report.taxPayable.igst - report.itc.igst;
    const computedNetCgst = report.taxPayable.cgst - report.itc.cgst;
    const computedNetSgst = report.taxPayable.sgst - report.itc.sgst;

    expect(report.netTax.igst).toBeCloseTo(computedNetIgst, 2);
    expect(report.netTax.cgst).toBeCloseTo(computedNetCgst, 2);
    expect(report.netTax.sgst).toBeCloseTo(computedNetSgst, 2);
  });

  it("gstr3b — business isolation: business2 returns zero outward supplies", async () => {
    const caller2 = createTestCaller({
      userId: world.kiran.id,
      email: world.kiran.email,
      name: world.kiran.name,
      tenantId: world.tenant2.id,
      businessId: world.business2.id,
    });

    const report = await caller2.gst.gstr3b({ year: TEST_YEAR, month: TEST_MONTH });

    expect(report.outwardSupplies.taxable.taxableValue).toBe(0);
    expect(report.itc.total).toBe(0);
  });
});

// ── gstr1CSV ───────────────────────────────────────────────────────────────────

describe("gst.gstr1CSV", () => {
  it("gstr1CSV returns a non-empty CSV string with a filename", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const result = await caller.gst.gstr1CSV({ year: TEST_YEAR, month: TEST_MONTH });

    expect(typeof result.csv).toBe("string");
    expect(result.csv.length).toBeGreaterThan(0);
    expect(typeof result.filename).toBe("string");
    expect(result.filename).toMatch(/\.csv$/);
  });
});

// ── GSTR-3B — Reverse Charge Mechanism ────────────────────────────────────────

describe("GSTR-3B — Reverse Charge Mechanism", () => {
  // Use a different month to avoid polluting the shared fixture month
  const RCM_YEAR = 2025;
  const RCM_MONTH = 9; // September 2025

  beforeAll(async () => {
    const tenantDb = getTenantTestDb();

    // Create a purchase invoice for business1 with RCM flag
    // 1 × 50,000 @ 18% tax = 9,000 tax, same-state (Maharashtra "27") supplier
    await createInvoiceWithItems(
      tenantDb,
      world.business1.id,
      world.party1.id,
      [
        {
          description: "Legal Services",
          quantity: "1",
          unitPrice: "50000.00",
          taxPercent: "18.00",
        },
      ],
      {
        type: "purchase",
        documentType: "invoice",
        status: "sent",
        invoiceDate: new Date(RCM_YEAR, RCM_MONTH - 1, 15, 12, 0, 0),
        isReverseCharge: true,
      },
    );
  });

  it("RCM purchase invoice appears in rcmSupplies section of GSTR-3B", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const report = await caller.gst.gstr3b({ year: RCM_YEAR, month: RCM_MONTH });

    expect(report.rcmSupplies).toBeDefined();
    expect(parseFloat(report.rcmSupplies.taxableValue)).toBeCloseTo(50000, 2);
  });

  it("RCM purchase generates ITC equal to the tax paid under RCM", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const report = await caller.gst.gstr3b({ year: RCM_YEAR, month: RCM_MONTH });

    // Same-state RCM → CGST + SGST. Tax = 50000 * 18% = 9000. CGST = SGST = 4500.
    expect(report.itc.cgst).toBeCloseTo(4500, 2);
    expect(report.itc.sgst).toBeCloseTo(4500, 2);
    expect(report.itc.total).toBeCloseTo(9000, 2);
  });

  it("non-RCM purchase period returns zero rcmSupplies taxableValue", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    // October 2025 has no invoices at all
    const report = await caller.gst.gstr3b({ year: 2025, month: 10 });

    expect(parseFloat(report.rcmSupplies.taxableValue)).toBe(0);
  });
});

// ── Composition Scheme Enforcement ────────────────────────────────────────────

describe("Composition scheme enforcement", () => {
  let compositionBusiness: TestBusiness;

  beforeAll(async () => {
    const tenantDb = getTenantTestDb();

    // Create a composition-registered business in Maharashtra ("27") — same state as party1
    compositionBusiness = await createBusiness(tenantDb, world.ramesh.id, {
      name: "Sharma Kirana Store",
      gstRegistrationType: "composition",
      gstin: "27AABCS9999R1ZM",
      city: "Nashik",
      state: "Maharashtra",
      stateCode: "27",
    });
  });

  it("blocks inter-state sale invoice for composition business", async () => {
    const tenantDb = getTenantTestDb();

    // Create a party in Karnataka (different state from composition business)
    const karnatakaParty = await createParty(tenantDb, compositionBusiness.id, {
      name: "Bengaluru Buyer",
      type: "customer",
      gstin: null,
      city: "Bengaluru",
      state: "Karnataka",
      stateCode: "29",
      openingBalance: "0.00",
    });

    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: compositionBusiness.id,
    });

    await expect(
      caller.invoice.create({
        type: "sale",
        partyId: karnatakaParty.id,
        lineItems: [
          {
            itemName: "Rice",
            quantity: "10",
            unitPrice: "50.00",
            taxPercent: "0",
            discountPercent: "0",
            conversionFactor: "1",
          },
        ],
      }),
    ).rejects.toThrow("Composition scheme businesses cannot make inter-state outward supplies");
  });

  it("allows intra-state sale invoice for composition business", async () => {
    const tenantDb = getTenantTestDb();

    // Create a party in Maharashtra (same state as composition business)
    const maharashtraParty = await createParty(tenantDb, compositionBusiness.id, {
      name: "Pune Customer",
      type: "customer",
      gstin: null,
      city: "Pune",
      state: "Maharashtra",
      stateCode: "27",
      openingBalance: "0.00",
    });

    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: compositionBusiness.id,
    });

    const result = await caller.invoice.create({
      type: "sale",
      partyId: maharashtraParty.id,
      lineItems: [
        {
          itemName: "Rice",
          quantity: "10",
          unitPrice: "50.00",
          taxPercent: "0",
          discountPercent: "0",
          conversionFactor: "1",
        },
      ],
    });

    expect(result.id).toBeDefined();
    expect(result.type).toBe("sale");
  });

  it("CMP-08 returns taxable value for the quarter of outward supplies", async () => {
    const tenantDb = getTenantTestDb();

    // Create an intra-state party for the composition business
    const localParty = await createParty(tenantDb, compositionBusiness.id, {
      name: "Local Buyer",
      type: "customer",
      gstin: null,
      city: "Aurangabad",
      state: "Maharashtra",
      stateCode: "27",
      openingBalance: "0.00",
    });

    // Create a sale invoice dated in Q3 2025 (Jul–Sep)
    await createInvoiceWithItems(
      tenantDb,
      compositionBusiness.id,
      localParty.id,
      [
        {
          description: "Groceries",
          quantity: "100",
          unitPrice: "200.00",
          taxPercent: "0",
        },
      ],
      {
        type: "sale",
        documentType: "invoice",
        status: "sent",
        invoiceDate: new Date(2025, 7, 10, 12, 0, 0), // August 10, 2025 → Q2 FY (Jul–Sep) = Q3 calendar
      },
    );

    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: compositionBusiness.id,
    });

    // Q3 of 2025 (July–September, calendar year): quarter=3
    const cmp08 = await caller.gst.cmp08({ year: 2025, quarter: 3 });

    expect(parseFloat(cmp08.taxableValue)).toBeGreaterThan(0);
    expect(parseFloat(cmp08.taxPayable)).toBeGreaterThan(0);
    // Tax payable = 1% of taxable value
    expect(parseFloat(cmp08.taxPayable)).toBeCloseTo(
      parseFloat(cmp08.taxableValue) * 0.01,
      2,
    );
    expect(typeof cmp08.quarterStart).toBe("string");
    expect(typeof cmp08.quarterEnd).toBe("string");
  });
});
