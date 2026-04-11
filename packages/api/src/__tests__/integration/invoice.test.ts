/**
 * Integration tests for the invoice router.
 *
 * WHY THIS FILE EXISTS:
 * The invoice router is the most business-critical path in Hisaabo — it
 * simultaneously validates party/item ownership, auto-increments the invoice
 * counter atomically, computes fixed-point totals, adjusts item stock, and
 * writes an audit log entry. A single bug in any of these steps can corrupt
 * inventory, produce duplicate invoice numbers, or leak data across businesses.
 *
 * These tests exercise the FULL middleware chain (isAuthenticated →
 * hasTenantAccess → hasBusinessAccess → withPermissions → business logic → DB)
 * against a real PostgreSQL test database, giving us confidence that the
 * end-to-end flow behaves correctly — something unit tests alone cannot verify.
 *
 * KEY FINDINGS FROM CODE REVIEW:
 *   - invoice.delete does NOT reverse stock (by design in invoice router).
 *     The document-factory router DOES reverse stock on delete. This asymmetry
 *     is intentional and is documented as a test case so it is never silently
 *     "fixed" without understanding the trade-off.
 *   - invoice.updateStatus has no state-machine guard — any status → any status
 *     is allowed. Tests capture this current behaviour.
 *   - The overpayment guard lives in payment.create, not invoice.create.
 *
 * TEST ORGANISATION:
 *   - Each describe block is one procedure.
 *   - Tests use createTestWorld() once per describe (not per test) for speed.
 *   - Destructive tests (delete) use locally-created invoices to avoid
 *     polluting other tests in the same describe.
 *   - afterAll cleans up via truncateAllTables().
 *
 * RUNNING:
 *   pnpm --filter @hisaabo/api test -- --testPathPattern integration
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { invoices, invoiceItems, items, businesses } from "@hisaabo/db";
import { calcLineItem, calcInvoiceTotals } from "@hisaabo/shared";
import {
  createTestWorld,
  createItem,
  createParty,
  type TestWorld,
} from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";

// ── Shared fixture ─────────────────────────────────────────────────────────────

let world: TestWorld;

beforeAll(async () => {
  world = await createTestWorld();
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

// ── Caller helpers ─────────────────────────────────────────────────────────────

function callerForRamesh() {
  return createTestCaller({
    userId: world.ramesh.id,
    email: world.ramesh.email,
    name: world.ramesh.name ?? null,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });
}

function callerForKiran() {
  return createTestCaller({
    userId: world.kiran.id,
    email: world.kiran.email,
    name: world.kiran.name ?? null,
    tenantId: world.tenant2.id,
    businessId: world.business2.id,
  });
}

// ── Helper: base sale invoice input ───────────────────────────────────────────

function baseSaleInput(partyId: string, lineItems: Array<{
  itemId?: string;
  /**
   * Either pass `itemName` (post Bug B) or the legacy `description` field —
   * the helper maps `description` → `itemName` so existing test bodies keep
   * compiling without sweeping rewrites. Tests that need to exercise the
   * new optional notes column should use `notes`.
   */
  itemName?: string;
  description?: string;
  notes?: string | null;
  quantity: string;
  unitPrice: string;
  taxPercent?: string;
  discountPercent?: string;
  conversionFactor?: string;
  variantId?: string;
}>) {
  return {
    partyId,
    type: "sale" as const,
    invoiceDate: new Date().toISOString(),
    lineItems: lineItems.map((li) => ({
      itemName: li.itemName ?? li.description ?? "Test Line",
      description: li.notes ?? null,
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      taxPercent: li.taxPercent ?? "0",
      discountPercent: li.discountPercent ?? "0",
      conversionFactor: li.conversionFactor ?? null,
      variantId: li.variantId ?? null,
      itemId: li.itemId,
    })),
  };
}

// =============================================================================
// invoice.create
// =============================================================================

describe("invoice.create", () => {
  it("creates a sale invoice with 3 line items and verifies totals via fixed-point arithmetic", async () => {
    const caller = callerForRamesh();

    const lineItems = [
      { description: "Cotton Fabric 40s", quantity: "10", unitPrice: "250.00", taxPercent: "5.00", discountPercent: "0", itemId: world.item1.id },
      { description: "Cotton Fabric 60s", quantity: "5", unitPrice: "300.00", taxPercent: "5.00", discountPercent: "0" },
      { description: "Dyeing Charges", quantity: "1", unitPrice: "500.00", taxPercent: "18.00", discountPercent: "0" },
    ];

    const result = await caller.invoice.create(baseSaleInput(world.party1.id, lineItems));

    // Verify document type and initial status
    expect(result.documentType).toBe("invoice");
    expect(result.status).toBe("draft");
    expect(result.type).toBe("sale");

    // Verify totals using the same fixed-point helper the router uses
    const expected = calcInvoiceTotals({
      lineItems: lineItems.map((li) => ({
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        taxPercent: li.taxPercent,
        discountPercent: li.discountPercent,
      })),
    });

    expect(result.subtotal).toBe(expected.subtotal);
    expect(result.taxAmount).toBe(expected.taxTotal);
    expect(result.totalAmount).toBe(expected.total);
  });

  it("auto-generates invoice number in INV-NNNNN format and atomically increments the counter", async () => {
    const caller = callerForRamesh();

    // Read the current counter before creating
    const db = getTenantTestDb();
    const [bizBefore] = await db.select({ nextNum: businesses.nextInvoiceNumber })
      .from(businesses)
      .where(eq(businesses.id, world.business1.id));

    const result = await caller.invoice.create(
      baseSaleInput(world.party1.id, [
        { description: "Widget", quantity: "1", unitPrice: "100.00" },
      ])
    );

    // Invoice number must match the prefix + zero-padded counter format
    expect(result.invoiceNumber).toMatch(/^INV-\d{5}$/);

    // The number's integer suffix must equal the counter we read before creation
    const numericSuffix = parseInt(result.invoiceNumber.split("-")[1]!, 10);
    expect(numericSuffix).toBe(bizBefore!.nextNum);

    // Counter must have been incremented by exactly 1
    const [bizAfter] = await db.select({ nextNum: businesses.nextInvoiceNumber })
      .from(businesses)
      .where(eq(businesses.id, world.business1.id));

    expect(bizAfter!.nextNum).toBe(bizBefore!.nextNum + 1);
  });

  it("decrements stock for each sale invoice line item linked to an item", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    // Read stock before
    const [itemBefore] = await db.select({ stockQuantity: items.stockQuantity })
      .from(items)
      .where(eq(items.id, world.item1.id));
    const stockBefore = parseFloat(itemBefore!.stockQuantity);

    const qty = "7";
    await caller.invoice.create(
      baseSaleInput(world.party1.id, [
        { itemId: world.item1.id, description: "Cotton Fabric", quantity: qty, unitPrice: "250.00", taxPercent: "5.00" },
      ])
    );

    // Stock must have decreased by exactly the quantity sold
    const [itemAfter] = await db.select({ stockQuantity: items.stockQuantity })
      .from(items)
      .where(eq(items.id, world.item1.id));
    const stockAfter = parseFloat(itemAfter!.stockQuantity);

    expect(stockAfter).toBeCloseTo(stockBefore - parseFloat(qty), 3);
  });

  it("increments stock when creating a purchase invoice (supplier receiving goods)", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    // Create a supplier party for this test
    const supplier = await createParty(db, world.business1.id, {
      type: "supplier",
      name: "Cotton Mills Ltd",
    });

    const [itemBefore] = await db.select({ stockQuantity: items.stockQuantity })
      .from(items)
      .where(eq(items.id, world.item1.id));
    const stockBefore = parseFloat(itemBefore!.stockQuantity);

    const purchaseQty = "20";
    await caller.invoice.create({
      partyId: supplier.id,
      type: "purchase",
      invoiceDate: new Date().toISOString(),
      lineItems: [
        {
          itemId: world.item1.id,
          itemName: "Cotton Fabric (purchase)",
          quantity: purchaseQty,
          unitPrice: "200.00",
          taxPercent: "5.00",
          discountPercent: "0",
          conversionFactor: null,
          variantId: null,
        },
      ],
    });

    const [itemAfter] = await db.select({ stockQuantity: items.stockQuantity })
      .from(items)
      .where(eq(items.id, world.item1.id));
    const stockAfter = parseFloat(itemAfter!.stockQuantity);

    expect(stockAfter).toBeCloseTo(stockBefore + parseFloat(purchaseQty), 3);
  });

  it("applies conversion factor for alt-unit items — stock decremented by qty * conversionFactor", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    // Create an item with alt_units mode (e.g. rice sold in bags, stock tracked in kg)
    const riceItem = await createItem(db, world.business1.id, {
      name: "Basmati Rice",
      unit: "kg",
      itemMode: "alt_units",
      stockQuantity: "500.000",
      taxPercent: "0.00",
    });

    const [before] = await db.select({ stockQuantity: items.stockQuantity })
      .from(items)
      .where(eq(items.id, riceItem.id));
    const stockBefore = parseFloat(before!.stockQuantity);

    // Selling 2 bags, each bag = 25 kg — conversionFactor = "25"
    await caller.invoice.create(
      baseSaleInput(world.party1.id, [
        {
          itemId: riceItem.id,
          description: "Basmati Rice (25kg bag)",
          quantity: "2",
          unitPrice: "1500.00",
          conversionFactor: "25",
        },
      ])
    );

    const [after] = await db.select({ stockQuantity: items.stockQuantity })
      .from(items)
      .where(eq(items.id, riceItem.id));
    const stockAfter = parseFloat(after!.stockQuantity);

    // 2 bags * 25 kg/bag = 50 kg deducted
    expect(stockAfter).toBeCloseTo(stockBefore - 50, 3);
  });

  it("skipStockAdjustment=true does not modify stock — used when converting challan to invoice", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const [before] = await db.select({ stockQuantity: items.stockQuantity })
      .from(items)
      .where(eq(items.id, world.item1.id));
    const stockBefore = parseFloat(before!.stockQuantity);

    await caller.invoice.create({
      partyId: world.party1.id,
      type: "sale",
      invoiceDate: new Date().toISOString(),
      skipStockAdjustment: true,
      lineItems: [
        {
          itemId: world.item1.id,
          itemName: "Challan conversion — stock already decremented",
          quantity: "5",
          unitPrice: "250.00",
          taxPercent: "0",
          discountPercent: "0",
          conversionFactor: null,
          variantId: null,
        },
      ],
    });

    const [after] = await db.select({ stockQuantity: items.stockQuantity })
      .from(items)
      .where(eq(items.id, world.item1.id));
    const stockAfter = parseFloat(after!.stockQuantity);

    // Stock must be unchanged
    expect(stockAfter).toBeCloseTo(stockBefore, 3);
  });

  it("line item totals match calcLineItem for an item with discount and tax", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const lineItemInput = {
      description: "Fabric with discount",
      quantity: "10",
      unitPrice: "100.00",
      taxPercent: "18.00",
      discountPercent: "5.00",
    };

    const result = await caller.invoice.create(
      baseSaleInput(world.party1.id, [lineItemInput])
    );

    const expected = calcLineItem({
      quantity: lineItemInput.quantity,
      unitPrice: lineItemInput.unitPrice,
      taxPercent: lineItemInput.taxPercent,
      discountPercent: lineItemInput.discountPercent,
    });

    // Verify the stored invoice line item matches fixed-point calculation
    const lineItems = await db.select()
      .from(invoiceItems)
      .where(eq(invoiceItems.invoiceId, result.id));

    expect(lineItems).toHaveLength(1);
    const li = lineItems[0]!;
    expect(li.taxAmount).toBe(expected.taxAmount);
    expect(li.totalAmount).toBe(expected.total);
  });

  it("opening balance on party is NOT affected by invoice creation", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const { parties } = await import("@hisaabo/db");

    // Read party opening balance before invoice
    const [partyBefore] = await db.select({ openingBalance: parties.openingBalance })
      .from(parties)
      .where(eq(parties.id, world.party1.id));

    await caller.invoice.create(
      baseSaleInput(world.party1.id, [
        { description: "Test Item", quantity: "1", unitPrice: "1000.00" },
      ])
    );

    const [partyAfter] = await db.select({ openingBalance: parties.openingBalance })
      .from(parties)
      .where(eq(parties.id, world.party1.id));

    expect(partyAfter!.openingBalance).toBe(partyBefore!.openingBalance);
  });

  it("rejects invoice creation when party belongs to a different business — cross-business guard", async () => {
    const caller = callerForRamesh();

    // party2 belongs to business2 (kiran's business), not business1 (ramesh's)
    await expect(
      caller.invoice.create(
        baseSaleInput(world.party2.id, [
          { description: "Widget", quantity: "1", unitPrice: "100.00" },
        ])
      )
    ).rejects.toMatchObject({
      message: "Party not found in this business",
    });
  });

  it("rejects invoice creation when item belongs to a different business — cross-business item guard", async () => {
    const caller = callerForRamesh();

    // item2 belongs to business2 — referencing it from business1 should fail
    await expect(
      caller.invoice.create(
        baseSaleInput(world.party1.id, [
          {
            itemId: world.item2.id,
            description: "Cross-biz item",
            quantity: "1",
            unitPrice: "100.00",
          },
        ])
      )
    ).rejects.toMatchObject({
      message: "One or more items do not belong to this business",
    });
  });

  it("rejects invoice with zero quantity — Zod validation guard", async () => {
    const caller = callerForRamesh();

    await expect(
      caller.invoice.create(
        baseSaleInput(world.party1.id, [
          { description: "Zero qty item", quantity: "0", unitPrice: "100.00" },
        ])
      )
    ).rejects.toThrow();
  });

  it("rejects invoice with empty line items — Zod min(1) guard", async () => {
    const caller = callerForRamesh();

    await expect(
      caller.invoice.create({
        partyId: world.party1.id,
        type: "sale" as const,
        invoiceDate: new Date().toISOString(),
        lineItems: [],
      })
    ).rejects.toThrow();
  });

  it("rejects invoice with tax percent exceeding 56% — Zod guard", async () => {
    const caller = callerForRamesh();

    await expect(
      caller.invoice.create(
        baseSaleInput(world.party1.id, [
          { description: "Taxed item", quantity: "1", unitPrice: "100.00", taxPercent: "60" },
        ])
      )
    ).rejects.toThrow();
  });

  it("invoice with round-off adjusts totalAmount by the specified amount", async () => {
    const caller = callerForRamesh();

    const lineItemInput = { itemName: "Widget", quantity: "3", unitPrice: "100.00", taxPercent: "18.00" };

    // First calculate expected total without round-off
    const _baseTotals = calcInvoiceTotals({
      lineItems: [{ quantity: "3", unitPrice: "100.00", taxPercent: "18.00", discountPercent: "0" }],
    });

    const roundOff = "-0.50";
    const result = await caller.invoice.create({
      partyId: world.party1.id,
      type: "sale" as const,
      invoiceDate: new Date().toISOString(),
      roundOff,
      lineItems: [
        {
          itemName: lineItemInput.itemName,
          quantity: lineItemInput.quantity,
          unitPrice: lineItemInput.unitPrice,
          taxPercent: lineItemInput.taxPercent,
          discountPercent: "0",
          conversionFactor: null,
          variantId: null,
        },
      ],
    });

    // totalAmount must be baseTotals.total + roundOff
    const expectedTotal = calcInvoiceTotals({
      lineItems: [{ quantity: "3", unitPrice: "100.00", taxPercent: "18.00", discountPercent: "0" }],
      roundOff,
    }).total;

    expect(result.totalAmount).toBe(expectedTotal);
    expect(result.roundOff).toBe(roundOff);
  });

  it("invoice with percent discount computes discountAmount correctly", async () => {
    const caller = callerForRamesh();

    const result = await caller.invoice.create({
      partyId: world.party1.id,
      type: "sale" as const,
      invoiceDate: new Date().toISOString(),
      invoiceDiscount: "10",
      invoiceDiscountType: "percent",
      lineItems: [
        {
          itemName: "Discounted fabric",
          quantity: "10",
          unitPrice: "100.00",
          taxPercent: "0",
          discountPercent: "0",
          conversionFactor: null,
          variantId: null,
        },
      ],
    });

    // Subtotal = 1000. 10% invoice discount = 100. Total = 900.
    const expected = calcInvoiceTotals({
      lineItems: [{ quantity: "10", unitPrice: "100.00", taxPercent: "0", discountPercent: "0" }],
      invoiceDiscount: "10",
      invoiceDiscountType: "percent",
    });

    expect(result.discountAmount).toBe(expected.invoiceDiscountAmount);
    expect(result.totalAmount).toBe(expected.total);
  });
});

// =============================================================================
// invoice line items — itemName / description schema split (Bug B)
//
// These tests cover the post Bug B shape:
//   invoice_items.item_name — required snapshot of the item name at billing
//   invoice_items.description — optional free-text line notes
//
// Decoupled from baseSaleInput/createInvoiceWithItems so they exercise the
// router's validator directly.
// =============================================================================

describe("invoice.create — itemName + description schema split (Bug B)", () => {
  it("persists both itemName and description when both are provided", async () => {
    const caller = callerForRamesh();

    const result = await caller.invoice.create({
      partyId: world.party1.id,
      type: "sale" as const,
      invoiceDate: new Date().toISOString(),
      lineItems: [
        {
          itemName: "Rice Basmati",
          description: "Keep separate from order #42",
          quantity: "1",
          unitPrice: "100.00",
          taxPercent: "0",
          discountPercent: "0",
          conversionFactor: null,
          variantId: null,
        },
      ],
    });

    const fetched = await caller.invoice.getById({ id: result.id });
    expect(fetched).not.toBeNull();
    expect(fetched!.lineItems).toHaveLength(1);
    expect(fetched!.lineItems[0]!.itemName).toBe("Rice Basmati");
    expect(fetched!.lineItems[0]!.description).toBe("Keep separate from order #42");
  });

  it("leaves description NULL when only itemName is provided", async () => {
    const caller = callerForRamesh();

    const result = await caller.invoice.create({
      partyId: world.party1.id,
      type: "sale" as const,
      invoiceDate: new Date().toISOString(),
      lineItems: [
        {
          itemName: "Wheat Flour 5kg",
          quantity: "2",
          unitPrice: "250.00",
          taxPercent: "0",
          discountPercent: "0",
          conversionFactor: null,
          variantId: null,
        },
      ],
    });

    const fetched = await caller.invoice.getById({ id: result.id });
    expect(fetched).not.toBeNull();
    expect(fetched!.lineItems[0]!.itemName).toBe("Wheat Flour 5kg");
    expect(fetched!.lineItems[0]!.description).toBeNull();
  });

  it("rejects the create when itemName is missing", async () => {
    const caller = callerForRamesh();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const badInput: any = {
      partyId: world.party1.id,
      type: "sale" as const,
      invoiceDate: new Date().toISOString(),
      lineItems: [
        {
          // itemName intentionally omitted
          quantity: "1",
          unitPrice: "100.00",
          taxPercent: "0",
          discountPercent: "0",
          conversionFactor: null,
          variantId: null,
        },
      ],
    };

    await expect(caller.invoice.create(badInput)).rejects.toThrow();
  });

  it("rejects the create even when description is present but itemName is missing — no back-compat fallback", async () => {
    const caller = callerForRamesh();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const legacyShape: any = {
      partyId: world.party1.id,
      type: "sale" as const,
      invoiceDate: new Date().toISOString(),
      lineItems: [
        {
          // itemName omitted on purpose to simulate a stale client that
          // still sends the pre-split shape. This MUST fail — we do not
          // accept the legacy single-field shape.
          description: "Old-client item",
          quantity: "1",
          unitPrice: "100.00",
          taxPercent: "0",
          discountPercent: "0",
          conversionFactor: null,
          variantId: null,
        },
      ],
    };

    await expect(caller.invoice.create(legacyShape)).rejects.toThrow();
  });
});

// =============================================================================
// invoice.list
// =============================================================================

describe("invoice.list", () => {
  // Each test in this describe creates its own invoice to ensure predictable
  // filtering results, without depending on ordering with other describe blocks.

  it("returns paginated results with only documentType=invoice (not quotations or challans)", async () => {
    const caller = callerForRamesh();

    const result = await caller.invoice.list({ page: 1, limit: 50 });

    expect(result).toHaveProperty("data");
    expect(result).toHaveProperty("total");
    expect(result.page).toBe(1);
    expect(result.limit).toBe(50);

    // All returned records must be invoice type
    for (const inv of result.data) {
      expect(inv.documentType).toBe("invoice");
    }
  });

  it("filters by type=sale returns only sale invoices", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    // Create a supplier party so we can make a purchase invoice
    const supplier = await createParty(db, world.business1.id, {
      type: "supplier",
      name: "Test Supplier for List Filter",
    });

    // Create both a sale and a purchase invoice
    await caller.invoice.create(
      baseSaleInput(world.party1.id, [{ description: "Sale Item", quantity: "1", unitPrice: "100.00" }])
    );
    await caller.invoice.create({
      partyId: supplier.id,
      type: "purchase",
      invoiceDate: new Date().toISOString(),
      lineItems: [
        { itemName: "Purchase Item", quantity: "1", unitPrice: "80.00", taxPercent: "0", discountPercent: "0", conversionFactor: null, variantId: null },
      ],
    });

    const saleResult = await caller.invoice.list({ type: "sale", page: 1, limit: 50 });
    const purchaseResult = await caller.invoice.list({ type: "purchase", page: 1, limit: 50 });

    // Every invoice in the sale list must be type sale
    for (const inv of saleResult.data) {
      expect(inv.type).toBe("sale");
    }

    // Every invoice in the purchase list must be type purchase
    for (const inv of purchaseResult.data) {
      expect(inv.type).toBe("purchase");
    }

    // At least one of each type must exist
    expect(saleResult.data.length).toBeGreaterThan(0);
    expect(purchaseResult.data.length).toBeGreaterThan(0);
  });

  it("filters by partyId returns only invoices for that party", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const secondParty = await createParty(db, world.business1.id, {
      name: "Second Party for Filter Test",
      type: "customer",
    });

    // Create invoice for party1
    await caller.invoice.create(
      baseSaleInput(world.party1.id, [{ description: "Party1 item", quantity: "1", unitPrice: "100.00" }])
    );
    // Create invoice for secondParty
    await caller.invoice.create(
      baseSaleInput(secondParty.id, [{ description: "Party2 item", quantity: "1", unitPrice: "100.00" }])
    );

    const result = await caller.invoice.list({ partyId: secondParty.id, page: 1, limit: 50 });

    expect(result.data.length).toBeGreaterThan(0);
    for (const inv of result.data) {
      expect(inv.partyId).toBe(secondParty.id);
    }
  });

  it("filters by date range — only returns invoices within fromDate..toDate", async () => {
    const caller = callerForRamesh();

    const fromDate = "2026-01-01T00:00:00.000Z";
    const toDate = "2026-01-31T23:59:59.999Z";

    // Create an invoice within January 2026
    await caller.invoice.create({
      partyId: world.party1.id,
      type: "sale" as const,
      invoiceDate: "2026-01-15T00:00:00.000Z",
      lineItems: [
        { itemName: "Jan item", quantity: "1", unitPrice: "100.00", taxPercent: "0", discountPercent: "0", conversionFactor: null, variantId: null },
      ],
    });

    const result = await caller.invoice.list({ fromDate, toDate, page: 1, limit: 50 });

    for (const inv of result.data) {
      const invDate = new Date(inv.invoiceDate!);
      expect(invDate >= new Date(fromDate)).toBe(true);
      expect(invDate <= new Date(toDate)).toBe(true);
    }
  });

  it("only returns invoices for the active business — business isolation", async () => {
    const callerB1 = callerForRamesh();
    const callerB2 = callerForKiran();

    // Create an invoice in business2
    await callerB2.invoice.create(
      baseSaleInput(world.party2.id, [{ description: "Biz2 item", quantity: "1", unitPrice: "100.00" }])
    );

    const b1Result = await callerB1.invoice.list({ page: 1, limit: 100 });
    const b2Result = await callerB2.invoice.list({ page: 1, limit: 100 });

    // Ensure there is no overlap between the two lists
    const b1Ids = new Set(b1Result.data.map((i) => i.id));
    const b2Ids = new Set(b2Result.data.map((i) => i.id));

    for (const id of b2Ids) {
      expect(b1Ids.has(id)).toBe(false);
    }
  });

  it("overdue status filter uses computed logic (dueDate < NOW AND status not paid/cancelled/draft)", async () => {
    const caller = callerForRamesh();

    // Create an invoice with a dueDate in the past and status=sent (should appear as overdue)
    await caller.invoice.create({
      partyId: world.party1.id,
      type: "sale" as const,
      invoiceDate: "2025-01-01T00:00:00.000Z",
      dueDate: "2025-02-01T00:00:00.000Z",
      lineItems: [
        { itemName: "Overdue item", quantity: "1", unitPrice: "500.00", taxPercent: "0", discountPercent: "0", conversionFactor: null, variantId: null },
      ],
    });

    // Manually update to 'sent' so it qualifies for overdue
    const allInvoices = await caller.invoice.list({ page: 1, limit: 100 });
    const pastInvoice = allInvoices.data.find(
      (inv) => inv.invoiceDate && new Date(inv.invoiceDate) < new Date("2025-06-01")
    );

    if (pastInvoice) {
      await caller.invoice.updateStatus({ id: pastInvoice.id, status: "sent" });
    }

    const overdueResult = await caller.invoice.list({ status: "overdue", page: 1, limit: 50 });

    // All returned invoices must have a past due date and non-paid/cancelled/draft status
    for (const inv of overdueResult.data) {
      if (inv.dueDate) {
        expect(new Date(inv.dueDate) < new Date()).toBe(true);
      }
      expect(["paid", "cancelled", "draft"]).not.toContain(inv.status);
    }
  });

  it("soft-deleted invoices are excluded from list results", async () => {
    const caller = callerForRamesh();

    const invoice = await caller.invoice.create(
      baseSaleInput(world.party1.id, [{ description: "To be deleted", quantity: "1", unitPrice: "100.00" }])
    );

    await caller.invoice.delete({ id: invoice.id });

    const result = await caller.invoice.list({ page: 1, limit: 100 });
    const ids = result.data.map((i) => i.id);
    expect(ids).not.toContain(invoice.id);
  });
});

// =============================================================================
// invoice.getById
// =============================================================================

describe("invoice.getById", () => {
  it("returns an invoice with its line items and party details", async () => {
    const caller = callerForRamesh();

    const created = await caller.invoice.create(
      baseSaleInput(world.party1.id, [
        { description: "Item A", quantity: "2", unitPrice: "100.00", taxPercent: "5.00" },
        { description: "Item B", quantity: "3", unitPrice: "50.00", taxPercent: "12.00" },
      ])
    );

    const result = await caller.invoice.getById({ id: created.id });

    expect(result).not.toBeNull();
    expect(result!.id).toBe(created.id);
    expect(result!.lineItems).toHaveLength(2);
    expect(result!.party).not.toBeNull();
    expect(result!.party!.id).toBe(world.party1.id);

    // Line items are returned in sortOrder. Post Bug B: itemName is the
    // primary display field; description is the optional notes column
    // (null on these rows since the test didn't set `notes`).
    expect(result!.lineItems[0]!.itemName).toBe("Item A");
    expect(result!.lineItems[1]!.itemName).toBe("Item B");
    expect(result!.lineItems[0]!.description).toBeNull();
    expect(result!.lineItems[1]!.description).toBeNull();
  });

  it("returns null for an invoice that belongs to a different business — cross-business isolation", async () => {
    const callerB1 = callerForRamesh();
    const callerB2 = callerForKiran();

    // Create invoice in business2
    const b2Invoice = await callerB2.invoice.create(
      baseSaleInput(world.party2.id, [{ description: "B2 item", quantity: "1", unitPrice: "100.00" }])
    );

    // Attempt to read it from business1 — must return null (not throw, not leak)
    const result = await callerB1.invoice.getById({ id: b2Invoice.id });
    expect(result).toBeNull();
  });
});

// =============================================================================
// invoice.updateStatus
// =============================================================================

describe("invoice.updateStatus", () => {
  it("transitions draft to sent", async () => {
    const caller = callerForRamesh();

    const invoice = await caller.invoice.create(
      baseSaleInput(world.party1.id, [{ description: "Draft item", quantity: "1", unitPrice: "100.00" }])
    );

    expect(invoice.status).toBe("draft");

    const updated = await caller.invoice.updateStatus({ id: invoice.id, status: "sent" });
    expect(updated!.status).toBe("sent");
  });

  it("allows any status transition — no state-machine guard in invoice router (current design)", async () => {
    // The invoice router does not enforce a state machine. Any status can
    // transition to any other status. This is intentional for flexibility.
    // (State machine enforcement lives in D3. tests.)
    const caller = callerForRamesh();

    const invoice = await caller.invoice.create(
      baseSaleInput(world.party1.id, [{ description: "FSM test", quantity: "1", unitPrice: "100.00" }])
    );

    // paid → draft — should be allowed (no guard)
    await caller.invoice.updateStatus({ id: invoice.id, status: "paid" });
    const updated = await caller.invoice.updateStatus({ id: invoice.id, status: "draft" });
    expect(updated!.status).toBe("draft");
  });

  it("updateStatus scopes to the active business — cannot update another business invoice", async () => {
    const callerB2 = callerForKiran();
    const callerB1 = callerForRamesh();

    const b2Invoice = await callerB2.invoice.create(
      baseSaleInput(world.party2.id, [{ description: "B2 item", quantity: "1", unitPrice: "200.00" }])
    );

    // business1 caller attempts to update business2's invoice — now throws NOT_FOUND
    await expect(
      callerB1.invoice.updateStatus({ id: b2Invoice.id, status: "sent" })
    ).rejects.toThrow(/not found/i);
  });

  it("updateStatus on non-existent invoice throws NOT_FOUND", async () => {
    const caller = callerForRamesh();
    await expect(
      caller.invoice.updateStatus({
        id: "00000000-0000-0000-0000-000000000000",
        status: "sent",
      })
    ).rejects.toThrow(/not found/i);
  });
});

// =============================================================================
// invoice.delete
// =============================================================================

describe("invoice.delete", () => {
  it("soft-deletes invoice by setting deletedAt and status=cancelled", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const invoice = await caller.invoice.create(
      baseSaleInput(world.party1.id, [{ description: "Delete test", quantity: "1", unitPrice: "100.00" }])
    );

    const result = await caller.invoice.delete({ id: invoice.id });
    expect(result.success).toBe(true);

    // Verify DB state
    const [row] = await db.select({ deletedAt: invoices.deletedAt, status: invoices.status })
      .from(invoices)
      .where(and(eq(invoices.id, invoice.id), eq(invoices.businessId, world.business1.id)));

    expect(row!.deletedAt).not.toBeNull();
    expect(row!.status).toBe("cancelled");
  });

  it("invoice.delete reverses stock adjustments", async () => {
    // The invoice delete handler reverses stock (matching the document-router-factory pattern).

    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const stockItem = await createItem(db, world.business1.id, {
      name: "Stock Reversal Test Item",
      stockQuantity: "100.000",
      taxPercent: "0.00",
    });

    const [before] = await db.select({ stockQuantity: items.stockQuantity })
      .from(items)
      .where(eq(items.id, stockItem.id));
    const stockBefore = parseFloat(before!.stockQuantity);

    const invoice = await caller.invoice.create(
      baseSaleInput(world.party1.id, [
        { itemId: stockItem.id, description: "Stock test", quantity: "10", unitPrice: "100.00" },
      ])
    );

    const [afterCreate] = await db.select({ stockQuantity: items.stockQuantity })
      .from(items)
      .where(eq(items.id, stockItem.id));
    // Stock was decremented on create
    expect(parseFloat(afterCreate!.stockQuantity)).toBeCloseTo(stockBefore - 10, 3);

    // Now delete the invoice
    await caller.invoice.delete({ id: invoice.id });

    const [afterDelete] = await db.select({ stockQuantity: items.stockQuantity })
      .from(items)
      .where(eq(items.id, stockItem.id));

    // Stock IS restored on delete — reversal was added as part of the security audit fix #6.
    expect(parseFloat(afterDelete!.stockQuantity)).toBeCloseTo(stockBefore, 3);
  });

  it("deleting an already-deleted invoice is idempotent — returns success without error", async () => {
    const caller = callerForRamesh();

    const invoice = await caller.invoice.create(
      baseSaleInput(world.party1.id, [{ description: "Idempotent delete", quantity: "1", unitPrice: "100.00" }])
    );

    await caller.invoice.delete({ id: invoice.id });
    // Second delete — must not throw
    const result = await caller.invoice.delete({ id: invoice.id });
    expect(result.success).toBe(true);
  });

  it("deleting a non-existent invoice returns success gracefully", async () => {
    const caller = callerForRamesh();

    const result = await caller.invoice.delete({ id: "00000000-0000-0000-0000-000000000001" });
    expect(result.success).toBe(true);
  });
});
