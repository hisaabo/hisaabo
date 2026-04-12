/**
 * BDD workflow tests for payment operations.
 *
 * These tests verify the FULL payment lifecycle as it actually operates:
 *   - payment.create → invoice amountPaid/status updated → bank txn created
 *   - payment.update → old allocations reversed → new applied → bank switched
 *   - payment.delete → ALL allocations reversed → status recalculated → bank reversed
 *
 * BUGS FIXED (discovered by Workflow Architect audit 2026-04-04):
 *   1. payment.delete only reversed primary invoiceId, not paymentAllocations.
 *      Multi-invoice payments left non-primary invoices with inflated amountPaid.
 *   2. payment.delete did not recalculate invoice status. A "paid" invoice
 *      whose only payment was deleted stayed status="paid" with amountPaid="0.00".
 *
 * Workflow reference: docs/workflows/WORKFLOW-SPECS.md §8 (Payment Flow)
 * Test case IDs: PAY-09 through PAY-16
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { invoices, bankAccounts, paymentAllocations } from "@hisaabo/db";
import {
  createTestWorld,
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

// ── Helper: create a real sale invoice with a known total via the router ───────

async function createSaleInvoice(totalAmount: string) {
  const caller = callerForRamesh();
  const invoice = await caller.invoice.create({
    partyId: world.party1.id,
    type: "sale" as const,
    invoiceDate: new Date().toISOString(),
    lineItems: [
      {
        itemName: `Invoice for ${totalAmount}`,
        quantity: "1",
        unitPrice: totalAmount,
        taxPercent: "0",
        discountPercent: "0",
        conversionFactor: null,
        variantId: null,
      },
    ],
  });
  await caller.invoice.updateStatus({ id: invoice.id, status: "sent" });
  return invoice;
}

// =============================================================================
// WORKFLOW: payment.delete with multi-invoice allocation (PAY-15, PAY-16)
// =============================================================================

describe("payment.delete — multi-invoice allocation reversal", () => {
  it("PAY-15: deleting a multi-invoice payment reverses amountPaid on ALL allocated invoices", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    // GIVEN: two invoices totaling 1000
    const inv1 = await createSaleInvoice("300.00");
    const inv2 = await createSaleInvoice("700.00");

    // WHEN: a single payment is split across both invoices
    const payment = await caller.payment.create({
      partyId: world.party1.id,
      amount: "800.00",
      mode: "bank",
      allocations: [
        { invoiceId: inv1.id, amount: "300.00" },
        { invoiceId: inv2.id, amount: "500.00" },
      ],
    });

    // Verify both invoices reflect the allocation
    const [row1Before] = await db.select({ amountPaid: invoices.amountPaid, status: invoices.status })
      .from(invoices).where(eq(invoices.id, inv1.id));
    const [row2Before] = await db.select({ amountPaid: invoices.amountPaid, status: invoices.status })
      .from(invoices).where(eq(invoices.id, inv2.id));

    expect(row1Before!.amountPaid).toBe("300.00");
    expect(row1Before!.status).toBe("paid");
    expect(row2Before!.amountPaid).toBe("500.00");
    expect(row2Before!.status).toBe("partial");

    // WHEN: the payment is deleted
    const result = await caller.payment.delete({ id: payment.id });
    expect(result.success).toBe(true);

    // THEN: BOTH invoices must have amountPaid reversed to 0
    const [row1After] = await db.select({ amountPaid: invoices.amountPaid, status: invoices.status })
      .from(invoices).where(eq(invoices.id, inv1.id));
    const [row2After] = await db.select({ amountPaid: invoices.amountPaid, status: invoices.status })
      .from(invoices).where(eq(invoices.id, inv2.id));

    expect(row1After!.amountPaid).toBe("0.00");
    expect(row2After!.amountPaid).toBe("0.00");
  });

  it("PAY-16: deleting a payment recalculates invoice status — paid→sent when fully reversed", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    // GIVEN: invoice fully paid
    const invoice = await createSaleInvoice("500.00");
    const payment = await caller.payment.create({
      partyId: world.party1.id,
      invoiceId: invoice.id,
      amount: "500.00",
      mode: "cash",
    });

    const [before] = await db.select({ status: invoices.status })
      .from(invoices).where(eq(invoices.id, invoice.id));
    expect(before!.status).toBe("paid");

    // WHEN: the payment is deleted
    await caller.payment.delete({ id: payment.id });

    // THEN: invoice status must be recalculated to "sent" (not stuck at "paid")
    const [after] = await db.select({ amountPaid: invoices.amountPaid, status: invoices.status })
      .from(invoices).where(eq(invoices.id, invoice.id));
    expect(after!.amountPaid).toBe("0.00");
    expect(after!.status).toBe("sent");
  });

  it("PAY-16b: partial payment deletion leaves invoice as partial, not sent", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    // GIVEN: invoice with two payments — one will be deleted
    const invoice = await createSaleInvoice("1000.00");
    const pmt1 = await caller.payment.create({
      partyId: world.party1.id,
      invoiceId: invoice.id,
      amount: "600.00",
      mode: "cash",
    });
    await caller.payment.create({
      partyId: world.party1.id,
      invoiceId: invoice.id,
      amount: "200.00",
      mode: "upi",
    });

    // invoice.amountPaid = 800 (partial)
    const [before] = await db.select({ amountPaid: invoices.amountPaid, status: invoices.status })
      .from(invoices).where(eq(invoices.id, invoice.id));
    expect(before!.amountPaid).toBe("800.00");
    expect(before!.status).toBe("partial");

    // WHEN: the first payment (600) is deleted
    await caller.payment.delete({ id: pmt1.id });

    // THEN: amountPaid = 200, status = partial (not sent)
    const [after] = await db.select({ amountPaid: invoices.amountPaid, status: invoices.status })
      .from(invoices).where(eq(invoices.id, invoice.id));
    expect(after!.amountPaid).toBe("200.00");
    expect(after!.status).toBe("partial");
  });

  it("PAY-15b: multi-invoice payment deletion also cleans up paymentAllocations rows", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const inv1 = await createSaleInvoice("200.00");
    const inv2 = await createSaleInvoice("300.00");

    const payment = await caller.payment.create({
      partyId: world.party1.id,
      amount: "500.00",
      mode: "cash",
      allocations: [
        { invoiceId: inv1.id, amount: "200.00" },
        { invoiceId: inv2.id, amount: "300.00" },
      ],
    });

    // Verify allocations exist
    const allocsBefore = await db.select()
      .from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, payment.id));
    expect(allocsBefore).toHaveLength(2);

    // Delete the payment
    await caller.payment.delete({ id: payment.id });

    // Allocation rows must be cleaned up
    const allocsAfter = await db.select()
      .from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, payment.id));
    expect(allocsAfter).toHaveLength(0);
  });
});

// =============================================================================
// WORKFLOW: payment.update — allocation reversal and reapplication (PAY-09..12)
// =============================================================================

describe("payment.update — amount and allocation changes", () => {
  it("PAY-09: updating payment amount reverses old and applies new — invoice recalculated", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const invoice = await createSaleInvoice("1000.00");

    const pmt = await caller.payment.create({
      partyId: world.party1.id,
      invoiceId: invoice.id,
      amount: "600.00",
      mode: "cash",
    });

    // Invoice is partial (600 of 1000)
    const [before] = await db.select({ amountPaid: invoices.amountPaid, status: invoices.status })
      .from(invoices).where(eq(invoices.id, invoice.id));
    expect(before!.amountPaid).toBe("600.00");
    expect(before!.status).toBe("partial");

    // WHEN: update payment from 600 → 1000
    await caller.payment.update({
      id: pmt.id,
      amount: "1000.00",
      allocations: [{ invoiceId: invoice.id, amount: "1000.00" }],
    });

    // THEN: invoice becomes fully paid
    const [after] = await db.select({ amountPaid: invoices.amountPaid, status: invoices.status })
      .from(invoices).where(eq(invoices.id, invoice.id));
    expect(after!.amountPaid).toBe("1000.00");
    expect(after!.status).toBe("paid");
  });

  it("PAY-10: updating allocations moves payment from one invoice to another", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const inv1 = await createSaleInvoice("500.00");
    const inv2 = await createSaleInvoice("500.00");

    const pmt = await caller.payment.create({
      partyId: world.party1.id,
      amount: "500.00",
      mode: "cash",
      allocations: [{ invoiceId: inv1.id, amount: "500.00" }],
    });

    // inv1 = paid, inv2 = sent
    const [r1Before] = await db.select({ amountPaid: invoices.amountPaid })
      .from(invoices).where(eq(invoices.id, inv1.id));
    expect(r1Before!.amountPaid).toBe("500.00");

    // WHEN: move entire allocation from inv1 → inv2
    await caller.payment.update({
      id: pmt.id,
      amount: "500.00",
      allocations: [{ invoiceId: inv2.id, amount: "500.00" }],
    });

    // THEN: inv1 reversed to 0, inv2 now 500
    const [r1After] = await db.select({ amountPaid: invoices.amountPaid, status: invoices.status })
      .from(invoices).where(eq(invoices.id, inv1.id));
    const [r2After] = await db.select({ amountPaid: invoices.amountPaid, status: invoices.status })
      .from(invoices).where(eq(invoices.id, inv2.id));

    expect(r1After!.amountPaid).toBe("0.00");
    expect(r1After!.status).toBe("sent");
    expect(r2After!.amountPaid).toBe("500.00");
    expect(r2After!.status).toBe("paid");
  });

  it("PAY-11: switching bank account reverses old bank txn, creates new one", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const bankA = await createBankAccount(db, world.business1.id, {
      accountName: "Bank A",
      currentBalance: "5000.00",
    });
    const bankB = await createBankAccount(db, world.business1.id, {
      accountName: "Bank B",
      currentBalance: "3000.00",
    });

    const invoice = await createSaleInvoice("1000.00");

    const pmt = await caller.payment.create({
      partyId: world.party1.id,
      invoiceId: invoice.id,
      amount: "1000.00",
      mode: "bank",
      bankAccountId: bankA.id,
    });

    // Bank A should have 6000 (5000 + 1000 deposit)
    const [acctABefore] = await db.select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts).where(eq(bankAccounts.id, bankA.id));
    expect(acctABefore!.currentBalance).toBe("6000.00");

    // WHEN: switch from bankA → bankB
    await caller.payment.update({
      id: pmt.id,
      amount: "1000.00",
      bankAccountId: bankB.id,
      allocations: [{ invoiceId: invoice.id, amount: "1000.00" }],
    });

    // THEN: Bank A back to 5000 (reversed), Bank B at 4000 (3000 + 1000)
    const [acctAAfter] = await db.select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts).where(eq(bankAccounts.id, bankA.id));
    const [acctBAfter] = await db.select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts).where(eq(bankAccounts.id, bankB.id));

    expect(acctAAfter!.currentBalance).toBe("5000.00");
    expect(acctBAfter!.currentBalance).toBe("4000.00");
  });
});

// =============================================================================
// WORKFLOW: Full payment lifecycle — create → partial → paid → delete → sent
// =============================================================================

describe("payment lifecycle — end-to-end invoice status transitions", () => {
  it("invoice follows full status arc: sent → partial → paid → (delete) → partial → (delete) → sent", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    // GIVEN: a 1000.00 invoice in "sent" status
    const invoice = await createSaleInvoice("1000.00");

    async function getInvoiceState() {
      const [row] = await db.select({ amountPaid: invoices.amountPaid, status: invoices.status })
        .from(invoices).where(eq(invoices.id, invoice.id));
      return row!;
    }

    // Step 1: First partial payment → status=partial
    const pmt1 = await caller.payment.create({
      partyId: world.party1.id,
      invoiceId: invoice.id,
      amount: "400.00",
      mode: "cash",
    });
    let state = await getInvoiceState();
    expect(state.status).toBe("partial");
    expect(state.amountPaid).toBe("400.00");

    // Step 2: Second partial payment → status still partial
    const pmt2 = await caller.payment.create({
      partyId: world.party1.id,
      invoiceId: invoice.id,
      amount: "300.00",
      mode: "upi",
    });
    state = await getInvoiceState();
    expect(state.status).toBe("partial");
    expect(state.amountPaid).toBe("700.00");

    // Step 3: Final payment → status=paid
    const pmt3 = await caller.payment.create({
      partyId: world.party1.id,
      invoiceId: invoice.id,
      amount: "300.00",
      mode: "bank",
    });
    state = await getInvoiceState();
    expect(state.status).toBe("paid");
    expect(state.amountPaid).toBe("1000.00");

    // Step 4: Delete last payment → status back to partial
    await caller.payment.delete({ id: pmt3.id });
    state = await getInvoiceState();
    expect(state.status).toBe("partial");
    expect(state.amountPaid).toBe("700.00");

    // Step 5: Delete remaining payments → status back to sent
    await caller.payment.delete({ id: pmt2.id });
    state = await getInvoiceState();
    expect(state.status).toBe("partial");
    expect(state.amountPaid).toBe("400.00");

    await caller.payment.delete({ id: pmt1.id });
    state = await getInvoiceState();
    expect(state.status).toBe("sent");
    expect(state.amountPaid).toBe("0.00");
  });
});
