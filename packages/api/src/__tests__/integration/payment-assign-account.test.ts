/**
 * Integration tests for payment.assignAccount (bulk assign) and for
 * multiple allocations in one payment.create call.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { invoices, payments, bankAccounts, bankTransactions } from "@hisaabo/db";
import {
  createTestWorld,
  createInvoiceWithItems,
  createPayment,
  createBankAccount,
  type TestWorld,
} from "../helpers/fixtures.js";
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

function callerForRamesh() {
  return createTestCaller({
    userId: world.ramesh.id,
    email: world.ramesh.email,
    name: world.ramesh.name ?? null,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });
}

describe("payment.assignAccount", () => {
  it("assigns mixed sale-linked, purchase-linked and unlinked payments in bulk", async () => {
    const db = getTenantTestDb();
    const caller = callerForRamesh();
    const account = await createBankAccount(db, world.business1.id, {
      accountName: "Bulk Assign", currentBalance: "100.00", isDefault: false,
    });

    const { invoice: sale } = await createInvoiceWithItems(db, world.business1.id, world.party1.id,
      [{ quantity: "1", unitPrice: "1000" }], { type: "sale", status: "sent" });
    const { invoice: purchase } = await createInvoiceWithItems(db, world.business1.id, world.party1.id,
      [{ quantity: "1", unitPrice: "1000" }], { type: "purchase", status: "sent" });

    const pSale = await createPayment(db, world.business1.id, world.party1.id, { amount: "300.00", invoiceId: sale.id });
    const pPurchase = await createPayment(db, world.business1.id, world.party1.id, { amount: "120.50", invoiceId: purchase.id });
    const pFree = await createPayment(db, world.business1.id, world.party1.id, { amount: "50.25" });
    const pAssigned = await createPayment(db, world.business1.id, world.party1.id, {
      amount: "999.00", bankAccountId: (await createBankAccount(db, world.business1.id, { accountName: "Other", isDefault: false })).id,
    });
    const missing = "00000000-0000-4000-8000-000000000000";

    const res = await caller.payment.assignAccount({
      // duplicate id, already-assigned and unknown ids are skipped silently
      paymentIds: [pSale.id, pPurchase.id, pFree.id, pSale.id, pAssigned.id, missing],
      bankAccountId: account.id,
    });
    expect(res).toEqual({ assigned: 6 });

    const rows = await db.select().from(bankTransactions)
      .where(eq(bankTransactions.bankAccountId, account.id));
    expect(rows).toHaveLength(3);
    const byRef = new Map(rows.map((r) => [r.referenceId, r]));
    expect(byRef.get(pSale.id)).toMatchObject({ type: "deposit", amount: "300.00", referenceType: "payment" });
    expect(byRef.get(pPurchase.id)).toMatchObject({ type: "withdrawal", amount: "120.50" });
    expect(byRef.get(pFree.id)).toMatchObject({ type: "deposit", amount: "50.25" });
    expect(byRef.get(pSale.id)!.description).toContain("(assigned)");

    const [acct] = await db.select({ b: bankAccounts.currentBalance }).from(bankAccounts).where(eq(bankAccounts.id, account.id));
    expect(acct!.b).toBe("329.75"); // 100 + 300 - 120.50 + 50.25

    for (const p of [pSale, pPurchase, pFree]) {
      const [row] = await db.select({ b: payments.bankAccountId }).from(payments).where(eq(payments.id, p.id));
      expect(row!.b).toBe(account.id);
    }
    const [untouched] = await db.select({ b: payments.bankAccountId }).from(payments).where(eq(payments.id, pAssigned.id));
    expect(untouched!.b).not.toBe(account.id);
  });

  it("allMatching assigns every untracked payment and honours the mode filter", async () => {
    const db = getTenantTestDb();
    const caller = callerForRamesh();
    const account = await createBankAccount(db, world.business1.id, { accountName: "AllMatch", isDefault: false });
    const upi = await createPayment(db, world.business1.id, world.party1.id, { amount: "10.00", mode: "upi" });
    const upi2 = await createPayment(db, world.business1.id, world.party1.id, { amount: "20.00", mode: "upi" });

    const res = await caller.payment.assignAccount({ allMatching: true, mode: "upi", bankAccountId: account.id });
    expect(res.assigned).toBe(2);

    const rows = await db.select({ ref: bankTransactions.referenceId }).from(bankTransactions)
      .where(and(eq(bankTransactions.bankAccountId, account.id)));
    expect(rows.map((r) => r.ref)).toEqual(expect.arrayContaining([upi.id, upi2.id]));
    const [a] = await db.select({ b: bankAccounts.currentBalance }).from(bankAccounts).where(eq(bankAccounts.id, account.id));
    expect(rows).toHaveLength(2);
    expect(a!.b).toBe("30.00");
  });

  it("never lists or assigns soft-deleted payments", async () => {
    const db = getTenantTestDb();
    const caller = callerForRamesh();
    const account = await createBankAccount(db, world.business1.id, { accountName: "SoftDel", isDefault: false });
    const live = await createPayment(db, world.business1.id, world.party1.id, { amount: "11.00", mode: "other" });
    const deleted = await createPayment(db, world.business1.id, world.party1.id, {
      amount: "22.00", mode: "other", deletedAt: new Date(),
    });

    const listed = await caller.payment.untrackedPayments({ mode: "other" });
    expect(listed.data.map((p) => p.id)).toEqual([live.id]);
    expect(listed.total).toBe(1);

    // Explicit id path
    await caller.payment.assignAccount({ paymentIds: [deleted.id], bankAccountId: account.id });
    // allMatching path
    const res = await caller.payment.assignAccount({ allMatching: true, mode: "other", bankAccountId: account.id });
    expect(res.assigned).toBe(1); // only the live payment matched

    const [row] = await db.select({ b: payments.bankAccountId }).from(payments).where(eq(payments.id, deleted.id));
    expect(row!.b).toBeNull();
    const txns = await db.select().from(bankTransactions).where(eq(bankTransactions.bankAccountId, account.id));
    expect(txns.map((t) => t.referenceId)).toEqual([live.id]);
    const [acct] = await db.select({ b: bankAccounts.currentBalance }).from(bankAccounts).where(eq(bankAccounts.id, account.id));
    expect(acct!.b).toBe("11.00");
  });

  it("returns assigned 0 for an empty list and rejects unknown accounts", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();
    const account = await createBankAccount(db, world.business1.id, { accountName: "Empty", isDefault: false });
    expect(await caller.payment.assignAccount({ paymentIds: [], bankAccountId: account.id })).toEqual({ assigned: 0 });
    await expect(caller.payment.assignAccount({
      paymentIds: [], bankAccountId: "00000000-0000-4000-8000-000000000000",
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("payment.create with multiple allocations", () => {
  async function saleInvoice(total: string) {
    const db = getTenantTestDb();
    const { invoice } = await createInvoiceWithItems(db, world.business1.id, world.party1.id,
      [{ quantity: "1", unitPrice: total }], { type: "sale", status: "sent" });
    return invoice;
  }

  it("applies two allocations to different invoices", async () => {
    const db = getTenantTestDb();
    const a = await saleInvoice("300");
    const b = await saleInvoice("700");
    await callerForRamesh().payment.create({
      partyId: world.party1.id, amount: "800.00", mode: "cash",
      allocations: [{ invoiceId: a.id, amount: "300.00" }, { invoiceId: b.id, amount: "500.00" }],
    });
    const [ra] = await db.select().from(invoices).where(eq(invoices.id, a.id));
    const [rb] = await db.select().from(invoices).where(eq(invoices.id, b.id));
    expect([ra!.amountPaid, ra!.status]).toEqual(["300.00", "paid"]);
    expect([rb!.amountPaid, rb!.status]).toEqual(["500.00", "partial"]);
  });

  it("validates repeated allocations to the same invoice cumulatively", async () => {
    const db = getTenantTestDb();
    const inv = await saleInvoice("1000");
    const caller = callerForRamesh();

    await caller.payment.create({
      partyId: world.party1.id, amount: "900.00", mode: "cash",
      allocations: [{ invoiceId: inv.id, amount: "400.00" }, { invoiceId: inv.id, amount: "500.00" }],
    });
    const [row] = await db.select().from(invoices).where(eq(invoices.id, inv.id));
    expect([row!.amountPaid, row!.status]).toEqual(["900.00", "partial"]);

    // Remaining balance is 100: 60 + 60 must fail on the second and roll back
    await expect(caller.payment.create({
      partyId: world.party1.id, amount: "120.00", mode: "cash",
      allocations: [{ invoiceId: inv.id, amount: "60.00" }, { invoiceId: inv.id, amount: "60.00" }],
    })).rejects.toMatchObject({ message: expect.stringContaining("exceeds invoice balance") });
    const [after] = await db.select().from(invoices).where(eq(invoices.id, inv.id));
    expect(after!.amountPaid).toBe("900.00");
  });
});
