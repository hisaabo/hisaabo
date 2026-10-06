/**
 * Document lifecycle rules — integration tests
 *
 *  - sellers cannot create purchase-side documents
 *  - delete / cancel are blocked while payments are allocated or an active IRN exists
 *  - factory documents follow per-type status transition tables
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { invoices, paymentAllocations } from "@hisaabo/db";
import { createTestWorld, createItem, createPayment, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { truncateAllTables, closeTestDb } from "../helpers/test-db.js";

let world: TestWorld;
let itemId: string;
let owner: ReturnType<typeof createTestCaller>;
let seller: ReturnType<typeof createTestCaller>;

function callerFor(user: { id: string; email: string; name: string | null }) {
  return createTestCaller({
    userId: user.id,
    email: user.email,
    name: user.name,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });
}

function input(type: "sale" | "purchase", documentType?: string) {
  return {
    partyId: world.party1.id,
    type,
    ...(documentType ? { documentType } : {}),
    invoiceDate: new Date().toISOString(),
    lineItems: [{ itemId, itemName: "Lifecycle line", quantity: "1", unitPrice: "100.00", taxPercent: "0.00" }],
  } as never;
}

beforeAll(async () => {
  world = await createTestWorld();
  const item = await createItem(world.tenantDb, world.business1.id, {
    name: "Lifecycle Item",
    stockQuantity: "1000.000",
    salePrice: "100.00",
    purchasePrice: "80.00",
    taxPercent: "0.00",
  });
  itemId = item.id;
  owner = callerFor(world.ramesh);
  seller = callerFor(world.suresh);
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

async function allocate(invoiceId: string) {
  const payment = await createPayment(world.tenantDb, world.business1.id, world.party1.id, { amount: "100.00" });
  await world.tenantDb.insert(paymentAllocations).values({ paymentId: payment.id, invoiceId, amount: "100.00" });
}

describe("seller purchase-side restriction", () => {
  it("invoice.create type purchase is FORBIDDEN for sellers, allowed for owner", async () => {
    await expect(seller.invoice.create(input("purchase"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await owner.invoice.create(input("purchase"))).id).toBeTruthy();
  });

  it("sellers can still create sale invoices", async () => {
    expect((await seller.invoice.create(input("sale"))).id).toBeTruthy();
  });

  it("document.convert cannot be used to sidestep it", async () => {
    const quotation = await owner.quotation.create(input("purchase"));
    await expect(
      seller.document.convert({ sourceDocumentId: quotation.id, targetDocumentType: "invoice" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("delete / cancel guards", () => {
  it("invoice.delete is blocked while allocations exist, and works after they go", async () => {
    const inv = await owner.invoice.create(input("sale"));
    await allocate(inv.id);
    await expect(owner.invoice.delete({ id: inv.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("payment allocation"),
    });
    await world.tenantDb.delete(paymentAllocations).where(eq(paymentAllocations.invoiceId, inv.id));
    expect(await owner.invoice.delete({ id: inv.id })).toEqual({ success: true });
  });

  it("invoice.delete is blocked on amountPaid > 0 alone", async () => {
    const inv = await owner.invoice.create(input("sale"));
    await world.tenantDb.update(invoices).set({ amountPaid: "10.00" }).where(eq(invoices.id, inv.id));
    await expect(owner.invoice.delete({ id: inv.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("invoice.updateStatus cancelled is blocked while allocations exist", async () => {
    const inv = await owner.invoice.create(input("sale"));
    await allocate(inv.id);
    await expect(owner.invoice.updateStatus({ id: inv.id, status: "cancelled" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("an active IRN blocks delete and cancel; a cancelled IRN does not", async () => {
    const inv = await owner.invoice.create(input("sale"));
    await world.tenantDb.update(invoices).set({ irn: "a".repeat(64), eInvoiceStatus: "generated" }).where(eq(invoices.id, inv.id));
    await expect(owner.invoice.delete({ id: inv.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("e-invoice"),
    });
    await expect(owner.invoice.updateStatus({ id: inv.id, status: "cancelled" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await world.tenantDb.update(invoices).set({ eInvoiceStatus: "cancelled" }).where(eq(invoices.id, inv.id));
    expect(await owner.invoice.delete({ id: inv.id })).toEqual({ success: true });
  });

  it("factory delete and cancel are blocked for allocated / IRN documents", async () => {
    const cn = await owner.creditNote.create(input("sale"));
    await allocate(cn.id);
    await expect(owner.creditNote.delete({ id: cn.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(owner.creditNote.updateStatus({ id: cn.id, status: "cancelled" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });

    const sr = await owner.salesReturn.create(input("sale"));
    await world.tenantDb.update(invoices).set({ irn: "b".repeat(64), eInvoiceStatus: "generated" }).where(eq(invoices.id, sr.id));
    await expect(owner.salesReturn.delete({ id: sr.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("factory status transitions", () => {
  it("allows the lifecycle path and rejects out-of-table moves", async () => {
    const cn = await owner.creditNote.create(input("sale"));
    await expect(owner.creditNote.updateStatus({ id: cn.id, status: "paid" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect((await owner.creditNote.updateStatus({ id: cn.id, status: "sent" })).status).toBe("sent");
    expect((await owner.creditNote.updateStatus({ id: cn.id, status: "paid" })).status).toBe("paid");
    await expect(owner.creditNote.updateStatus({ id: cn.id, status: "cancelled" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("cancelled is terminal", async () => {
    const q = await owner.quotation.create(input("sale"));
    await owner.quotation.updateStatus({ id: q.id, status: "cancelled" });
    await expect(owner.quotation.updateStatus({ id: q.id, status: "draft" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("Cannot change"),
    });
  });

  it("delivery challans cannot return from sent to draft", async () => {
    const dc = await owner.deliveryChallan.create(input("sale"));
    await owner.deliveryChallan.updateStatus({ id: dc.id, status: "sent" });
    await expect(owner.deliveryChallan.updateStatus({ id: dc.id, status: "draft" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("unknown documents are NOT_FOUND", async () => {
    await expect(
      owner.quotation.updateStatus({ id: "00000000-0000-0000-0000-000000000001", status: "sent" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
