/**
 * receivables-consistency.test.ts
 *
 * The Dashboard "Receivable" card and the Aging Report "Total Outstanding"
 * must always be the same number. Both are: outstanding invoices + debit notes
 * (partial payments applied) - credit notes - sales returns + customers'
 * opening balances; drafts, cancelled, soft-deleted documents and
 * non-financial documents (quotations) are excluded.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestWorld, createInvoiceWithItems, createParty, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { truncateAllTables, closeTestDb, getTenantTestDb } from "../helpers/test-db.js";

let world: TestWorld;

function caller() {
  return createTestCaller({
    userId: world.ramesh.id,
    email: world.ramesh.email,
    name: world.ramesh.name,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

async function doc(
  partyId: string,
  amount: string,
  overrides: Parameters<typeof createInvoiceWithItems>[4],
) {
  return createInvoiceWithItems(
    getTenantTestDb(),
    world.business1.id,
    partyId,
    [{ description: "Goods", quantity: "1", unitPrice: amount, taxPercent: "0.00" }],
    { type: "sale", status: "sent", ...overrides },
  );
}

beforeAll(async () => {
  world = await createTestWorld();
  const db = getTenantTestDb();
  const bizId = world.business1.id;

  const a = await createParty(db, bizId, { name: "Aging A", openingBalance: "500.00" });
  const b = await createParty(db, bizId, { name: "Aging B", openingBalance: "0.00" });
  const c = await createParty(db, bizId, { name: "Aging C", openingBalance: "0.00" });

  // A: 1000 invoice 10 days old, partially paid 400 -> 600 outstanding
  await doc(a.id, "1000.00", { invoiceDate: daysAgo(10), status: "partial", amountPaid: "400.00" });
  // A: 2000 invoice 100 days old, unpaid
  await doc(a.id, "2000.00", { invoiceDate: daysAgo(100), dueDate: daysAgo(95) });
  // A: credit note 300
  await doc(a.id, "300.00", { documentType: "credit_note", invoiceDate: daysAgo(5) });
  // B: fully paid invoice (excluded), 700 overdue 45 days, debit note 100
  await doc(b.id, "900.00", { status: "paid", amountPaid: "900.00" });
  await doc(b.id, "700.00", { status: "overdue", invoiceDate: daysAgo(50), dueDate: daysAgo(45) });
  await doc(b.id, "100.00", { documentType: "debit_note", invoiceDate: daysAgo(3) });
  // C: sales return 250 only (net credit), plus excluded noise
  await doc(c.id, "250.00", { documentType: "sales_return", invoiceDate: daysAgo(2) });
  await doc(c.id, "5000.00", { status: "draft" });
  await doc(c.id, "5000.00", { status: "cancelled" });
  await doc(c.id, "5000.00", { documentType: "quotation", status: "sent" });
  await doc(c.id, "5000.00", { deletedAt: new Date() });
  // A purchase document must never count
  await doc(c.id, "5000.00", { type: "purchase" });
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("receivable consistency", () => {
  it("dashboard receivable equals aging total on a seeded dataset", async () => {
    const [summary, aging] = await Promise.all([caller().dashboard.summary(undefined), caller().dashboard.receivablesAging()]);

    // A: 500 opening + 600 + 2000 - 300 = 2800
    // B: 700 + 100 = 800
    // C: -250
    // (the world's own fixture party has no documents here)
    expect(aging.summary.total).toBe("3350.00");
    expect(parseFloat(summary.receivable)).toBeCloseTo(3350, 2);
    expect(parseFloat(summary.receivable)).toBeCloseTo(parseFloat(aging.summary.total), 2);
  });

  it("aging rows sum to the summary and bucket as expected", async () => {
    const aging = await caller().dashboard.receivablesAging();
    const byName = Object.fromEntries(aging.rows.map((r) => [r.partyName, r]));

    expect(byName["Aging A"]).toMatchObject({ current: "300.00", days90Plus: "2500.00", total: "2800.00" });
    expect(byName["Aging B"]).toMatchObject({ current: "100.00", days31_60: "700.00", total: "800.00" });
    expect(byName["Aging C"]).toMatchObject({ current: "-250.00", total: "-250.00" });

    const sum = aging.rows.reduce((acc, r) => acc + parseFloat(r.total), 0);
    expect(sum).toBeCloseTo(parseFloat(aging.summary.total), 2);
    expect(aging.rows.every((r) => typeof r.partyId === "string")).toBe(true);
  });

  it("stays consistent after another partial payment is recorded", async () => {
    const db = getTenantTestDb();
    const d = await createParty(db, world.business1.id, { name: "Aging D" });
    await doc(d.id, "1000.00", { invoiceDate: daysAgo(1), status: "partial", amountPaid: "250.00" });
    const [summary, aging] = await Promise.all([caller().dashboard.summary(undefined), caller().dashboard.receivablesAging()]);
    expect(aging.summary.total).toBe("4100.00");
    expect(parseFloat(summary.receivable)).toBeCloseTo(4100, 2);
  });
});

describe("party.ledgerReport entries are openable", () => {
  it("returns type + documentId for invoices and payments and skips deleted payments", async () => {
    const db = getTenantTestDb();
    const { createPayment } = await import("../helpers/fixtures.js");
    const p = await createParty(db, world.business1.id, { name: "Ledger Link" });
    const { invoice } = await doc(p.id, "100.00", {});
    const live = await createPayment(db, world.business1.id, p.id, { amount: "40.00", invoiceId: invoice.id });
    await createPayment(db, world.business1.id, p.id, { amount: "60.00", deletedAt: new Date() });

    const ledger = await caller().party.ledgerReport({ partyId: p.id });
    expect(ledger).not.toBeNull();
    const inv = ledger!.entries.find((e) => e.type === "invoice");
    const pay = ledger!.entries.filter((e) => e.type === "payment");
    expect(inv?.documentId).toBe(invoice.id);
    expect(pay).toHaveLength(1);
    expect(pay[0]!.documentId).toBe(live.id);
  });
});
