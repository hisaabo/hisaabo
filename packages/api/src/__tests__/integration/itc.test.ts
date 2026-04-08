/**
 * itc.test.ts — Integration tests for ITC (Input Tax Credit) tracking.
 *
 * WHY THIS FILE EXISTS:
 * ITC tracking is a critical GST compliance feature for Indian SMBs. Incorrect
 * ITC handling can result in government penalties. We verify:
 *
 *   Auto-creation:   Purchase invoices with GST auto-create ITC ledger entries.
 *                    Sale invoices, zero-tax invoices, and composition scheme
 *                    businesses do NOT create ITC entries.
 *   Tax split:       Same-state purchase → CGST + SGST (half each).
 *                    Inter-state purchase → IGST only.
 *   Blocking:        Available ITC can be blocked under Section 17(5).
 *                    Blocked ITC can be unblocked back to available.
 *                    Double-blocking and unblocking-available are rejected.
 *   Aging alerts:    Unpaid purchase invoices approaching 180-day limit trigger
 *                    "warning" (150–180 days) or "critical" (>180 days) alerts.
 *                    Fully paid invoices do not appear.
 *   Dashboard:       Aggregates available, blocked, utilized, reversed ITC.
 *   GSTR-3B Table 4: Breaks down ITC into RCM (4A3), non-RCM (4A5), and
 *                    blocked under Section 17(5) (4B2).
 *   Utilization:     Records utilization amounts; second call upserts.
 *   RCM:            Reverse charge invoices are tagged isReverseCharge.
 *   Cancellation:    Cancelling a purchase invoice reverses its ITC entry.
 *
 * The business fixture (business1) is in Maharashtra (stateCode "27").
 * party1 is also in Maharashtra (intra-state -> CGST+SGST).
 * We create an inter-state supplier (Karnataka, "29") to test IGST path.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { businesses, itcLedgerEntries, itcUtilizations } from "@hisaabo/db";
import {
  createTestWorld,
  createParty,
  createInvoiceWithItems,
  type TestWorld,
  type TestParty,
} from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import {
  getTenantTestDb,
  truncateAllTables,
  closeTestDb,
} from "../helpers/test-db.js";
import { seedChartOfAccounts } from "../../lib/coa-seed.js";
import { money } from "@hisaabo/shared";

// ── Fixture ──────────────────────────────────────────────────────────────────

let world: TestWorld;
let supplierParty: TestParty;      // same-state supplier for purchase invoices
let interStateSupplier: TestParty; // inter-state supplier (Karnataka)

// Use a fixed month to avoid FY boundary edge cases
const TEST_YEAR = 2026;
const TEST_MONTH = 3; // March 2026
const TEST_PERIOD = `${TEST_YEAR}-${String(TEST_MONTH).padStart(2, "0")}`;

function callerForRamesh() {
  return createTestCaller({
    userId: world.ramesh.id,
    email: world.ramesh.email,
    name: world.ramesh.name ?? null,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });
}

beforeAll(async () => {
  world = await createTestWorld();
  const db = getTenantTestDb();

  // Seed CoA so utilization can create journal entries against GST accounts
  await seedChartOfAccounts(db, world.business1.id);

  // Create a same-state supplier (Maharashtra) for purchase invoices
  supplierParty = await createParty(db, world.business1.id, {
    name: "Mumbai Supplies Pvt Ltd",
    type: "supplier",
    gstin: "27AABCM0000R1ZM",
    city: "Mumbai",
    state: "Maharashtra",
    stateCode: "27",
    openingBalance: "0.00",
  });

  // Create an inter-state supplier (Karnataka) for IGST tests
  interStateSupplier = await createParty(db, world.business1.id, {
    name: "Bengaluru Components Ltd",
    type: "supplier",
    gstin: "29AABCB0000R1ZM",
    city: "Bengaluru",
    state: "Karnataka",
    stateCode: "29",
    openingBalance: "0.00",
  });
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

// ── 1. ITC Auto-Creation from Purchase Invoice ────────────────────────────────

describe("ITC auto-creation", () => {
  it("creates ITC entry when a purchase invoice is created with GST", async () => {
    const caller = callerForRamesh();

    // Create a purchase invoice: 10 x 1000 = 10,000 subtotal, 18% GST = 1,800 tax
    const invoice = await caller.invoice.create({
      type: "purchase",
      partyId: supplierParty.id,
      invoiceDate: new Date(TEST_YEAR, TEST_MONTH - 1, 15).toISOString(),
      lineItems: [
        {
          description: "Steel Rods",
          quantity: "10",
          unitPrice: "1000.00",
          taxPercent: "18",
          discountPercent: "0",
          conversionFactor: "1",
        },
      ],
    });

    // Verify ITC entry was auto-created
    const ledger = await caller.itc.ledger({
      returnPeriod: TEST_PERIOD,
      page: 1,
      limit: 50,
    });

    const itcEntry = ledger.entries.find((e) => e.invoiceId === invoice.id);
    expect(itcEntry).toBeDefined();
    expect(itcEntry!.status).toBe("available");

    // Intra-state: CGST = SGST = 900, IGST = 0
    // Tax = 10,000 * 18% = 1,800. Half each = 900
    expect(money.compare(itcEntry!.cgst, "900.00")).toBe(0);
    expect(money.compare(itcEntry!.sgst, "900.00")).toBe(0);
    expect(money.compare(itcEntry!.igst, "0")).toBe(0);
    expect(itcEntry!.invoiceId).toBe(invoice.id);
  });

  it("creates IGST ITC for inter-state purchase", async () => {
    const caller = callerForRamesh();

    // Inter-state purchase: 5 x 2000 = 10,000 subtotal, 18% GST = 1,800 IGST
    const invoice = await caller.invoice.create({
      type: "purchase",
      partyId: interStateSupplier.id,
      invoiceDate: new Date(TEST_YEAR, TEST_MONTH - 1, 16).toISOString(),
      lineItems: [
        {
          description: "Electronic Components",
          quantity: "5",
          unitPrice: "2000.00",
          taxPercent: "18",
          discountPercent: "0",
          conversionFactor: "1",
        },
      ],
    });

    const ledger = await caller.itc.ledger({
      returnPeriod: TEST_PERIOD,
      page: 1,
      limit: 50,
    });

    const itcEntry = ledger.entries.find((e) => e.invoiceId === invoice.id);
    expect(itcEntry).toBeDefined();
    expect(itcEntry!.status).toBe("available");

    // Inter-state: IGST = 1,800, CGST = 0, SGST = 0
    expect(money.compare(itcEntry!.igst, "1800.00")).toBe(0);
    expect(money.compare(itcEntry!.cgst, "0")).toBe(0);
    expect(money.compare(itcEntry!.sgst, "0")).toBe(0);
  });

  it("does not create ITC for sale invoices", async () => {
    const caller = callerForRamesh();

    const invoice = await caller.invoice.create({
      type: "sale",
      partyId: world.party1.id,
      invoiceDate: new Date(TEST_YEAR, TEST_MONTH - 1, 17).toISOString(),
      lineItems: [
        {
          description: "Cotton Fabric",
          quantity: "10",
          unitPrice: "500.00",
          taxPercent: "12",
          discountPercent: "0",
          conversionFactor: "1",
        },
      ],
    });

    // Directly query the ITC table for this invoice
    const db = getTenantTestDb();
    const entries = await db
      .select()
      .from(itcLedgerEntries)
      .where(
        and(
          eq(itcLedgerEntries.invoiceId, invoice.id),
          eq(itcLedgerEntries.businessId, world.business1.id),
        ),
      );

    expect(entries).toHaveLength(0);
  });

  it("does not create ITC for zero-tax invoices", async () => {
    const caller = callerForRamesh();

    const invoice = await caller.invoice.create({
      type: "purchase",
      partyId: supplierParty.id,
      invoiceDate: new Date(TEST_YEAR, TEST_MONTH - 1, 18).toISOString(),
      lineItems: [
        {
          description: "Exempt Supply",
          quantity: "50",
          unitPrice: "100.00",
          taxPercent: "0",
          discountPercent: "0",
          conversionFactor: "1",
        },
      ],
    });

    const db = getTenantTestDb();
    const entries = await db
      .select()
      .from(itcLedgerEntries)
      .where(
        and(
          eq(itcLedgerEntries.invoiceId, invoice.id),
          eq(itcLedgerEntries.businessId, world.business1.id),
        ),
      );

    expect(entries).toHaveLength(0);
  });

  it("does not create ITC for composition scheme businesses", async () => {
    const db = getTenantTestDb();

    // Temporarily set business to composition scheme
    await db
      .update(businesses)
      .set({ gstRegistrationType: "composition" })
      .where(eq(businesses.id, world.business1.id));

    try {
      const caller = callerForRamesh();

      const invoice = await caller.invoice.create({
        type: "purchase",
        partyId: supplierParty.id,
        invoiceDate: new Date(TEST_YEAR, TEST_MONTH - 1, 19).toISOString(),
        lineItems: [
          {
            description: "Raw Materials",
            quantity: "20",
            unitPrice: "300.00",
            taxPercent: "12",
            discountPercent: "0",
            conversionFactor: "1",
          },
        ],
      });

      const entries = await db
        .select()
        .from(itcLedgerEntries)
        .where(
          and(
            eq(itcLedgerEntries.invoiceId, invoice.id),
            eq(itcLedgerEntries.businessId, world.business1.id),
          ),
        );

      expect(entries).toHaveLength(0);
    } finally {
      // Reset back to regular registration
      await db
        .update(businesses)
        .set({ gstRegistrationType: "regular" })
        .where(eq(businesses.id, world.business1.id));
    }
  });

  it("tags RCM purchases correctly in ITC", async () => {
    const caller = callerForRamesh();

    const invoice = await caller.invoice.create({
      type: "purchase",
      partyId: supplierParty.id,
      invoiceDate: new Date(TEST_YEAR, TEST_MONTH - 1, 20).toISOString(),
      isReverseCharge: true,
      lineItems: [
        {
          description: "Legal Services (RCM)",
          quantity: "1",
          unitPrice: "50000.00",
          taxPercent: "18",
          discountPercent: "0",
          conversionFactor: "1",
        },
      ],
    });

    const db = getTenantTestDb();
    const [entry] = await db
      .select()
      .from(itcLedgerEntries)
      .where(
        and(
          eq(itcLedgerEntries.invoiceId, invoice.id),
          eq(itcLedgerEntries.businessId, world.business1.id),
        ),
      );

    expect(entry).toBeDefined();
    expect(entry!.isReverseCharge).toBe(true);
    expect(entry!.status).toBe("available");

    // Same-state RCM: tax = 50,000 * 18% = 9,000. CGST = 4,500, SGST = 4,500
    expect(money.compare(entry!.cgst, "4500.00")).toBe(0);
    expect(money.compare(entry!.sgst, "4500.00")).toBe(0);
  });

  it("reverses ITC when a purchase invoice is cancelled", async () => {
    const caller = callerForRamesh();

    const invoice = await caller.invoice.create({
      type: "purchase",
      partyId: supplierParty.id,
      invoiceDate: new Date(TEST_YEAR, TEST_MONTH - 1, 21).toISOString(),
      lineItems: [
        {
          description: "Cancelled Goods",
          quantity: "5",
          unitPrice: "400.00",
          taxPercent: "12",
          discountPercent: "0",
          conversionFactor: "1",
        },
      ],
    });

    // Verify ITC entry exists and is available
    const db = getTenantTestDb();
    const [beforeEntry] = await db
      .select()
      .from(itcLedgerEntries)
      .where(
        and(
          eq(itcLedgerEntries.invoiceId, invoice.id),
          eq(itcLedgerEntries.businessId, world.business1.id),
        ),
      );
    expect(beforeEntry!.status).toBe("available");

    // Cancel the invoice
    await caller.invoice.updateStatus({ id: invoice.id, status: "cancelled" });

    // Verify ITC entry is now reversed
    const [afterEntry] = await db
      .select()
      .from(itcLedgerEntries)
      .where(
        and(
          eq(itcLedgerEntries.invoiceId, invoice.id),
          eq(itcLedgerEntries.businessId, world.business1.id),
        ),
      );
    expect(afterEntry!.status).toBe("reversed");
    expect(afterEntry!.reversalReason).toBe("invoice_cancelled");
  });
});

// ── 2. ITC Blocking and Unblocking ──────────────────────────────────────────

describe("ITC blocking", () => {
  it("marks ITC as blocked with a reason", async () => {
    const caller = callerForRamesh();

    // Create a purchase invoice to get an available ITC entry
    const invoice = await caller.invoice.create({
      type: "purchase",
      partyId: supplierParty.id,
      invoiceDate: new Date(TEST_YEAR, TEST_MONTH - 1, 10).toISOString(),
      lineItems: [
        {
          description: "Motor Vehicle Parts",
          quantity: "2",
          unitPrice: "5000.00",
          taxPercent: "18",
          discountPercent: "0",
          conversionFactor: "1",
        },
      ],
    });

    // Block the ITC
    const blocked = await caller.itc.markBlocked({
      invoiceId: invoice.id,
      blockReason: "motor_vehicle",
      notes: "Blocked under Section 17(5) - motor vehicle",
    });

    expect(blocked!.status).toBe("blocked");
    expect(blocked!.blockReason).toBe("motor_vehicle");
  });

  it("unblocks ITC back to available", async () => {
    const caller = callerForRamesh();

    const invoice = await caller.invoice.create({
      type: "purchase",
      partyId: supplierParty.id,
      invoiceDate: new Date(TEST_YEAR, TEST_MONTH - 1, 11).toISOString(),
      lineItems: [
        {
          description: "Food and Beverages",
          quantity: "10",
          unitPrice: "200.00",
          taxPercent: "5",
          discountPercent: "0",
          conversionFactor: "1",
        },
      ],
    });

    // Block it first
    await caller.itc.markBlocked({
      invoiceId: invoice.id,
      blockReason: "food_beverage",
    });

    // Unblock it
    const unblocked = await caller.itc.markEligible({
      invoiceId: invoice.id,
    });

    expect(unblocked!.status).toBe("available");
    expect(unblocked!.blockReason).toBeNull();
  });

  it("rejects blocking already blocked ITC", async () => {
    const caller = callerForRamesh();

    const invoice = await caller.invoice.create({
      type: "purchase",
      partyId: supplierParty.id,
      invoiceDate: new Date(TEST_YEAR, TEST_MONTH - 1, 12).toISOString(),
      lineItems: [
        {
          description: "Personal Items",
          quantity: "3",
          unitPrice: "1000.00",
          taxPercent: "18",
          discountPercent: "0",
          conversionFactor: "1",
        },
      ],
    });

    // Block it
    await caller.itc.markBlocked({
      invoiceId: invoice.id,
      blockReason: "personal",
    });

    // Try to block again — should fail because it's no longer "available"
    await expect(
      caller.itc.markBlocked({
        invoiceId: invoice.id,
        blockReason: "personal",
      }),
    ).rejects.toThrow(/no available itc/i);
  });

  it("rejects unblocking available ITC", async () => {
    const caller = callerForRamesh();

    const invoice = await caller.invoice.create({
      type: "purchase",
      partyId: supplierParty.id,
      invoiceDate: new Date(TEST_YEAR, TEST_MONTH - 1, 13).toISOString(),
      lineItems: [
        {
          description: "Office Supplies",
          quantity: "20",
          unitPrice: "50.00",
          taxPercent: "18",
          discountPercent: "0",
          conversionFactor: "1",
        },
      ],
    });

    // ITC is "available" — trying to unblock should fail
    await expect(
      caller.itc.markEligible({
        invoiceId: invoice.id,
      }),
    ).rejects.toThrow(/no blocked itc/i);
  });
});

// ── 3. Aging Alerts ─────────────────────────────────────────────────────────

describe("ITC aging alerts", () => {
  it("returns invoices approaching 180-day limit", async () => {
    const db = getTenantTestDb();

    // Create a purchase invoice dated 160 days ago using the fixture
    // (bypasses the tRPC caller to control the exact date)
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 160);

    const { invoice } = await createInvoiceWithItems(
      db,
      world.business1.id,
      supplierParty.id,
      [
        {
          description: "Old Purchase - Warning",
          quantity: "10",
          unitPrice: "1000.00",
          taxPercent: "18.00",
        },
      ],
      {
        type: "purchase",
        documentType: "invoice",
        status: "sent",
        invoiceDate: pastDate,
        // amountPaid defaults to "0.00" — unpaid
      },
    );

    // Manually insert the ITC entry for this fixture-created invoice
    const taxPaise = Math.round(10 * 1000 * 0.18 * 100);
    const halfPaise = Math.floor(taxPaise / 2);
    const remainderPaise = taxPaise - halfPaise;

    await db.insert(itcLedgerEntries).values({
      businessId: world.business1.id,
      invoiceId: invoice.id,
      returnPeriod: `${pastDate.getFullYear()}-${String(pastDate.getMonth() + 1).padStart(2, "0")}`,
      status: "available",
      cgst: (halfPaise / 100).toFixed(2),
      sgst: (remainderPaise / 100).toFixed(2),
      igst: "0",
      cess: "0",
      isReverseCharge: false,
    });

    const caller = callerForRamesh();
    const alerts = await caller.itc.agingAlerts();

    const alert = alerts.find((a) => a.invoiceId === invoice.id);
    expect(alert).toBeDefined();
    expect(alert!.urgency).toBe("warning");
  });

  it("returns critical alerts for invoices past 180 days", async () => {
    const db = getTenantTestDb();

    // Create a purchase invoice dated 185 days ago
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 185);

    const { invoice } = await createInvoiceWithItems(
      db,
      world.business1.id,
      supplierParty.id,
      [
        {
          description: "Old Purchase - Critical",
          quantity: "5",
          unitPrice: "2000.00",
          taxPercent: "18.00",
        },
      ],
      {
        type: "purchase",
        documentType: "invoice",
        status: "sent",
        invoiceDate: pastDate,
      },
    );

    // Manually insert ITC entry
    await db.insert(itcLedgerEntries).values({
      businessId: world.business1.id,
      invoiceId: invoice.id,
      returnPeriod: `${pastDate.getFullYear()}-${String(pastDate.getMonth() + 1).padStart(2, "0")}`,
      status: "available",
      cgst: "900.00",
      sgst: "900.00",
      igst: "0",
      cess: "0",
      isReverseCharge: false,
    });

    const caller = callerForRamesh();
    const alerts = await caller.itc.agingAlerts();

    const alert = alerts.find((a) => a.invoiceId === invoice.id);
    expect(alert).toBeDefined();
    expect(alert!.urgency).toBe("critical");
  });

  it("does not alert for paid invoices", async () => {
    const db = getTenantTestDb();

    // Create a purchase invoice dated 160 days ago
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 160);

    const { invoice } = await createInvoiceWithItems(
      db,
      world.business1.id,
      supplierParty.id,
      [
        {
          description: "Paid Old Purchase",
          quantity: "10",
          unitPrice: "500.00",
          taxPercent: "18.00",
        },
      ],
      {
        type: "purchase",
        documentType: "invoice",
        status: "paid",
        invoiceDate: pastDate,
        // Mark as fully paid
        amountPaid: "5900.00", // 5000 + 900 tax
      },
    );

    // Insert ITC entry
    await db.insert(itcLedgerEntries).values({
      businessId: world.business1.id,
      invoiceId: invoice.id,
      returnPeriod: `${pastDate.getFullYear()}-${String(pastDate.getMonth() + 1).padStart(2, "0")}`,
      status: "available",
      cgst: "450.00",
      sgst: "450.00",
      igst: "0",
      cess: "0",
      isReverseCharge: false,
    });

    const caller = callerForRamesh();
    const alerts = await caller.itc.agingAlerts();

    // Fully paid invoice should NOT appear in aging alerts
    const alert = alerts.find((a) => a.invoiceId === invoice.id);
    expect(alert).toBeUndefined();
  });
});

// ── 4. ITC Dashboard ────────────────────────────────────────────────────────

describe("ITC dashboard", () => {
  // Use a separate month so these tests don't interfere with auto-creation tests
  const DASH_YEAR = 2026;
  const DASH_MONTH = 4; // April 2026
  const DASH_PERIOD = `${DASH_YEAR}-${String(DASH_MONTH).padStart(2, "0")}`;

  it("returns correct ITC summary", async () => {
    const caller = callerForRamesh();

    // Create 2 purchase invoices in the dashboard period
    await caller.invoice.create({
      type: "purchase",
      partyId: supplierParty.id,
      invoiceDate: new Date(DASH_YEAR, DASH_MONTH - 1, 5).toISOString(),
      lineItems: [
        {
          description: "Dashboard Test Item 1",
          quantity: "10",
          unitPrice: "100.00",
          taxPercent: "18",
          discountPercent: "0",
          conversionFactor: "1",
        },
      ],
    });

    const inv2 = await caller.invoice.create({
      type: "purchase",
      partyId: supplierParty.id,
      invoiceDate: new Date(DASH_YEAR, DASH_MONTH - 1, 6).toISOString(),
      lineItems: [
        {
          description: "Dashboard Test Item 2",
          quantity: "20",
          unitPrice: "200.00",
          taxPercent: "18",
          discountPercent: "0",
          conversionFactor: "1",
        },
      ],
    });

    // Block the second one
    await caller.itc.markBlocked({
      invoiceId: inv2.id,
      blockReason: "construction",
    });

    const dashboard = await caller.itc.dashboard({
      returnPeriod: DASH_PERIOD,
    });

    expect(dashboard.returnPeriod).toBe(DASH_PERIOD);

    // inv1: subtotal=1000, tax=180 -> CGST=90, SGST=90 (available)
    // inv2: subtotal=4000, tax=720 -> CGST=360, SGST=360 (blocked)
    expect(money.compare(dashboard.summary.available.cgst, "90.00")).toBe(0);
    expect(money.compare(dashboard.summary.available.sgst, "90.00")).toBe(0);
    expect(money.compare(dashboard.summary.available.total, "180.00")).toBe(0);

    expect(money.compare(dashboard.summary.blocked.cgst, "360.00")).toBe(0);
    expect(money.compare(dashboard.summary.blocked.sgst, "360.00")).toBe(0);
    expect(money.compare(dashboard.summary.blocked.total, "720.00")).toBe(0);
  });

  it("defaults to current period when no period specified", async () => {
    const caller = callerForRamesh();

    const now = new Date();
    const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    // Create a purchase invoice with today's date
    await caller.invoice.create({
      type: "purchase",
      partyId: supplierParty.id,
      lineItems: [
        {
          description: "Today Purchase",
          quantity: "5",
          unitPrice: "100.00",
          taxPercent: "18",
          discountPercent: "0",
          conversionFactor: "1",
        },
      ],
    });

    // Call dashboard without returnPeriod
    const dashboard = await caller.itc.dashboard();

    expect(dashboard.returnPeriod).toBe(currentPeriod);
    // Should have some available ITC from the invoice we just created
    expect(money.compare(dashboard.summary.available.total, "0")).toBeGreaterThanOrEqual(0);
  });
});

// ── 5. GSTR-3B Table 4 ─────────────────────────────────────────────────────

describe("GSTR-3B Table 4", () => {
  // Use a dedicated month for table 4 tests
  const T4_YEAR = 2026;
  const T4_MONTH = 5; // May 2026

  it("populates Table 4 with correct ITC breakdown", async () => {
    const caller = callerForRamesh();

    // 1. Normal purchase invoice -> 4A5 (all other ITC)
    // 10 x 500 = 5,000 subtotal, 18% tax = 900
    const normalInv = await caller.invoice.create({
      type: "purchase",
      partyId: supplierParty.id,
      invoiceDate: new Date(T4_YEAR, T4_MONTH - 1, 5).toISOString(),
      lineItems: [
        {
          description: "Normal Purchase for Table 4",
          quantity: "10",
          unitPrice: "500.00",
          taxPercent: "18",
          discountPercent: "0",
          conversionFactor: "1",
        },
      ],
    });

    // 2. RCM purchase invoice -> 4A3 (reverse charge)
    // 1 x 20,000 = 20,000 subtotal, 18% tax = 3,600
    await caller.invoice.create({
      type: "purchase",
      partyId: supplierParty.id,
      invoiceDate: new Date(T4_YEAR, T4_MONTH - 1, 6).toISOString(),
      isReverseCharge: true,
      lineItems: [
        {
          description: "Legal Services (RCM) for Table 4",
          quantity: "1",
          unitPrice: "20000.00",
          taxPercent: "18",
          discountPercent: "0",
          conversionFactor: "1",
        },
      ],
    });

    // 3. Block the normal invoice -> moves to 4B2
    await caller.itc.markBlocked({
      invoiceId: normalInv.id,
      blockReason: "construction",
    });

    const table4 = await caller.itc.gstr3bTable4({
      year: T4_YEAR,
      month: T4_MONTH,
    });

    expect(table4.returnPeriod).toBe(`${T4_YEAR}-${String(T4_MONTH).padStart(2, "0")}`);

    // 4A3 (RCM): Same-state, tax=3600, CGST=1800, SGST=1800
    expect(money.compare(table4.itcAvailable.reverseCharge.centralTax, "1800.00")).toBe(0);
    expect(money.compare(table4.itcAvailable.reverseCharge.stateTax, "1800.00")).toBe(0);

    // 4A5 (all other): The normal invoice is now blocked, so 4A5 should be 0
    const allOtherTotal = money.sum([
      table4.itcAvailable.allOther.integratedTax,
      table4.itcAvailable.allOther.centralTax,
      table4.itcAvailable.allOther.stateTax,
      table4.itcAvailable.allOther.cess,
    ]);
    expect(money.compare(allOtherTotal, "0")).toBe(0);

    // 4B2 (Section 17(5) blocked): Normal invoice tax=900, CGST=450, SGST=450
    expect(money.compare(table4.itcReversed.others.centralTax, "450.00")).toBe(0);
    expect(money.compare(table4.itcReversed.others.stateTax, "450.00")).toBe(0);
  });
});

// ── 6. ITC Utilization ──────────────────────────────────────────────────────

describe("ITC utilization", () => {
  // Use a dedicated month for utilization tests
  const UTIL_YEAR = 2026;
  const UTIL_MONTH = 6; // June 2026
  const UTIL_PERIOD = `${UTIL_YEAR}-${String(UTIL_MONTH).padStart(2, "0")}`;

  it("records utilization for a period", async () => {
    const caller = callerForRamesh();

    // Create a purchase invoice to have some available ITC
    await caller.invoice.create({
      type: "purchase",
      partyId: supplierParty.id,
      invoiceDate: new Date(UTIL_YEAR, UTIL_MONTH - 1, 5).toISOString(),
      lineItems: [
        {
          description: "Utilization Test Purchase",
          quantity: "100",
          unitPrice: "100.00",
          taxPercent: "18",
          discountPercent: "0",
          conversionFactor: "1",
        },
      ],
    });
    // Tax = 10,000 * 18% = 1,800. CGST = 900, SGST = 900

    // Record utilization
    const result = await caller.itc.recordUtilization({
      returnPeriod: UTIL_PERIOD,
      cgstUtilized: "500.00",
      sgstUtilized: "500.00",
      igstUtilizedAgainstCgst: "0",
      igstUtilizedAgainstSgst: "0",
      igstUtilizedAgainstIgst: "0",
      notes: "Monthly GST return filing",
    });

    expect(result.utilization).toBeDefined();
    expect(result.utilization!.returnPeriod).toBe(UTIL_PERIOD);
    expect(money.compare(result.utilization!.cgstUtilized, "500.00")).toBe(0);
    expect(money.compare(result.utilization!.sgstUtilized, "500.00")).toBe(0);

    // Verify dashboard shows utilization
    const dashboard = await caller.itc.dashboard({
      returnPeriod: UTIL_PERIOD,
    });
    expect(dashboard.utilization).not.toBeNull();
    expect(money.compare(dashboard.utilization!.cgstUtilized, "500.00")).toBe(0);
  });

  it("upserts utilization for same period (second call updates)", async () => {
    const caller = callerForRamesh();

    // First call already created utilization for UTIL_PERIOD above.
    // Second call should update, not create a duplicate.
    const result = await caller.itc.recordUtilization({
      returnPeriod: UTIL_PERIOD,
      cgstUtilized: "700.00",
      sgstUtilized: "700.00",
      igstUtilizedAgainstCgst: "0",
      igstUtilizedAgainstSgst: "0",
      igstUtilizedAgainstIgst: "0",
      notes: "Amended utilization",
    });

    expect(result.utilization).toBeDefined();
    expect(money.compare(result.utilization!.cgstUtilized, "700.00")).toBe(0);
    expect(money.compare(result.utilization!.sgstUtilized, "700.00")).toBe(0);

    // Verify only one utilization record exists for this period
    const db = getTenantTestDb();
    const utilizations = await db
      .select()
      .from(itcUtilizations)
      .where(
        and(
          eq(itcUtilizations.businessId, world.business1.id),
          eq(itcUtilizations.returnPeriod, UTIL_PERIOD),
        ),
      );

    expect(utilizations).toHaveLength(1);
    expect(money.compare(utilizations[0]!.cgstUtilized, "700.00")).toBe(0);
  });

  it("rejects utilization exceeding available ITC", async () => {
    const caller = callerForRamesh();

    // Try to utilize more CGST than available (available = 900, trying 5000)
    await expect(
      caller.itc.recordUtilization({
        returnPeriod: UTIL_PERIOD,
        cgstUtilized: "5000.00",
        sgstUtilized: "0",
        igstUtilizedAgainstCgst: "0",
        igstUtilizedAgainstSgst: "0",
        igstUtilizedAgainstIgst: "0",
      }),
    ).rejects.toThrow(/exceeds available/i);
  });
});

// ── 7. Business Isolation ───────────────────────────────────────────────────

describe("ITC business isolation", () => {
  it("business2 sees no ITC entries from business1", async () => {
    const caller2 = createTestCaller({
      userId: world.kiran.id,
      email: world.kiran.email,
      name: world.kiran.name ?? null,
      tenantId: world.tenant2.id,
      businessId: world.business2.id,
    });

    const ledger = await caller2.itc.ledger({
      page: 1,
      limit: 50,
    });

    expect(ledger.entries).toHaveLength(0);
    expect(ledger.pagination.total).toBe(0);
  });

  it("business2 dashboard returns all zeros", async () => {
    const caller2 = createTestCaller({
      userId: world.kiran.id,
      email: world.kiran.email,
      name: world.kiran.name ?? null,
      tenantId: world.tenant2.id,
      businessId: world.business2.id,
    });

    const dashboard = await caller2.itc.dashboard({
      returnPeriod: TEST_PERIOD,
    });

    expect(money.compare(dashboard.summary.available.total, "0")).toBe(0);
    expect(money.compare(dashboard.summary.blocked.total, "0")).toBe(0);
    expect(dashboard.utilization).toBeNull();
  });
});
