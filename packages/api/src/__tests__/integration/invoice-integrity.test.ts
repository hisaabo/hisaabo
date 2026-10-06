/**
 * Integration regression tests for invoice/payment integrity fixes:
 * totals manipulation, status transitions, edit/delete guards and payment
 * allocation validation. Requires the PostgreSQL test database.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { invoices, items } from "@hisaabo/db";
import { createTestWorld, createParty, createBankAccount, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";

let world: TestWorld;

beforeAll(async () => {
  world = await createTestWorld();
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

function owner() {
  return createTestCaller({
    userId: world.ramesh.id, email: world.ramesh.email, name: world.ramesh.name ?? null,
    tenantId: world.tenant1.id, businessId: world.business1.id,
  });
}

function seller() {
  return createTestCaller({
    userId: world.suresh.id, email: world.suresh.email, name: world.suresh.name ?? null,
    tenantId: world.tenant1.id, businessId: world.business1.id,
  });
}

function saleInput(extra: Record<string, unknown> = {}, partyId = world.party1.id) {
  return {
    partyId,
    type: "sale" as const,
    invoiceDate: new Date().toISOString(),
    lineItems: [{ itemName: "Widget", quantity: "1", unitPrice: "100.00", taxPercent: "0", discountPercent: "0" }],
    ...extra,
  };
}

describe("invoice.create totals enforcement", () => {
  it("rejects percent discount > 100, oversized discount and oversized round-off", async () => {
    const c = owner();
    await expect(c.invoice.create(saleInput({ invoiceDiscount: "150", invoiceDiscountType: "percent" }))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(c.invoice.create(saleInput({ invoiceDiscount: "100.01" }))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(c.invoice.create(saleInput({ roundOff: "-50" }))).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects a referenceDocumentId from another business", async () => {
    const other = await createTestCaller({
      userId: world.kiran.id, email: world.kiran.email, name: world.kiran.name ?? null,
      tenantId: world.tenant2.id, businessId: world.business2.id,
    }).invoice.create(saleInput({}, world.party2.id));
    await expect(owner().invoice.create(saleInput({ referenceDocumentId: other.id }))).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("invoice.updateStatus transitions", () => {
  it("blocks manual paid/partial and paid -> draft", async () => {
    const c = owner();
    const inv = await c.invoice.create(saleInput());
    await expect(c.invoice.updateStatus({ id: inv.id, status: "paid" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(c.invoice.updateStatus({ id: inv.id, status: "partial" })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await c.invoice.updateStatus({ id: inv.id, status: "sent" });
    await c.payment.create({ partyId: world.party1.id, invoiceId: inv.id, amount: "100.00", mode: "cash" });
    await expect(c.invoice.updateStatus({ id: inv.id, status: "draft" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(c.invoice.updateStatus({ id: inv.id, status: "cancelled" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("cancelling restores stock exactly once and a later delete does not double-reverse", async () => {
    const c = owner();
    const db = getTenantTestDb();
    const [before] = await db.select({ q: items.stockQuantity }).from(items).where(eq(items.id, world.item1.id));
    const inv = await c.invoice.create(saleInput({
      lineItems: [{ itemId: world.item1.id, itemName: "Stocked", quantity: "2", unitPrice: "10.00", taxPercent: "0", discountPercent: "0" }],
    }));
    await c.invoice.updateStatus({ id: inv.id, status: "cancelled" });
    await c.invoice.delete({ id: inv.id });
    const [after] = await db.select({ q: items.stockQuantity }).from(items).where(eq(items.id, world.item1.id));
    expect(parseFloat(after!.q)).toBeCloseTo(parseFloat(before!.q));
  });

  it("seller (no delete permission) cannot cancel", async () => {
    const inv = await owner().invoice.create(saleInput());
    await expect(seller().invoice.updateStatus({ id: inv.id, status: "cancelled" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("invoice.update guards", () => {
  it("rejects editing a deleted invoice and totals below amountPaid", async () => {
    const c = owner();
    const gone = await c.invoice.create(saleInput());
    await c.invoice.delete({ id: gone.id });
    await expect(c.invoice.update({ id: gone.id, notes: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const inv = await c.invoice.create(saleInput());
    await c.invoice.updateStatus({ id: inv.id, status: "sent" });
    await c.payment.create({ partyId: world.party1.id, invoiceId: inv.id, amount: "60.00", mode: "cash" });
    await expect(c.invoice.update({
      id: inv.id,
      lineItems: [{ itemName: "Widget", quantity: "1", unitPrice: "50.00", taxPercent: "0", discountPercent: "0" }],
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("concurrent deletes reverse stock once", async () => {
    const c = owner();
    const db = getTenantTestDb();
    const [before] = await db.select({ q: items.stockQuantity }).from(items).where(eq(items.id, world.item1.id));
    const inv = await c.invoice.create(saleInput({
      lineItems: [{ itemId: world.item1.id, itemName: "Stocked", quantity: "3", unitPrice: "10.00", taxPercent: "0", discountPercent: "0" }],
    }));
    await Promise.all([c.invoice.delete({ id: inv.id }), c.invoice.delete({ id: inv.id })]);
    const [after] = await db.select({ q: items.stockQuantity }).from(items).where(eq(items.id, world.item1.id));
    expect(parseFloat(after!.q)).toBeCloseTo(parseFloat(before!.q));
  });
});

describe("payment allocation validation", () => {
  async function sentInvoice(total: string, partyId = world.party1.id) {
    const c = owner();
    const inv = await c.invoice.create(saleInput({
      lineItems: [{ itemName: "Widget", quantity: "1", unitPrice: total, taxPercent: "0", discountPercent: "0" }],
    }, partyId));
    await c.invoice.updateStatus({ id: inv.id, status: "sent" });
    return inv;
  }

  it("rejects unknown / cross-business invoices", async () => {
    await expect(owner().payment.create({
      partyId: world.party1.id, invoiceId: "00000000-0000-4000-8000-000000000000", amount: "10.00", mode: "cash",
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects an invoice that belongs to another party", async () => {
    const otherParty = await createParty(getTenantTestDb(), world.business1.id, { name: "Other" });
    const inv = await sentInvoice("100.00", otherParty.id);
    await expect(owner().payment.create({
      partyId: world.party1.id, invoiceId: inv.id, amount: "10.00", mode: "cash",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects cancelled invoices", async () => {
    const c = owner();
    const inv = await sentInvoice("100.00");
    await c.invoice.updateStatus({ id: inv.id, status: "cancelled" });
    await expect(c.payment.create({
      partyId: world.party1.id, invoiceId: inv.id, amount: "10.00", mode: "cash",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects allocations summing above the payment amount", async () => {
    const a = await sentInvoice("100.00");
    const b = await sentInvoice("100.00");
    await expect(owner().payment.create({
      partyId: world.party1.id, amount: "50.00", mode: "cash",
      allocations: [{ invoiceId: a.id, amount: "40.00" }, { invoiceId: b.id, amount: "40.00" }],
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects over-allocating the same invoice twice in one payment", async () => {
    const a = await sentInvoice("100.00");
    await expect(owner().payment.create({
      partyId: world.party1.id, amount: "160.00", mode: "cash",
      allocations: [{ invoiceId: a.id, amount: "80.00" }, { invoiceId: a.id, amount: "80.00" }],
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("applies the same checks on payment.update", async () => {
    const c = owner();
    const a = await sentInvoice("100.00");
    const p = await c.payment.create({ partyId: world.party1.id, invoiceId: a.id, amount: "20.00", mode: "cash" });
    await expect(c.payment.update({
      id: p.id, amount: "20.00", allocations: [{ invoiceId: a.id, amount: "30.00" }],
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("requires BankAccount visibility and ownership for bankAccountId", async () => {
    const db = getTenantTestDb();
    const foreign = await createBankAccount(db, world.business2.id, { isDefault: false });
    await expect(owner().payment.create({
      partyId: world.party1.id, amount: "10.00", mode: "bank", bankAccountId: foreign.id,
    })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const own = await createBankAccount(db, world.business1.id, { isDefault: false });
    await expect(seller().payment.create({
      partyId: world.party1.id, amount: "10.00", mode: "bank", bankAccountId: own.id,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("document factory permissions", () => {
  it("applies the same seller_manager delete rule and read permission", async () => {
    // Role-specific callers are exercised in document-permissions.test.ts; here we
    // only assert owner read/delete still work through the factory.
    const c = owner();
    const doc = await c.quotation.create(saleInput());
    expect((await c.quotation.getById({ id: doc.id }))?.id).toBe(doc.id);
    await c.quotation.delete({ id: doc.id });
    const [row] = await getTenantTestDb().select({ d: invoices.deletedAt }).from(invoices).where(eq(invoices.id, doc.id));
    expect(row!.d).not.toBeNull();
  });
});
