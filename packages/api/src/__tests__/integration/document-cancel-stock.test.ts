/**
 * Cancelling a stock-affecting factory document (delivery challan, sales
 * return, purchase return) must reverse its stock effect exactly like delete
 * does — once. Delete of an already-cancelled doc must not reverse again.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { items as itemsTable, itemVariants } from "@hisaabo/db";
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
