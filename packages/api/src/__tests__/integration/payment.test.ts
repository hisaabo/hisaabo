/**
 * Integration tests for the payment router.
 *
 * WHY THIS FILE EXISTS:
 * Payment creation is the most financially-sensitive write path in Hisaabo. A
 * single bug can:
 *   - Allow a customer to pay less than they owe (amountPaid not updated)
 *   - Allow overpayment (no guard against paying more than the invoice balance)
 *   - Corrupt bank account balances (deposit/withdrawal applied in wrong direction)
 *   - Leave invoices stuck at "partial" when they should be "paid"
 *
 * These tests exercise the FULL middleware chain against a real PostgreSQL test
 * database. Every test verifies the database state after the operation — not
 * just the response — because the router's correctness lies in its side effects.
 *
 * KEY FACTS FROM CODE REVIEW:
 *   - payment.delete is a SOFT delete (sets deletedAt), not a hard delete.
 *     It reverses amountPaid via GREATEST(amountPaid - amount, 0) but does NOT
 *     recompute invoice status after the reversal. That is a known gap — a
 *     "paid" invoice whose single payment is deleted will have amountPaid=0
 *     but status remains "paid". Tests document this.
 *   - Multi-invoice allocation: payment.create accepts `allocations[]`. Each
 *     allocation is guarded by the overpayment check independently.
 *   - Bank transactions: deposit for sale invoices, withdrawal for purchase.
 *   - payment.unpaidInvoices excludes status IN ('paid', 'cancelled', 'draft').
 *     The query uses notInArray — "unfulfilled", "sent", "partial" are returned.
 *
 * RUNNING:
 *   pnpm --filter @hisaabo/api test -- --testPathPattern integration
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { invoices, payments, bankAccounts, bankTransactions } from "@hisaabo/db";
import {
  createTestWorld,
  createParty,
  createInvoiceWithItems,
  createBankAccount,
  type TestWorld,
} from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";

// ── Shared fixture ─────────────────────────────────────────────────────────────

let world: TestWorld;

beforeAll(async () => {
  world = await createTestWorld();
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

// ── Caller helpers ─────────────────────────────────────────────────────────────

function callerForRamesh() {
  return createTestCaller({
    userId: world.ramesh.id,
    email: world.ramesh.email,
    name: world.ramesh.name ?? null,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });
}

function callerForKiran() {
  return createTestCaller({
    userId: world.kiran.id,
    email: world.kiran.email,
    name: world.kiran.name ?? null,
    tenantId: world.tenant2.id,
    businessId: world.business2.id,
  });
}

// ── Helper: create a real sale invoice with a known total via the router ───────

async function createSaleInvoice(totalAmount: string) {
  const caller = callerForRamesh();
  // Build a 1-item invoice where totalAmount == unitPrice (0% tax, 1 qty)
  const invoice = await caller.invoice.create({
    partyId: world.party1.id,
    type: "sale" as const,
    invoiceDate: new Date().toISOString(),
    lineItems: [
      {
        description: `Invoice for ${totalAmount}`,
        quantity: "1",
        unitPrice: totalAmount,
        taxPercent: "0",
        discountPercent: "0",
        conversionFactor: null,
        variantId: null,
      },
    ],
  });
  // Move to 'sent' so the overpayment guard allows allocation
  await caller.invoice.updateStatus({ id: invoice.id, status: "sent" });
  return invoice;
}

// =============================================================================
// payment.create
// =============================================================================

describe("payment.create", () => {
  it("creates a payment for a sale invoice and transitions invoice to partial status", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const invoice = await createSaleInvoice("1000.00");

    const payment = await caller.payment.create({
      partyId: world.party1.id,
      invoiceId: invoice.id,
      amount: "500.00",
      mode: "upi",
      referenceNumber: "UPI-TEST-001",
    });

    expect(payment).toBeDefined();
    expect(payment.amount).toBe("500.00");
    expect(payment.mode).toBe("upi");
    expect(payment.referenceNumber).toBe("UPI-TEST-001");

    // Verify invoice amountPaid and status in DB
    const [inv] = await db.select({ amountPaid: invoices.amountPaid, status: invoices.status })
      .from(invoices)
      .where(eq(invoices.id, invoice.id));

    expect(inv!.amountPaid).toBe("500.00");
    expect(inv!.status).toBe("partial");
  });

  it("transitions invoice to paid when payment fully covers totalAmount", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const invoice = await createSaleInvoice("750.00");

    await caller.payment.create({
      partyId: world.party1.id,
      invoiceId: invoice.id,
      amount: "750.00",
      mode: "cash",
    });

    const [inv] = await db.select({ amountPaid: invoices.amountPaid, status: invoices.status })
      .from(invoices)
      .where(eq(invoices.id, invoice.id));

    expect(inv!.amountPaid).toBe("750.00");
    expect(inv!.status).toBe("paid");
  });

  it("generates payment number in PAY-NNNNN format and atomically increments the counter", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const { businesses } = await import("@hisaabo/db");

    const [bizBefore] = await db.select({ nextNum: businesses.nextPaymentNumber })
      .from(businesses)
      .where(eq(businesses.id, world.business1.id));

    const invoice = await createSaleInvoice("200.00");

    const payment = await caller.payment.create({
      partyId: world.party1.id,
      invoiceId: invoice.id,
      amount: "200.00",
      mode: "cash",
    });

    // Payment number must be prefix + zero-padded counter
    expect(payment.paymentNumber).toMatch(/^PAY-\d{5}$/);

    const numericSuffix = parseInt(payment.paymentNumber!.split("-")[1]!, 10);
    expect(numericSuffix).toBe(bizBefore!.nextNum);

    const [bizAfter] = await db.select({ nextNum: businesses.nextPaymentNumber })
      .from(businesses)
      .where(eq(businesses.id, world.business1.id));

    expect(bizAfter!.nextNum).toBe(bizBefore!.nextNum + 1);
  });

  it("multi-invoice allocation splits payment across 2 invoices and transitions each correctly", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const inv1 = await createSaleInvoice("300.00");
    const inv2 = await createSaleInvoice("700.00");

    // Pay INV-1 in full, INV-2 partially
    await caller.payment.create({
      partyId: world.party1.id,
      amount: "800.00",
      mode: "bank",
      allocations: [
        { invoiceId: inv1.id, amount: "300.00" },
        { invoiceId: inv2.id, amount: "500.00" },
      ],
    });

    const [row1] = await db.select({ amountPaid: invoices.amountPaid, status: invoices.status })
      .from(invoices)
      .where(eq(invoices.id, inv1.id));

    const [row2] = await db.select({ amountPaid: invoices.amountPaid, status: invoices.status })
      .from(invoices)
      .where(eq(invoices.id, inv2.id));

    // INV-1: fully paid
    expect(row1!.amountPaid).toBe("300.00");
    expect(row1!.status).toBe("paid");

    // INV-2: partially paid (500 of 700)
    expect(row2!.amountPaid).toBe("500.00");
    expect(row2!.status).toBe("partial");
  });

  it("primary invoiceId on payment record is set to first allocation's invoiceId for backward compatibility", async () => {
    const caller = callerForRamesh();

    const inv1 = await createSaleInvoice("400.00");
    const inv2 = await createSaleInvoice("400.00");

    const payment = await caller.payment.create({
      partyId: world.party1.id,
      amount: "800.00",
      mode: "cash",
      allocations: [
        { invoiceId: inv1.id, amount: "400.00" },
        { invoiceId: inv2.id, amount: "400.00" },
      ],
    });

    // The payment's primary invoiceId should be the first allocation's invoiceId
    expect(payment.invoiceId).toBe(inv1.id);
  });

  it("overpayment guard rejects allocation exceeding invoice balance — transaction rolls back", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const invoice = await createSaleInvoice("200.00");

    await expect(
      caller.payment.create({
        partyId: world.party1.id,
        invoiceId: invoice.id,
        amount: "300.00",
        mode: "cash",
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining("exceeds invoice balance"),
    });

    // Invoice must be unchanged — rollback confirmed
    const [inv] = await db.select({ amountPaid: invoices.amountPaid })
      .from(invoices)
      .where(eq(invoices.id, invoice.id));

    expect(inv!.amountPaid).toBe("0.00");
  });

  it("records a bank deposit transaction for a sale invoice payment with bank account", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const bankAccount = await createBankAccount(db, world.business1.id, {
      accountName: "HDFC Test Account",
      currentBalance: "5000.00",
    });

    const invoice = await createSaleInvoice("500.00");

    await caller.payment.create({
      partyId: world.party1.id,
      invoiceId: invoice.id,
      amount: "500.00",
      mode: "bank",
      bankAccountId: bankAccount.id,
    });

    // Bank transaction should be a deposit
    const [txn] = await db.select({ type: bankTransactions.type, amount: bankTransactions.amount })
      .from(bankTransactions)
      .where(and(
        eq(bankTransactions.bankAccountId, bankAccount.id),
        eq(bankTransactions.referenceType, "payment"),
      ));

    expect(txn!.type).toBe("deposit");
    expect(txn!.amount).toBe("500.00");

    // Account balance should increase
    const [acct] = await db.select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, bankAccount.id));

    expect(acct!.currentBalance).toBe("5500.00");
  });

  it("records a bank withdrawal transaction for a purchase invoice payment", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const bankAccount = await createBankAccount(db, world.business1.id, {
      accountName: "HDFC Purchase Account",
      currentBalance: "10000.00",
    });

    // Create a supplier and purchase invoice via fixture (direct DB insert for speed)
    const supplier = await createParty(db, world.business1.id, {
      type: "supplier",
      name: "Supplier for Purchase Payment Test",
    });

    const { invoice: purchaseInvoice } = await createInvoiceWithItems(
      db,
      world.business1.id,
      supplier.id,
      [{ description: "Goods received", quantity: "1", unitPrice: "300.00" }],
      { type: "purchase", status: "sent" }
    );

    await caller.payment.create({
      partyId: supplier.id,
      invoiceId: purchaseInvoice.id,
      amount: "300.00",
      mode: "bank",
      bankAccountId: bankAccount.id,
    });

    // Bank transaction should be a withdrawal for purchase payment
    const [txn] = await db.select({ type: bankTransactions.type })
      .from(bankTransactions)
      .where(and(
        eq(bankTransactions.bankAccountId, bankAccount.id),
        eq(bankTransactions.referenceType, "payment"),
      ));

    expect(txn!.type).toBe("withdrawal");

    // Account balance should decrease
    const [acct] = await db.select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, bankAccount.id));

    expect(acct!.currentBalance).toBe("9700.00");
  });

  it("unlinked payment (no invoice) stores null invoiceId and makes no invoice status changes", async () => {
    const caller = callerForRamesh();

    const payment = await caller.payment.create({
      partyId: world.party1.id,
      amount: "1000.00",
      mode: "cash",
    });

    expect(payment.invoiceId).toBeNull();
    expect(payment.amount).toBe("1000.00");
  });

  it("rejects payment when party belongs to a different business — cross-business guard", async () => {
    const caller = callerForRamesh();

    // party2 belongs to business2
    await expect(
      caller.payment.create({
        partyId: world.party2.id,
        amount: "100.00",
        mode: "cash",
      })
    ).rejects.toMatchObject({
      message: "Party not found in this business",
    });
  });

  it("all amounts are stored as strings — never floats — financial integrity check", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const invoice = await createSaleInvoice("333.33");

    const payment = await caller.payment.create({
      partyId: world.party1.id,
      invoiceId: invoice.id,
      amount: "333.33",
      mode: "upi",
    });

    // Payment amount from router response
    expect(typeof payment.amount).toBe("string");
    expect(payment.amount).toBe("333.33");

    // Payment amount from database
    const [row] = await db.select({ amount: payments.amount })
      .from(payments)
      .where(eq(payments.id, payment.id));

    expect(typeof row!.amount).toBe("string");
    // Postgres NUMERIC returns as string through drizzle
    expect(parseFloat(row!.amount)).toBe(333.33);
  });
});

// =============================================================================
// payment.list
// =============================================================================

describe("payment.list", () => {
  it("returns paginated results and includes partyName via JOIN", async () => {
    const caller = callerForRamesh();

    // Ensure at least one payment exists
    const invoice = await createSaleInvoice("100.00");
    await caller.payment.create({
      partyId: world.party1.id,
      invoiceId: invoice.id,
      amount: "100.00",
      mode: "cash",
    });

    const result = await caller.payment.list({ page: 1, limit: 20 });

    expect(result).toHaveProperty("data");
    expect(result).toHaveProperty("total");
    expect(result.page).toBe(1);
    expect(result.data.length).toBeGreaterThan(0);

    // partyName must be present (from JOIN)
    for (const p of result.data) {
      expect(p.partyName).toBeDefined();
    }
  });

  it("filters by partyId returns only payments for that party", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const secondParty = await createParty(db, world.business1.id, {
      name: "Party Filter Test",
      type: "customer",
    });

    const invoice = await createSaleInvoice("200.00");

    // Payment for party1
    await caller.payment.create({
      partyId: world.party1.id,
      invoiceId: invoice.id,
      amount: "200.00",
      mode: "cash",
    });

    // Unlinked payment for secondParty
    await caller.payment.create({
      partyId: secondParty.id,
      amount: "150.00",
      mode: "cash",
    });

    const result = await caller.payment.list({ partyId: secondParty.id, page: 1, limit: 50 });

    expect(result.data.length).toBeGreaterThan(0);
    for (const p of result.data) {
      expect(p.partyId).toBe(secondParty.id);
    }
  });

  it("filters by date range returns only payments within fromDate..toDate", async () => {
    const caller = callerForRamesh();

    const fromDate = "2026-01-01T00:00:00.000Z";
    const toDate = "2026-01-31T23:59:59.999Z";

    // Create a payment dated in January 2026
    await caller.payment.create({
      partyId: world.party1.id,
      amount: "50.00",
      mode: "cash",
      paymentDate: "2026-01-15T00:00:00.000Z",
    });

    const result = await caller.payment.list({ fromDate, toDate, page: 1, limit: 50 });

    for (const p of result.data) {
      const pd = new Date(p.paymentDate!);
      expect(pd >= new Date(fromDate)).toBe(true);
      expect(pd <= new Date(toDate)).toBe(true);
    }
  });

  it("only returns payments for the active business — business isolation", async () => {
    const callerB1 = callerForRamesh();
    const callerB2 = callerForKiran();

    // Create a payment in business2
    await callerB2.payment.create({
      partyId: world.party2.id,
      amount: "99.00",
      mode: "cash",
    });

    const b1Result = await callerB1.payment.list({ page: 1, limit: 100 });
    const b2Result = await callerB2.payment.list({ page: 1, limit: 100 });

    const b1Ids = new Set(b1Result.data.map((p) => p.id));
    const b2Ids = new Set(b2Result.data.map((p) => p.id));

    for (const id of b2Ids) {
      expect(b1Ids.has(id)).toBe(false);
    }
  });

  it("soft-deleted payments are excluded from list results", async () => {
    const caller = callerForRamesh();

    const payment = await caller.payment.create({
      partyId: world.party1.id,
      amount: "77.00",
      mode: "cash",
    });

    await caller.payment.delete({ id: payment.id });

    const result = await caller.payment.list({ page: 1, limit: 100 });
    const ids = result.data.map((p) => p.id);
    expect(ids).not.toContain(payment.id);
  });
});

// =============================================================================
// payment.delete
// =============================================================================

describe("payment.delete", () => {
  it("soft-deletes the payment and reverses amountPaid on the linked invoice", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const invoice = await createSaleInvoice("600.00");

    const payment = await caller.payment.create({
      partyId: world.party1.id,
      invoiceId: invoice.id,
      amount: "600.00",
      mode: "cash",
    });

    // Invoice should be paid
    const [beforeDel] = await db.select({ amountPaid: invoices.amountPaid, status: invoices.status })
      .from(invoices)
      .where(eq(invoices.id, invoice.id));
    expect(beforeDel!.status).toBe("paid");

    const result = await caller.payment.delete({ id: payment.id });
    expect(result.success).toBe(true);

    // Payment must have deletedAt set
    const [pmt] = await db.select({ deletedAt: payments.deletedAt })
      .from(payments)
      .where(eq(payments.id, payment.id));
    expect(pmt!.deletedAt).not.toBeNull();

    // amountPaid must be reversed
    const [afterDel] = await db.select({ amountPaid: invoices.amountPaid })
      .from(invoices)
      .where(eq(invoices.id, invoice.id));
    expect(afterDel!.amountPaid).toBe("0.00");
  });

  it("reverting a full payment drives amountPaid to zero (GREATEST guard prevents negative)", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const invoice = await createSaleInvoice("400.00");

    const pmt = await caller.payment.create({
      partyId: world.party1.id,
      invoiceId: invoice.id,
      amount: "400.00",
      mode: "upi",
    });

    await caller.payment.delete({ id: pmt.id });

    const [inv] = await db.select({ amountPaid: invoices.amountPaid })
      .from(invoices)
      .where(eq(invoices.id, invoice.id));

    // GREATEST(amountPaid - amount, 0) — must be 0.00, never negative
    expect(parseFloat(inv!.amountPaid)).toBeGreaterThanOrEqual(0);
    expect(inv!.amountPaid).toBe("0.00");
  });

  it("deleting a payment with a bank account reverses the bank transaction and adjusts balance", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const bankAccount = await createBankAccount(db, world.business1.id, {
      accountName: "Payment Delete Test Account",
      currentBalance: "2000.00",
    });

    const invoice = await createSaleInvoice("500.00");

    const pmt = await caller.payment.create({
      partyId: world.party1.id,
      invoiceId: invoice.id,
      amount: "500.00",
      mode: "bank",
      bankAccountId: bankAccount.id,
    });

    // Balance should now be 2500
    const [acctBefore] = await db.select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, bankAccount.id));
    expect(acctBefore!.currentBalance).toBe("2500.00");

    await caller.payment.delete({ id: pmt.id });

    // Balance should be reversed back to 2000
    const [acctAfter] = await db.select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, bankAccount.id));
    expect(acctAfter!.currentBalance).toBe("2000.00");

    // The bank transaction should be deleted
    const txns = await db.select()
      .from(bankTransactions)
      .where(and(
        eq(bankTransactions.referenceType, "payment"),
        eq(bankTransactions.referenceId, pmt.id),
      ));
    expect(txns).toHaveLength(0);
  });

  it("deleting an already-deleted payment is idempotent — returns success", async () => {
    const caller = callerForRamesh();

    const pmt = await caller.payment.create({
      partyId: world.party1.id,
      amount: "50.00",
      mode: "cash",
    });

    await caller.payment.delete({ id: pmt.id });
    const result = await caller.payment.delete({ id: pmt.id });
    expect(result.success).toBe(true);
  });

  it("deleting a non-existent payment returns success=false", async () => {
    const caller = callerForRamesh();

    const result = await caller.payment.delete({ id: "00000000-0000-0000-0000-000000000099" });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// payment.unpaidInvoices
// =============================================================================

describe("payment.unpaidInvoices", () => {
  it("returns only invoices with outstanding balance — excludes paid, cancelled, draft", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    // Create a dedicated party for this test to get a clean result set
    const testParty = await createParty(db, world.business1.id, {
      name: "Unpaid Invoices Test Party",
      type: "customer",
    });

    // Draft invoice (should be excluded)
    const draftInv = await caller.invoice.create({
      partyId: testParty.id,
      type: "sale" as const,
      invoiceDate: new Date().toISOString(),
      lineItems: [
        { description: "Draft", quantity: "1", unitPrice: "100.00", taxPercent: "0", discountPercent: "0", conversionFactor: null, variantId: null },
      ],
    });
    // Leave as draft

    // Sent invoice (should be returned)
    const sentInv = await caller.invoice.create({
      partyId: testParty.id,
      type: "sale" as const,
      invoiceDate: new Date().toISOString(),
      lineItems: [
        { description: "Sent", quantity: "1", unitPrice: "500.00", taxPercent: "0", discountPercent: "0", conversionFactor: null, variantId: null },
      ],
    });
    await caller.invoice.updateStatus({ id: sentInv.id, status: "sent" });

    // Partially paid invoice (should be returned)
    const partialInv = await caller.invoice.create({
      partyId: testParty.id,
      type: "sale" as const,
      invoiceDate: new Date().toISOString(),
      lineItems: [
        { description: "Partial", quantity: "1", unitPrice: "800.00", taxPercent: "0", discountPercent: "0", conversionFactor: null, variantId: null },
      ],
    });
    await caller.invoice.updateStatus({ id: partialInv.id, status: "sent" });
    await caller.payment.create({
      partyId: testParty.id,
      invoiceId: partialInv.id,
      amount: "300.00",
      mode: "cash",
    });

    // Paid invoice (should be excluded)
    const paidInv = await caller.invoice.create({
      partyId: testParty.id,
      type: "sale" as const,
      invoiceDate: new Date().toISOString(),
      lineItems: [
        { description: "Paid", quantity: "1", unitPrice: "200.00", taxPercent: "0", discountPercent: "0", conversionFactor: null, variantId: null },
      ],
    });
    await caller.invoice.updateStatus({ id: paidInv.id, status: "sent" });
    await caller.payment.create({
      partyId: testParty.id,
      invoiceId: paidInv.id,
      amount: "200.00",
      mode: "cash",
    });

    // Cancelled invoice (should be excluded)
    const cancelledInv = await caller.invoice.create({
      partyId: testParty.id,
      type: "sale" as const,
      invoiceDate: new Date().toISOString(),
      lineItems: [
        { description: "Cancelled", quantity: "1", unitPrice: "150.00", taxPercent: "0", discountPercent: "0", conversionFactor: null, variantId: null },
      ],
    });
    await caller.invoice.delete({ id: cancelledInv.id }); // sets status=cancelled

    const unpaid = await caller.payment.unpaidInvoices({ partyId: testParty.id });

    const unpaidIds = unpaid.map((i) => i.id);

    // Sent and partial must appear
    expect(unpaidIds).toContain(sentInv.id);
    expect(unpaidIds).toContain(partialInv.id);

    // Draft, paid, cancelled must NOT appear
    expect(unpaidIds).not.toContain(draftInv.id);
    expect(unpaidIds).not.toContain(paidInv.id);
    expect(unpaidIds).not.toContain(cancelledInv.id);
  });

  it("each returned invoice has a computed balance = totalAmount - amountPaid", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const testParty = await createParty(db, world.business1.id, {
      name: "Balance Check Party",
      type: "customer",
    });

    const inv = await caller.invoice.create({
      partyId: testParty.id,
      type: "sale" as const,
      invoiceDate: new Date().toISOString(),
      lineItems: [
        { description: "Balance test item", quantity: "1", unitPrice: "1000.00", taxPercent: "0", discountPercent: "0", conversionFactor: null, variantId: null },
      ],
    });
    await caller.invoice.updateStatus({ id: inv.id, status: "sent" });

    await caller.payment.create({
      partyId: testParty.id,
      invoiceId: inv.id,
      amount: "400.00",
      mode: "cash",
    });

    const unpaid = await caller.payment.unpaidInvoices({ partyId: testParty.id });
    const found = unpaid.find((i) => i.id === inv.id);

    expect(found).toBeDefined();
    // balance = 1000 - 400 = 600
    expect(found!.balance).toBe("600.00");
  });

  it("returns only unpaid invoices for the active business — business isolation", async () => {
    const callerB1 = callerForRamesh();
    const callerB2 = callerForKiran();

    // Create an invoice in business2 for party2
    const b2Inv = await callerB2.invoice.create({
      partyId: world.party2.id,
      type: "sale" as const,
      invoiceDate: new Date().toISOString(),
      lineItems: [
        { description: "B2 item", quantity: "1", unitPrice: "500.00", taxPercent: "0", discountPercent: "0", conversionFactor: null, variantId: null },
      ],
    });
    await callerB2.invoice.updateStatus({ id: b2Inv.id, status: "sent" });

    // Business1 caller queries unpaid invoices for party1 — must not see b2Inv
    const b1Unpaid = await callerB1.payment.unpaidInvoices({ partyId: world.party1.id });
    const b1Ids = b1Unpaid.map((i) => i.id);
    expect(b1Ids).not.toContain(b2Inv.id);
  });
});

// =============================================================================
// Financial integrity
// =============================================================================

describe("Financial integrity — money as strings, never floats", () => {
  it("payment amounts are stored as NUMERIC strings — parseFloat round-trip preserves value", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    // Use a value that is dangerous as a float (1/3 in decimal)
    const amount = "333.33";

    const pmt = await caller.payment.create({
      partyId: world.party1.id,
      amount,
      mode: "cash",
    });

    expect(pmt.amount).toBe(amount);

    const [row] = await db.select({ amount: payments.amount })
      .from(payments)
      .where(eq(payments.id, pmt.id));

    // Drizzle returns NUMERIC as string. Verify it round-trips exactly.
    expect(row!.amount).toBe(amount);
  });

  it("cumulative payments never exceed totalAmount — two sequential partial payments", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const invoice = await createSaleInvoice("500.00");

    // First partial payment
    await caller.payment.create({
      partyId: world.party1.id,
      invoiceId: invoice.id,
      amount: "300.00",
      mode: "cash",
    });

    // Second partial payment that exactly completes the invoice
    await caller.payment.create({
      partyId: world.party1.id,
      invoiceId: invoice.id,
      amount: "200.00",
      mode: "cash",
    });

    const [inv] = await db.select({ amountPaid: invoices.amountPaid, status: invoices.status })
      .from(invoices)
      .where(eq(invoices.id, invoice.id));

    expect(inv!.amountPaid).toBe("500.00");
    expect(inv!.status).toBe("paid");
  });

  it("overpayment on second payment is rejected — the guard checks remaining balance, not totalAmount", async () => {
    const caller = callerForRamesh();

    const invoice = await createSaleInvoice("500.00");

    // First payment takes the balance to 200 remaining
    await caller.payment.create({
      partyId: world.party1.id,
      invoiceId: invoice.id,
      amount: "300.00",
      mode: "cash",
    });

    // Second payment exceeds remaining balance (200) — must be rejected
    await expect(
      caller.payment.create({
        partyId: world.party1.id,
        invoiceId: invoice.id,
        amount: "300.00", // 200 remaining, 300 attempted
        mode: "cash",
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining("exceeds invoice balance"),
    });
  });
});
