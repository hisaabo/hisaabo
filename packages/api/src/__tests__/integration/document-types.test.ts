/**
 * document-types.test.ts — Integration tests for the document-router factory
 *
 * WHY THIS FILE EXISTS:
 * createDocumentRouter() is a single factory function that generates CRUD routers
 * for six document types: quotation, credit_note, delivery_challan, proforma,
 * sales_return, purchase_return. Each type wires up to a different prefix/counter
 * column and a different stock effect ("none" | "decrement" | "increment").
 *
 * An error in the factory silently corrupts all documents of a type. These tests
 * verify three critical per-type invariants:
 *
 *   PREFIX FORMAT  — `${prefix}-${String(counter).padStart(5, "0")}`
 *                    Quotation prefix is "QTN", credit note prefix is "CN", etc.
 *   STOCK EFFECT   — quotation/proforma: no stock change
 *                    delivery_challan:   decrement on create, restore on delete
 *                    credit_note/sales_return: increment on create (items returned)
 *                    purchase_return:    decrement on create (items sent back)
 *   STATUS MACHINE — only allowed statuses can be set (Zod enum)
 *
 * Tests use the tRPC caller so the full middleware chain (auth → business scope
 * → stock update) is exercised end-to-end against the real test DB.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { items as itemsTable } from "@hisaabo/db";
import {
  createTestWorld,
  createItem,
  type TestWorld,
} from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { truncateAllTables, closeTestDb } from "../helpers/test-db.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function isoNow(): string {
  return new Date().toISOString();
}

async function getStockQty(db: TestWorld["tenantDb"], itemId: string): Promise<number> {
  const [row] = await db
    .select({ stockQuantity: itemsTable.stockQuantity })
    .from(itemsTable)
    .where(eq(itemsTable.id, itemId))
    .limit(1);
  return parseFloat(row?.stockQuantity ?? "0");
}

// ── Fixture ────────────────────────────────────────────────────────────────────

let world: TestWorld;

// Reusable items with stock for stock-effect tests
let stockItemDecrement: Awaited<ReturnType<typeof createItem>>;
let stockItemIncrement: Awaited<ReturnType<typeof createItem>>;

beforeAll(async () => {
  world = await createTestWorld();

  // Item with large stock for decrement tests (delivery_challan, purchase_return)
  stockItemDecrement = await createItem(world.tenantDb, world.business1.id, {
    name: "Decrement Test Item",
    stockQuantity: "500.000",
    salePrice: "100.00",
    purchasePrice: "80.00",
    taxPercent: "5.00",
  });

  // Item with 0 stock for increment tests (credit_note, sales_return)
  stockItemIncrement = await createItem(world.tenantDb, world.business1.id, {
    name: "Increment Test Item",
    stockQuantity: "0.000",
    salePrice: "150.00",
    purchasePrice: "120.00",
    taxPercent: "5.00",
  });
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

// ── Shared input builder ───────────────────────────────────────────────────────

function buildInvoiceInput(
  partyId: string,
  itemId: string,
  qty: string,
  unitPrice: string,
  type: "sale" | "purchase" = "sale",
) {
  return {
    partyId,
    type,
    invoiceDate: isoNow(),
    lineItems: [
      {
        itemId,
        description: "Test item line",
        quantity: qty,
        unitPrice,
        taxPercent: "5.00",
      },
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// QUOTATION — stockEffect: "none", prefix: business.quotationPrefix (default "QTN")
// ═══════════════════════════════════════════════════════════════════════════════

describe("quotation via document factory", () => {
  it("quotation.create via document factory generates correct QTN- prefix and does NOT affect stock", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const stockBefore = await getStockQty(world.tenantDb, stockItemDecrement.id);

    const doc = await caller.quotation.create(
      buildInvoiceInput(world.party1.id, stockItemDecrement.id, "10", "100.00"),
    );

    expect(doc).toBeDefined();
    // Prefix must start with the business quotation prefix
    expect(doc.invoiceNumber).toMatch(/^QTN-\d{5}$/);
    expect(doc.documentType).toBe("quotation");

    // Stock must NOT have changed
    const stockAfter = await getStockQty(world.tenantDb, stockItemDecrement.id);
    expect(stockAfter).toBe(stockBefore);
  });

  it("quotation.list filters by documentType=quotation and excludes invoices", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const result = await caller.quotation.list({ page: 1, limit: 20 });

    for (const row of result.data) {
      expect(row.documentType).toBe("quotation");
    }
  });

  it("quotation.updateStatus transitions from draft to sent", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const doc = await caller.quotation.create(
      buildInvoiceInput(world.party1.id, world.item1.id, "1", "100.00"),
    );

    const updated = await caller.quotation.updateStatus({ id: doc.id, status: "sent" });
    expect(updated.status).toBe("sent");
  });

  it("quotation.updateStatus rejects a status not in allowedStatuses — gap: 'paid' not allowed for quotations", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const doc = await caller.quotation.create(
      buildInvoiceInput(world.party1.id, world.item1.id, "1", "100.00"),
    );

    // "paid" is not in quotation's allowedStatuses ["draft","sent","cancelled"]
    await expect(
      caller.quotation.updateStatus({ id: doc.id, status: "paid" as never }),
    ).rejects.toThrow();
  });

  it("quotation.delete soft-deletes the document — does not restore stock (stockEffect=none)", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const stockBefore = await getStockQty(world.tenantDb, stockItemDecrement.id);

    const doc = await caller.quotation.create(
      buildInvoiceInput(world.party1.id, stockItemDecrement.id, "5", "100.00"),
    );

    await caller.quotation.delete({ id: doc.id });

    const stockAfter = await getStockQty(world.tenantDb, stockItemDecrement.id);
    expect(stockAfter).toBe(stockBefore); // no change because stockEffect=none

    // Must be absent from list
    const list = await caller.quotation.list({ page: 1, limit: 100 });
    const found = list.data.find((d) => d.id === doc.id);
    expect(found).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PROFORMA — stockEffect: "none", prefix: business.proformaPrefix (default "PI")
// ═══════════════════════════════════════════════════════════════════════════════

describe("proforma via document factory", () => {
  it("proforma.create generates PI- prefix and does NOT decrement stock", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const stockBefore = await getStockQty(world.tenantDb, stockItemDecrement.id);

    const doc = await caller.proforma.create(
      buildInvoiceInput(world.party1.id, stockItemDecrement.id, "3", "100.00"),
    );

    expect(doc.invoiceNumber).toMatch(/^PI-\d{5}$/);
    expect(doc.documentType).toBe("proforma");

    const stockAfter = await getStockQty(world.tenantDb, stockItemDecrement.id);
    expect(stockAfter).toBe(stockBefore);
  });

  it("proforma.list returns only proforma documents", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const result = await caller.proforma.list({ page: 1, limit: 20 });
    for (const row of result.data) {
      expect(row.documentType).toBe("proforma");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DELIVERY CHALLAN — stockEffect: "decrement", prefix: business.deliveryChallanPrefix ("DC")
// ═══════════════════════════════════════════════════════════════════════════════

describe("delivery_challan via document factory", () => {
  it("deliveryChallan.create generates DC- prefix and decrements stock by the line item quantity", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const stockBefore = await getStockQty(world.tenantDb, stockItemDecrement.id);

    const doc = await caller.deliveryChallan.create(
      buildInvoiceInput(world.party1.id, stockItemDecrement.id, "20", "100.00"),
    );

    expect(doc.invoiceNumber).toMatch(/^DC-\d{5}$/);
    expect(doc.documentType).toBe("delivery_challan");

    const stockAfter = await getStockQty(world.tenantDb, stockItemDecrement.id);
    expect(stockAfter).toBeCloseTo(stockBefore - 20, 3);
  });

  it("deliveryChallan.delete reverses stock decrement — stock is restored on soft delete", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const stockBefore = await getStockQty(world.tenantDb, stockItemDecrement.id);

    const doc = await caller.deliveryChallan.create(
      buildInvoiceInput(world.party1.id, stockItemDecrement.id, "15", "100.00"),
    );

    const stockAfterCreate = await getStockQty(world.tenantDb, stockItemDecrement.id);
    expect(stockAfterCreate).toBeCloseTo(stockBefore - 15, 3);

    await caller.deliveryChallan.delete({ id: doc.id });

    const stockAfterDelete = await getStockQty(world.tenantDb, stockItemDecrement.id);
    // Stock restored to pre-create level
    expect(stockAfterDelete).toBeCloseTo(stockBefore, 3);
  });

  it("deliveryChallan.updateStatus allows valid transitions", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const doc = await caller.deliveryChallan.create(
      buildInvoiceInput(world.party1.id, stockItemDecrement.id, "1", "100.00"),
    );

    const updated = await caller.deliveryChallan.updateStatus({ id: doc.id, status: "sent" });
    expect(updated.status).toBe("sent");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CREDIT NOTE — stockEffect: "increment", prefix: business.creditNotePrefix ("CN")
// ═══════════════════════════════════════════════════════════════════════════════

describe("credit_note via document factory", () => {
  it("creditNote.create generates CN- prefix and INCREMENTS stock (items returned to stock)", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const stockBefore = await getStockQty(world.tenantDb, stockItemIncrement.id);

    const doc = await caller.creditNote.create(
      buildInvoiceInput(world.party1.id, stockItemIncrement.id, "8", "150.00"),
    );

    expect(doc.invoiceNumber).toMatch(/^CN-\d{5}$/);
    expect(doc.documentType).toBe("credit_note");

    const stockAfter = await getStockQty(world.tenantDb, stockItemIncrement.id);
    expect(stockAfter).toBeCloseTo(stockBefore + 8, 3);
  });

  it("creditNote.delete reverses stock increment — stock decremented on delete", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const stockBefore = await getStockQty(world.tenantDb, stockItemIncrement.id);

    const doc = await caller.creditNote.create(
      buildInvoiceInput(world.party1.id, stockItemIncrement.id, "5", "150.00"),
    );

    const stockAfterCreate = await getStockQty(world.tenantDb, stockItemIncrement.id);
    expect(stockAfterCreate).toBeCloseTo(stockBefore + 5, 3);

    await caller.creditNote.delete({ id: doc.id });

    const stockAfterDelete = await getStockQty(world.tenantDb, stockItemIncrement.id);
    expect(stockAfterDelete).toBeCloseTo(stockBefore, 3);
  });

  it("creditNote.list returns only credit_note documents", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const result = await caller.creditNote.list({ page: 1, limit: 20 });
    for (const row of result.data) {
      expect(row.documentType).toBe("credit_note");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SALES RETURN — stockEffect: "increment", shares creditNotePrefix counter
// ═══════════════════════════════════════════════════════════════════════════════

describe("sales_return via document factory", () => {
  it("salesReturn.create increments stock (returned goods re-enter inventory)", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const stockBefore = await getStockQty(world.tenantDb, stockItemIncrement.id);

    const doc = await caller.salesReturn.create(
      buildInvoiceInput(world.party1.id, stockItemIncrement.id, "3", "150.00"),
    );

    expect(doc.documentType).toBe("sales_return");

    const stockAfter = await getStockQty(world.tenantDb, stockItemIncrement.id);
    expect(stockAfter).toBeCloseTo(stockBefore + 3, 3);
  });

  it("salesReturn.list returns only sales_return documents", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const result = await caller.salesReturn.list({ page: 1, limit: 20 });
    for (const row of result.data) {
      expect(row.documentType).toBe("sales_return");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PURCHASE RETURN — stockEffect: "decrement", shares creditNotePrefix counter
// ═══════════════════════════════════════════════════════════════════════════════

describe("purchase_return via document factory", () => {
  it("purchaseReturn.create decrements stock (items being sent back to supplier)", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const stockBefore = await getStockQty(world.tenantDb, stockItemDecrement.id);

    const doc = await caller.purchaseReturn.create(
      buildInvoiceInput(world.party1.id, stockItemDecrement.id, "6", "80.00", "purchase"),
    );

    expect(doc.documentType).toBe("purchase_return");

    const stockAfter = await getStockQty(world.tenantDb, stockItemDecrement.id);
    expect(stockAfter).toBeCloseTo(stockBefore - 6, 3);
  });

  it("purchaseReturn.list returns only purchase_return documents", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const result = await caller.purchaseReturn.list({ page: 1, limit: 20 });
    for (const row of result.data) {
      expect(row.documentType).toBe("purchase_return");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Cross-type isolation — getById must not leak across document types
// ═══════════════════════════════════════════════════════════════════════════════

describe("document type isolation — getById", () => {
  it("quotation.getById returns null when given a delivery_challan ID — document type is checked", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const challan = await caller.deliveryChallan.create(
      buildInvoiceInput(world.party1.id, stockItemDecrement.id, "1", "100.00"),
    );

    // Querying the challan ID via the quotation router must return null
    const result = await caller.quotation.getById({ id: challan.id });
    expect(result).toBeNull();
  });

  it("business isolation — quotation from business1 is not visible via business2 caller", async () => {
    const caller1 = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const doc = await caller1.quotation.create(
      buildInvoiceInput(world.party1.id, world.item1.id, "1", "100.00"),
    );

    const caller2 = createTestCaller({
      userId: world.kiran.id,
      email: world.kiran.email,
      name: world.kiran.name,
      tenantId: world.tenant2.id,
      businessId: world.business2.id,
    });

    const result = await caller2.quotation.getById({ id: doc.id });
    expect(result).toBeNull();
  });
});
