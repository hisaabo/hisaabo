/**
 * Stock adjustments are batched (one UPDATE per table) but must stay
 * arithmetically identical to per-line updates: duplicate items on separate
 * lines sum, variant lines touch only the variant, and update/cancel reverse
 * exactly what create applied.
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

async function itemQty(id: string): Promise<string> {
  const [r] = await world.tenantDb.select({ q: itemsTable.stockQuantity }).from(itemsTable).where(eq(itemsTable.id, id));
  return r!.q;
}
async function variantQty(id: string): Promise<string> {
  const [r] = await world.tenantDb.select({ q: itemVariants.stockQuantity }).from(itemVariants).where(eq(itemVariants.id, id));
  return r!.q;
}

function input(lineItems: Array<Record<string, unknown>>, type: "sale" | "purchase" = "sale") {
  return {
    partyId: world.party1.id,
    type,
    invoiceDate: new Date().toISOString(),
    lineItems: lineItems.map((li) => ({ itemName: "Line", unitPrice: "100.00", taxPercent: "0", ...li })),
  } as never;
}

describe("batched stock adjustment", () => {
  it("same item on two lines adjusts by the exact sum (no float drift); cancel restores", async () => {
    const item = await createItem(world.tenantDb, world.business1.id, { stockQuantity: "10.000" });
    const inv = await caller.invoice.create(input([
      { itemId: item.id, quantity: "0.1" },
      { itemId: item.id, quantity: "0.2" },
      { itemId: item.id, quantity: "2", selectedUnit: "box", conversionFactor: "12" },
    ]));
    expect(await itemQty(item.id)).toBe("-14.300");
    await caller.invoice.updateStatus({ id: inv.id, status: "cancelled" });
    expect(await itemQty(item.id)).toBe("10.000");
  });

  it("variant line adjusts only the variant; purchase adds", async () => {
    const item = await createItem(world.tenantDb, world.business1.id, { stockQuantity: "5.000" });
    const [variant] = await world.tenantDb.insert(itemVariants)
      .values({ itemId: item.id, attributeValues: { Size: "L" }, stockQuantity: "20.000" }).returning();
    const inv = await caller.invoice.create(input([
      { itemId: item.id, variantId: variant!.id, quantity: "3" },
      { itemId: item.id, variantId: variant!.id, quantity: "4" },
    ], "purchase"));
    expect(await variantQty(variant!.id)).toBe("27.000");
    expect(await itemQty(item.id)).toBe("5.000");
    await caller.invoice.updateStatus({ id: inv.id, status: "cancelled" });
    expect(await variantQty(variant!.id)).toBe("20.000");
  });

  it("update nets old and new lines (including items only on one side)", async () => {
    const a = await createItem(world.tenantDb, world.business1.id, { stockQuantity: "100.000" });
    const b = await createItem(world.tenantDb, world.business1.id, { stockQuantity: "100.000" });
    const inv = await caller.invoice.create(input([
      { itemId: a.id, quantity: "10" },
      { itemId: a.id, quantity: "5" },
    ]));
    expect(await itemQty(a.id)).toBe("85.000");
    await caller.invoice.update({
      id: inv.id,
      lineItems: [
        { itemName: "Line", unitPrice: "100.00", taxPercent: "0", itemId: b.id, quantity: "7" },
        { itemName: "Line", unitPrice: "100.00", taxPercent: "0", itemId: b.id, quantity: "3" },
      ],
    } as never);
    expect(await itemQty(a.id)).toBe("100.000");
    expect(await itemQty(b.id)).toBe("90.000");
  });

  it("sales return with duplicate lines: cancel reverses the summed effect", async () => {
    const item = await createItem(world.tenantDb, world.business1.id, { stockQuantity: "10.000" });
    const doc = await caller.salesReturn.create(input([
      { itemId: item.id, quantity: "1" },
      { itemId: item.id, quantity: "2" },
    ]));
    expect(await itemQty(item.id)).toBe("13.000");
    await caller.salesReturn.updateStatus({ id: doc.id, status: "cancelled" });
    expect(await itemQty(item.id)).toBe("10.000");
  });
});
