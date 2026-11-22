/**
 * Cancelling a stock-affecting factory document (delivery challan, sales
 * return, purchase return) must reverse its stock effect exactly like delete
 * does — once. Delete of an already-cancelled doc must not reverse again.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { invoices, items as itemsTable, itemVariants } from "@hisaabo/db";
import { createTestWorld, createItem, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { truncateAllTables, closeTestDb } from "../helpers/test-db.js";

let world: TestWorld;
let caller: ReturnType<typeof createTestCaller>;

beforeAll(async () => {
  world = await createTestWorld();
  caller = createTestCaller({
    userId: world.ramesh.id,
    email: world.ramesh.email,
    name: world.ramesh.name,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

async function itemQty(id: string): Promise<number> {
  const [r] = await world.tenantDb.select({ q: itemsTable.stockQuantity }).from(itemsTable).where(eq(itemsTable.id, id));
  return parseFloat(r!.q);
}
async function variantQty(id: string): Promise<number> {
  const [r] = await world.tenantDb.select({ q: itemVariants.stockQuantity }).from(itemVariants).where(eq(itemVariants.id, id));
  return parseFloat(r!.q);
}

function input(lineItems: Array<Record<string, unknown>>, type: "sale" | "purchase" = "sale") {
  return {
    partyId: world.party1.id,
    type,
    invoiceDate: new Date().toISOString(),
    lineItems: lineItems.map((li) => ({
      itemName: "Line",
      unitPrice: "100.00",
      taxPercent: "5.00",
      ...li,
    })),
  } as never;
}

describe("factory document cancel reverses stock", () => {
  it("delivery challan: cancel restores item stock (alt-unit conversion factor applied)", async () => {
    const item = await createItem(world.tenantDb, world.business1.id, { stockQuantity: "100.000" });
    const doc = await caller.deliveryChallan.create(
      input([{ itemId: item.id, quantity: "2", selectedUnit: "box", conversionFactor: "12" }]),
    );
    expect(await itemQty(item.id)).toBeCloseTo(100 - 24, 3);

    const cancelled = await caller.deliveryChallan.updateStatus({ id: doc.id, status: "cancelled" });
    expect(cancelled.status).toBe("cancelled");
    expect(await itemQty(item.id)).toBeCloseTo(100, 3);
  });

  it("delivery challan: cancel restores variant stock", async () => {
    const item = await createItem(world.tenantDb, world.business1.id, { stockQuantity: "0.000" });
    const [variant] = await world.tenantDb
      .insert(itemVariants)
      .values({ itemId: item.id, attributeValues: { Size: "M" }, stockQuantity: "50.000" })
      .returning();
    const doc = await caller.deliveryChallan.create(
      input([{ itemId: item.id, variantId: variant!.id, quantity: "7" }]),
    );
    expect(await variantQty(variant!.id)).toBeCloseTo(43, 3);
    expect(await itemQty(item.id)).toBeCloseTo(0, 3);

    await caller.deliveryChallan.updateStatus({ id: doc.id, status: "cancelled" });
    expect(await variantQty(variant!.id)).toBeCloseTo(50, 3);
    expect(await itemQty(item.id)).toBeCloseTo(0, 3);
  });

  it("sales return (increment): cancel removes the returned stock again", async () => {
    const item = await createItem(world.tenantDb, world.business1.id, { stockQuantity: "10.000" });
    const doc = await caller.salesReturn.create(input([{ itemId: item.id, quantity: "4" }]));
    expect(await itemQty(item.id)).toBeCloseTo(14, 3);
    await caller.salesReturn.updateStatus({ id: doc.id, status: "cancelled" });
    expect(await itemQty(item.id)).toBeCloseTo(10, 3);
  });

  it("purchase return (decrement): cancel restores stock", async () => {
    const item = await createItem(world.tenantDb, world.business1.id, { stockQuantity: "10.000" });
    const doc = await caller.purchaseReturn.create(input([{ itemId: item.id, quantity: "3" }], "purchase"));
    expect(await itemQty(item.id)).toBeCloseTo(7, 3);
    await caller.purchaseReturn.updateStatus({ id: doc.id, status: "cancelled" });
    expect(await itemQty(item.id)).toBeCloseTo(10, 3);
  });

  it("cancel then delete does not reverse twice", async () => {
    const item = await createItem(world.tenantDb, world.business1.id, { stockQuantity: "100.000" });
    const doc = await caller.deliveryChallan.create(input([{ itemId: item.id, quantity: "10" }]));
    await caller.deliveryChallan.updateStatus({ id: doc.id, status: "cancelled" });
    expect(await itemQty(item.id)).toBeCloseTo(100, 3);

    await caller.deliveryChallan.delete({ id: doc.id });
    expect(await itemQty(item.id)).toBeCloseTo(100, 3);

    // Re-cancelling is rejected and does not touch stock either
    await expect(
      caller.deliveryChallan.updateStatus({ id: doc.id, status: "cancelled" }),
    ).rejects.toThrow();
    expect(await itemQty(item.id)).toBeCloseTo(100, 3);
  });

  it("delete of a non-cancelled document still reverses stock", async () => {
    const item = await createItem(world.tenantDb, world.business1.id, { stockQuantity: "100.000" });
    const doc = await caller.deliveryChallan.create(input([{ itemId: item.id, quantity: "10" }]));
    expect(await itemQty(item.id)).toBeCloseTo(90, 3);
    await caller.deliveryChallan.delete({ id: doc.id });
    expect(await itemQty(item.id)).toBeCloseTo(100, 3);
  });

  it("non-stock document types are unaffected by cancel", async () => {
    const item = await createItem(world.tenantDb, world.business1.id, { stockQuantity: "100.000" });
    const q = await caller.quotation.create(input([{ itemId: item.id, quantity: "5" }]));
    await caller.quotation.updateStatus({ id: q.id, status: "cancelled" });
    expect(await itemQty(item.id)).toBeCloseTo(100, 3);

    const p = await caller.proforma.create(input([{ itemId: item.id, quantity: "5" }]));
    await caller.proforma.updateStatus({ id: p.id, status: "cancelled" });
    expect(await itemQty(item.id)).toBeCloseTo(100, 3);
  });
});

// invoice.updateStatus is the route the 0.10.1 upgrade notes give for finishing the cancel of
// a document whose IRN is already cancelled (web "Cancel invoice", `hisaabo invoice status`,
// the invoice_update_status MCP tool), and it accepts any document id. It must undo exactly
// what the document's own router would: not an invoice's stock effect by sale / purchase side.
describe("invoice.updateStatus cancel honours the document type", () => {
  it("sales return (increment): cancel removes the returned stock again, once", async () => {
    const item = await createItem(world.tenantDb, world.business1.id, { stockQuantity: "10.000" });
    const doc = await caller.salesReturn.create(input([{ itemId: item.id, quantity: "4" }]));
    expect(await itemQty(item.id)).toBeCloseTo(14, 3);
    const cancelled = await caller.invoice.updateStatus({ id: doc.id, status: "cancelled" });
    expect(cancelled.status).toBe("cancelled");
    expect(await itemQty(item.id)).toBeCloseTo(10, 3);
  });

  it("purchase return (decrement): cancel restores stock", async () => {
    const item = await createItem(world.tenantDb, world.business1.id, { stockQuantity: "10.000" });
    const doc = await caller.purchaseReturn.create(input([{ itemId: item.id, quantity: "3" }], "purchase"));
    expect(await itemQty(item.id)).toBeCloseTo(7, 3);
    await caller.invoice.updateStatus({ id: doc.id, status: "cancelled" });
    expect(await itemQty(item.id)).toBeCloseTo(10, 3);
  });

  it("delivery challan (decrement): cancel restores stock, alt-unit conversion factor applied", async () => {
    const item = await createItem(world.tenantDb, world.business1.id, { stockQuantity: "100.000" });
    const doc = await caller.deliveryChallan.create(
      input([{ itemId: item.id, quantity: "2", selectedUnit: "box", conversionFactor: "12" }]),
    );
    expect(await itemQty(item.id)).toBeCloseTo(76, 3);
    await caller.invoice.updateStatus({ id: doc.id, status: "cancelled" });
    expect(await itemQty(item.id)).toBeCloseTo(100, 3);
  });

  it("credit note and quotation move no stock, so cancelling them changes none", async () => {
    const item = await createItem(world.tenantDb, world.business1.id, { stockQuantity: "100.000" });
    const cn = await caller.creditNote.create(input([{ itemId: item.id, quantity: "5" }]));
    const q = await caller.quotation.create(input([{ itemId: item.id, quantity: "5" }]));
    expect(await itemQty(item.id)).toBeCloseTo(100, 3);
    await caller.invoice.updateStatus({ id: cn.id, status: "cancelled" });
    await caller.invoice.updateStatus({ id: q.id, status: "cancelled" });
    expect(await itemQty(item.id)).toBeCloseTo(100, 3);
  });

  it("a document whose IRN is already cancelled can still be finished here, and the leftover error is cleared", async () => {
    const item = await createItem(world.tenantDb, world.business1.id, { stockQuantity: "10.000" });
    const doc = await caller.salesReturn.create(input([{ itemId: item.id, quantity: "4" }]));
    await world.tenantDb
      .update(invoices)
      .set({
        irn: "C".repeat(64),
        irnAckDate: new Date(),
        eInvoiceStatus: "cancelled",
        eInvoiceError: "IRN cancelled at the IRP, but the invoice is still active",
      })
      .where(eq(invoices.id, doc.id));

    const cancelled = await caller.invoice.updateStatus({ id: doc.id, status: "cancelled" });
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.eInvoiceError).toBeNull();
    expect(await itemQty(item.id)).toBeCloseTo(10, 3);
  });

  it("a document with a live IRN is still refused, and stock is untouched", async () => {
    const item = await createItem(world.tenantDb, world.business1.id, { stockQuantity: "10.000" });
    const doc = await caller.salesReturn.create(input([{ itemId: item.id, quantity: "4" }]));
    await world.tenantDb
      .update(invoices)
      .set({ irn: "D".repeat(64), irnAckDate: new Date(), eInvoiceStatus: "generated" })
      .where(eq(invoices.id, doc.id));

    await expect(caller.invoice.updateStatus({ id: doc.id, status: "cancelled" })).rejects.toThrow(/active e-invoice/);
    expect(await itemQty(item.id)).toBeCloseTo(14, 3);
  });
});
