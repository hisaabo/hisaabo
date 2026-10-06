// DB-backed (needs Postgres, like the rest of integration/). Verifies that
// cancelling an online-store order puts back the stock the order decremented.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { items, invoices, storeOrders } from "@hisaabo/db";
import { createTestWorld, createItem, createParty, createInvoiceWithItems, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { truncateAllTables, closeTestDb } from "../helpers/test-db.js";

let world: TestWorld;

beforeAll(async () => {
  world = await createTestWorld();
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("store.cancelOrder restores stock", () => {
  it("adds back quantity * conversionFactor and is not repeatable", async () => {
    const db = world.tenantDb;
    const item = await createItem(db, world.business1.id, { name: "Box", storeEnabled: true, salePrice: "10.00", stockQuantity: "100.000" });
    const party = await createParty(db, world.business1.id, { name: "Walk-in Customer" });
    const { invoice } = await createInvoiceWithItems(
      db, world.business1.id, party.id,
      [{ itemId: item.id, itemName: "Box", quantity: "2", unitPrice: "10.00" }],
      { status: "unfulfilled" },
    );
    // Order placement decremented stock: 100 - 2 * 12 (alt unit of 12).
    await db.update(items).set({ stockQuantity: "76.000" }).where(eq(items.id, item.id));
    await db.execute(
      (await import("drizzle-orm")).sql`UPDATE invoice_items SET conversion_factor = '12' WHERE invoice_id = ${invoice.id}`,
    );
    const [order] = await db.insert(storeOrders).values({
      businessId: world.business1.id,
      invoiceId: invoice.id,
      orderNumber: "ORD-00001",
      status: "pending",
      customerName: "Test",
      customerPhone: "9876543210",
      totalAmount: "20.00",
      itemCount: 1,
      source: "online_store",
    }).returning();

    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name ?? null,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });
    await caller.store.cancelOrder({ orderId: order.id });

    const [after] = await db.select({ s: items.stockQuantity }).from(items).where(eq(items.id, item.id));
    expect(Number(after.s)).toBe(100);
    const [inv] = await db.select({ status: invoices.status }).from(invoices).where(eq(invoices.id, invoice.id));
    expect(inv.status).toBe("cancelled");

    await expect(caller.store.cancelOrder({ orderId: order.id })).rejects.toThrow();
    const [again] = await db.select({ s: items.stockQuantity }).from(items).where(eq(items.id, item.id));
    expect(Number(again.s)).toBe(100);
  });
});
