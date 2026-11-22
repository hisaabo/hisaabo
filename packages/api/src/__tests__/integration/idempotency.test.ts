/**
 * idempotency.test.ts — a retried or double-submitted create must not double-book.
 *
 * invoice.create and payment.create take an optional `idempotencyKey`. The claim
 * row is written in the same transaction as the record, so:
 *
 *   - same key + same input  → the first call's record, no second row, no second
 *                               audit entry, no second stock movement or payment
 *   - same key + other input → CONFLICT
 *   - a create that fails    → leaves no claim behind, a retry runs normally
 *   - two racing requests    → exactly one record
 *   - keys are per user and per business, and expire
 *   - no key                 → behaves exactly as before
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { auditLog, idempotencyKeys, invoices, items, payments } from "@hisaabo/db";
import {
  addMember,
  createBusiness,
  createItem,
  createParty,
  createTestWorld,
  createUser,
  type TestWorld,
} from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { countIdempotencyKeys, canonicalize, hashRequest } from "../../lib/idempotency.js";

let world: TestWorld;

beforeAll(async () => {
  world = await createTestWorld();
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

function caller(overrides: { userId?: string; email?: string; name?: string | null; businessId?: string } = {}) {
  return createTestCaller({
    userId: overrides.userId ?? world.ramesh.id,
    email: overrides.email ?? world.ramesh.email,
    name: overrides.name ?? world.ramesh.name,
    tenantId: world.tenant1.id,
    businessId: overrides.businessId ?? world.business1.id,
  });
}

let counter = 0;
const newKey = (label = "key") => `test-${label}-${Date.now()}-${++counter}`;

async function customer() {
  return createParty(world.tenantDb, world.business1.id, { name: `Idem Customer ${++counter}`, gstin: null });
}

function invoiceInput(partyId: string, overrides: Record<string, unknown> = {}) {
  return {
    partyId,
    type: "sale" as const,
    lineItems: [{ itemName: "Web Design", quantity: "1", unitPrice: "1000.00", taxPercent: "18.00" }],
    ...overrides,
  };
}

async function invoiceCount(partyId: string) {
  const rows = await getTenantTestDb().select({ id: invoices.id }).from(invoices).where(eq(invoices.partyId, partyId));
  return rows.length;
}

async function auditRows(action: string, entityId: string) {
  return getTenantTestDb()
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, action), eq(auditLog.entityId, entityId)));
}

describe("canonicalize / hashRequest", () => {
  it("ignores key order, undefined fields and the idempotencyKey itself", () => {
    const a = { b: 1, a: [{ y: 2, x: 1 }], idempotencyKey: "one" };
    const b = { a: [{ x: 1, y: 2 }], b: 1, extra: undefined, idempotencyKey: "two" };
    expect(canonicalize(a)).toBe(canonicalize(b));
    expect(hashRequest(a)).toBe(hashRequest(b));
  });

  it("distinguishes different inputs", () => {
    expect(hashRequest({ amount: "10.00" })).not.toBe(hashRequest({ amount: "10.01" }));
    expect(hashRequest({ a: [1, 2] })).not.toBe(hashRequest({ a: [2, 1] }));
  });
});

describe("invoice.create with an idempotency key", () => {
  it("returns the first invoice for an identical retry and books it once", async () => {
    const party = await customer();
    const key = newKey("invoice");
    const input = invoiceInput(party.id, { idempotencyKey: key });

    const first = await caller().invoice.create(input);
    const second = await caller().invoice.create(input);

    expect(second.id).toBe(first.id);
    expect(second.invoiceNumber).toBe(first.invoiceNumber);
    expect(second.totalAmount).toBe("1180.00");
    expect(await invoiceCount(party.id)).toBe(1);
    // The replay is invisible to the audit trail.
    expect(await auditRows("invoice.create", first.id)).toHaveLength(1);
  });

  it("restores dates and numbers in the replayed record", async () => {
    const party = await customer();
    const input = invoiceInput(party.id, { idempotencyKey: newKey("dates"), dueDate: "2026-12-01T00:00:00.000Z" });
    const first = await caller().invoice.create(input);
    const second = await caller().invoice.create(input);
    expect(second.dueDate).toBeInstanceOf(Date);
    expect(second.dueDate!.toISOString()).toBe(first.dueDate!.toISOString());
    expect(second.createdAt).toBeInstanceOf(Date);
    expect(second).toEqual(first);
  });

  it("consumes the invoice number once and moves stock once", async () => {
    const item = await createItem(world.tenantDb, world.business1.id, { stockQuantity: "50.000" });
    const party = await customer();
    const input = invoiceInput(party.id, {
      idempotencyKey: newKey("stock"),
      lineItems: [{ itemId: item.id, itemName: item.name, quantity: "5", unitPrice: "250.00", taxPercent: "5.00" }],
    });

    const first = await caller().invoice.create(input);
    await caller().invoice.create(input);
    await caller().invoice.create(input);

    const [row] = await getTenantTestDb().select({ stock: items.stockQuantity }).from(items).where(eq(items.id, item.id));
    expect(Number(row.stock)).toBe(45);

    // The next un-keyed invoice gets the very next number: nothing was skipped.
    const next = await caller().invoice.create(invoiceInput(party.id));
    const prefix = first.invoiceNumber.split("-")[0];
    expect(next.invoiceNumber).toBe(`${prefix}-${String(Number(first.invoiceNumber.split("-")[1]) + 1).padStart(5, "0")}`);
  });

  it("rejects the same key with different input, and creates nothing", async () => {
    const party = await customer();
    const key = newKey("conflict");
    await caller().invoice.create(invoiceInput(party.id, { idempotencyKey: key }));

    await expect(
      caller().invoice.create(
        invoiceInput(party.id, {
          idempotencyKey: key,
          lineItems: [{ itemName: "Web Design", quantity: "2", unitPrice: "1000.00", taxPercent: "18.00" }],
        }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/different request/) });
    expect(await invoiceCount(party.id)).toBe(1);
  });

  it("treats a retry with fields in another order as the same request", async () => {
    const party = await customer();
    const key = newKey("order");
    const first = await caller().invoice.create({
      idempotencyKey: key,
      type: "sale",
      partyId: party.id,
      lineItems: [{ unitPrice: "1000.00", quantity: "1", itemName: "Web Design", taxPercent: "18.00" }],
    });
    const second = await caller().invoice.create(invoiceInput(party.id, { idempotencyKey: key }));
    expect(second.id).toBe(first.id);
  });

  it("creates a new invoice each time when no key is sent (behaviour unchanged)", async () => {
    const party = await customer();
    const a = await caller().invoice.create(invoiceInput(party.id));
    const b = await caller().invoice.create(invoiceInput(party.id));
    expect(b.id).not.toBe(a.id);
    expect(await invoiceCount(party.id)).toBe(2);
  });

  it("books exactly one invoice when two identical requests race", async () => {
    const party = await customer();
    const input = invoiceInput(party.id, { idempotencyKey: newKey("race") });
    const results = await Promise.all([
      caller().invoice.create(input),
      caller().invoice.create(input),
      caller().invoice.create(input),
    ]);
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(await invoiceCount(party.id)).toBe(1);
  });

  it("leaves no claim behind when the create fails, so a corrected retry with the same key works", async () => {
    const party = await customer();
    const key = newKey("failed");
    const before = await countIdempotencyKeys(getTenantTestDb(), world.business1.id);

    await expect(
      caller().invoice.create(
        invoiceInput("00000000-0000-4000-8000-000000000000", { idempotencyKey: key }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await countIdempotencyKeys(getTenantTestDb(), world.business1.id)).toBe(before);

    const created = await caller().invoice.create(invoiceInput(party.id, { idempotencyKey: key }));
    expect(created.partyId).toBe(party.id);
  });

  it("keeps keys apart per user", async () => {
    const party = await customer();
    const key = newKey("user");
    // A second owner-level member of the same business.
    const other = await createUser({ email: `idem-other-${Date.now()}@example.in`, name: "Other Admin" });
    await addMember(world.tenant1.id, other.id, "admin");

    const mine = await caller().invoice.create(invoiceInput(party.id, { idempotencyKey: key }));
    const theirs = await caller({ userId: other.id, email: other.email, name: other.name }).invoice.create(
      invoiceInput(party.id, { idempotencyKey: key }),
    );
    expect(theirs.id).not.toBe(mine.id);
    expect(await invoiceCount(party.id)).toBe(2);
  });

  it("keeps keys apart per business", async () => {
    const second = await createBusiness(world.tenantDb, world.ramesh.id, { name: "Second Shop" });
    const partyA = await customer();
    const partyB = await createParty(world.tenantDb, second.id, { name: "Other Biz Customer", gstin: null });
    const key = newKey("biz");

    const a = await caller().invoice.create(invoiceInput(partyA.id, { idempotencyKey: key }));
    const b = await caller({ businessId: second.id }).invoice.create(invoiceInput(partyB.id, { idempotencyKey: key }));
    expect(b.id).not.toBe(a.id);
    expect(b.businessId).toBe(second.id);
  });

  it("forgets a key after the window, so a later identical request creates a new invoice", async () => {
    const party = await customer();
    const key = newKey("expiry");
    const input = invoiceInput(party.id, { idempotencyKey: key });
    const first = await caller().invoice.create(input);

    await getTenantTestDb()
      .update(idempotencyKeys)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(and(eq(idempotencyKeys.businessId, world.business1.id), eq(idempotencyKeys.key, key)));

    const again = await caller().invoice.create(input);
    expect(again.id).not.toBe(first.id);
    expect(await invoiceCount(party.id)).toBe(2);
  });

  it("purges expired claims of the business on the next keyed write", async () => {
    const party = await customer();
    const stale = newKey("stale");
    await caller().invoice.create(invoiceInput(party.id, { idempotencyKey: stale }));
    await getTenantTestDb()
      .update(idempotencyKeys)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(idempotencyKeys.key, stale));

    await caller().invoice.create(invoiceInput(party.id, { idempotencyKey: newKey("fresh") }));
    const rows = await getTenantTestDb().select({ key: idempotencyKeys.key }).from(idempotencyKeys);
    expect(rows.map((r) => r.key)).not.toContain(stale);
  });

  it("rejects a malformed key", async () => {
    const party = await customer();
    for (const bad of ["short", "has space in it", "x".repeat(101), "bad/key/chars"]) {
      await expect(caller().invoice.create(invoiceInput(party.id, { idempotencyKey: bad }))).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    }
  });
});

describe("payment.create with an idempotency key", () => {
  async function openInvoice(total = "1000.00") {
    const party = await customer();
    const invoice = await caller().invoice.create(
      invoiceInput(party.id, {
        lineItems: [{ itemName: "Consulting", quantity: "1", unitPrice: total, taxPercent: "0" }],
      }),
    );
    return { party, invoice };
  }

  it("records a retried payment once", async () => {
    const { party, invoice } = await openInvoice("1000.00");
    const input = { partyId: party.id, invoiceId: invoice.id, amount: "400.00", mode: "upi" as const, idempotencyKey: newKey("pay") };

    const first = await caller().payment.create(input);
    const second = await caller().payment.create(input);

    expect(second.id).toBe(first.id);
    expect(second.paymentNumber).toBe(first.paymentNumber);
    const rows = await getTenantTestDb().select({ id: payments.id }).from(payments).where(eq(payments.partyId, party.id));
    expect(rows).toHaveLength(1);

    const [row] = await getTenantTestDb()
      .select({ paid: invoices.amountPaid, status: invoices.status })
      .from(invoices)
      .where(eq(invoices.id, invoice.id));
    expect(row.paid).toBe("400.00");
    expect(row.status).toBe("partial");
    expect(await auditRows("payment.create", first.id)).toHaveLength(1);
  });

  it("applies the money once when identical requests race", async () => {
    const { party, invoice } = await openInvoice("1000.00");
    const input = { partyId: party.id, invoiceId: invoice.id, amount: "250.00", mode: "cash" as const, idempotencyKey: newKey("pay-race") };
    const results = await Promise.all([caller().payment.create(input), caller().payment.create(input)]);
    expect(results[0].id).toBe(results[1].id);
    const [row] = await getTenantTestDb().select({ paid: invoices.amountPaid }).from(invoices).where(eq(invoices.id, invoice.id));
    expect(row.paid).toBe("250.00");
  });

  it("rejects the same key with a different amount and changes nothing", async () => {
    const { party, invoice } = await openInvoice("1000.00");
    const key = newKey("pay-conflict");
    await caller().payment.create({ partyId: party.id, invoiceId: invoice.id, amount: "100.00", mode: "upi", idempotencyKey: key });
    await expect(
      caller().payment.create({ partyId: party.id, invoiceId: invoice.id, amount: "900.00", mode: "upi", idempotencyKey: key }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const [row] = await getTenantTestDb().select({ paid: invoices.amountPaid }).from(invoices).where(eq(invoices.id, invoice.id));
    expect(row.paid).toBe("100.00");
  });

  it("does not share keys between procedures", async () => {
    const { party, invoice } = await openInvoice("1000.00");
    const key = newKey("scope");
    const created = await caller().invoice.create(invoiceInput(party.id, { idempotencyKey: key }));
    const payment = await caller().payment.create({
      partyId: party.id,
      invoiceId: invoice.id,
      amount: "10.00",
      mode: "cash",
      idempotencyKey: key,
    });
    expect(payment.id).not.toBe(created.id);
  });

  it("behaves exactly as before without a key", async () => {
    const { party, invoice } = await openInvoice("1000.00");
    const a = await caller().payment.create({ partyId: party.id, invoiceId: invoice.id, amount: "100.00", mode: "cash" });
    const b = await caller().payment.create({ partyId: party.id, invoiceId: invoice.id, amount: "100.00", mode: "cash" });
    expect(b.id).not.toBe(a.id);
  });
});
