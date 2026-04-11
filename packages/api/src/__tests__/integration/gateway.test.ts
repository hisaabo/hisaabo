/**
 * Integration tests for the payment gateway feature.
 *
 * WHY THIS FILE EXISTS:
 * When a payment is routed through a payment_gateway bank account, the system
 * automatically:
 *   1. Creates an expense for the gateway charge (percentage or flat)
 *   2. Withdraws the charge from the gateway account
 *   3. Optionally auto-settles the net amount to a linked settlement bank account
 *
 * These side-effects involve multiple bank accounts, bank transactions, and
 * expense records that must stay in perfect balance. A single bug can:
 *   - Leak money (charge deducted but not recorded as expense)
 *   - Double-settle (settlement created twice or not reversed on delete)
 *   - Leave the gateway account with a phantom balance
 *
 * Every test verifies the DATABASE STATE after the operation, not just the
 * API response, because correctness lies in the transactional side-effects.
 *
 * RUNNING:
 *   pnpm --filter @hisaabo/api test -- --testPathPattern gateway
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and, isNull } from "drizzle-orm";
import {
  bankAccounts,
  bankTransactions,
  expenses,
} from "@hisaabo/db";
import {
  createTestWorld,
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

// ── Caller helper ──────────────────────────────────────────────────────────────

function callerForRamesh() {
  return createTestCaller({
    userId: world.ramesh.id,
    email: world.ramesh.email,
    name: world.ramesh.name ?? null,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });
}

// ── Helper: create a sale invoice with a known total ───────────────────────────

async function createSaleInvoice(totalAmount: string) {
  const caller = callerForRamesh();
  const invoice = await caller.invoice.create({
    partyId: world.party1.id,
    type: "sale" as const,
    invoiceDate: new Date().toISOString(),
    lineItems: [
      {
        itemName: `Gateway test invoice for ${totalAmount}`,
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

// ── Helper: create a settlement bank account ───────────────────────────────────

async function createSettlementAccount(name: string, balance = "0.00") {
  const caller = callerForRamesh();
  return caller.bankAccount.create({
    accountName: name,
    accountType: "savings",
    openingBalance: balance,
    isDefault: false,
  });
}

// ── Helper: create a gateway account with config ───────────────────────────────

async function createGatewayWithConfig(opts: {
  name: string;
  settlementAccountId: string;
  chargeConfig: Record<string, { type: "percentage" | "flat"; value: string }>;
  autoSettle?: boolean;
}) {
  const caller = callerForRamesh();

  const gatewayAccount = await caller.bankAccount.create({
    accountName: opts.name,
    accountType: "payment_gateway",
    openingBalance: "0",
    isDefault: false,
  });

  await caller.bankAccount.upsertGatewayConfig({
    bankAccountId: gatewayAccount.id,
    settlementAccountId: opts.settlementAccountId,
    chargeConfig: opts.chargeConfig,
    autoSettle: opts.autoSettle ?? true,
  });

  return gatewayAccount;
}

// =============================================================================
// 1. Gateway Config Management
// =============================================================================

describe("gateway config management", () => {
  it("upsertGatewayConfig creates config for a payment_gateway account", async () => {
    const caller = callerForRamesh();
    const settlement = await createSettlementAccount("Config Test Settlement");

    const gateway = await caller.bankAccount.create({
      accountName: "Config Test Gateway",
      accountType: "payment_gateway",
      openingBalance: "0",
      isDefault: false,
    });

    const config = await caller.bankAccount.upsertGatewayConfig({
      bankAccountId: gateway.id,
      settlementAccountId: settlement.id,
      chargeConfig: {
        credit_card: { type: "percentage", value: "2" },
        upi: { type: "percentage", value: "0" },
      },
    });

    expect(config).toBeDefined();
    expect(config.bankAccountId).toBe(gateway.id);
    expect(config.settlementAccountId).toBe(settlement.id);
    expect(config.autoSettle).toBe(true);
    expect(config.expenseCategory).toBe("Payment Gateway Charges");
    expect(config.chargeConfig).toEqual({
      credit_card: { type: "percentage", value: "2" },
      upi: { type: "percentage", value: "0" },
    });
  });

  it("upsertGatewayConfig rejects config for non-gateway account type", async () => {
    const caller = callerForRamesh();
    const settlement = await createSettlementAccount("Non-GW Reject Settlement");

    const regularAccount = await caller.bankAccount.create({
      accountName: "Regular Savings Account",
      accountType: "savings",
      openingBalance: "0",
      isDefault: false,
    });

    await expect(
      caller.bankAccount.upsertGatewayConfig({
        bankAccountId: regularAccount.id,
        settlementAccountId: settlement.id,
        chargeConfig: {
          default: { type: "percentage", value: "2" },
        },
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining("payment_gateway"),
    });
  });

  it("upsertGatewayConfig rejects settlement account that is a gateway", async () => {
    const caller = callerForRamesh();

    const gateway1 = await caller.bankAccount.create({
      accountName: "Gateway 1",
      accountType: "payment_gateway",
      openingBalance: "0",
      isDefault: false,
    });

    const gateway2 = await caller.bankAccount.create({
      accountName: "Gateway 2 (as settlement)",
      accountType: "payment_gateway",
      openingBalance: "0",
      isDefault: false,
    });

    await expect(
      caller.bankAccount.upsertGatewayConfig({
        bankAccountId: gateway1.id,
        settlementAccountId: gateway2.id,
        chargeConfig: {
          default: { type: "percentage", value: "2" },
        },
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining("Settlement account cannot be a payment_gateway"),
    });
  });

  it("upsertGatewayConfig validates settlement account belongs to same business", async () => {
    const caller = callerForRamesh();
    const callerKiran = createTestCaller({
      userId: world.kiran.id,
      email: world.kiran.email,
      name: world.kiran.name ?? null,
      tenantId: world.tenant2.id,
      businessId: world.business2.id,
    });

    const gateway = await caller.bankAccount.create({
      accountName: "Cross-Biz Gateway",
      accountType: "payment_gateway",
      openingBalance: "0",
      isDefault: false,
    });

    // Create a settlement account in business2
    const otherBizSettlement = await callerKiran.bankAccount.create({
      accountName: "Kiran Settlement",
      accountType: "savings",
      openingBalance: "0",
      isDefault: false,
    });

    // Ramesh's caller tries to use Kiran's account as settlement — should fail
    await expect(
      caller.bankAccount.upsertGatewayConfig({
        bankAccountId: gateway.id,
        settlementAccountId: otherBizSettlement.id,
        chargeConfig: {
          default: { type: "percentage", value: "2" },
        },
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining("Settlement account not found"),
    });
  });

  it("getGatewayConfig returns config for existing gateway", async () => {
    const caller = callerForRamesh();
    const settlement = await createSettlementAccount("GetConfig Settlement");

    const gateway = await caller.bankAccount.create({
      accountName: "GetConfig Gateway",
      accountType: "payment_gateway",
      openingBalance: "0",
      isDefault: false,
    });

    await caller.bankAccount.upsertGatewayConfig({
      bankAccountId: gateway.id,
      settlementAccountId: settlement.id,
      chargeConfig: {
        credit_card: { type: "percentage", value: "1.5" },
        default: { type: "percentage", value: "2" },
      },
    });

    const config = await caller.bankAccount.getGatewayConfig({
      bankAccountId: gateway.id,
    });

    expect(config).not.toBeNull();
    expect(config!.bankAccountId).toBe(gateway.id);
    expect(config!.settlementAccountId).toBe(settlement.id);
    expect(config!.chargeConfig).toEqual({
      credit_card: { type: "percentage", value: "1.5" },
      default: { type: "percentage", value: "2" },
    });
  });

  it("getGatewayConfig returns null for non-gateway account", async () => {
    const caller = callerForRamesh();

    const regularAccount = await caller.bankAccount.create({
      accountName: "No Config Regular Account",
      accountType: "savings",
      openingBalance: "0",
      isDefault: false,
    });

    const config = await caller.bankAccount.getGatewayConfig({
      bankAccountId: regularAccount.id,
    });

    expect(config).toBeNull();
  });

  it("deleteGatewayConfig removes the config", async () => {
    const caller = callerForRamesh();
    const settlement = await createSettlementAccount("Delete Config Settlement");

    const gateway = await caller.bankAccount.create({
      accountName: "Delete Config Gateway",
      accountType: "payment_gateway",
      openingBalance: "0",
      isDefault: false,
    });

    await caller.bankAccount.upsertGatewayConfig({
      bankAccountId: gateway.id,
      settlementAccountId: settlement.id,
      chargeConfig: {
        default: { type: "percentage", value: "2" },
      },
    });

    const result = await caller.bankAccount.deleteGatewayConfig({
      bankAccountId: gateway.id,
    });

    expect(result.success).toBe(true);

    const config = await caller.bankAccount.getGatewayConfig({
      bankAccountId: gateway.id,
    });
    expect(config).toBeNull();
  });

  it("updating charge rates only updates specified fields", async () => {
    const caller = callerForRamesh();
    const settlement = await createSettlementAccount("Update Rates Settlement");

    const gateway = await caller.bankAccount.create({
      accountName: "Update Rates Gateway",
      accountType: "payment_gateway",
      openingBalance: "0",
      isDefault: false,
    });

    // Initial config
    await caller.bankAccount.upsertGatewayConfig({
      bankAccountId: gateway.id,
      settlementAccountId: settlement.id,
      chargeConfig: {
        credit_card: { type: "percentage", value: "2" },
        debit_card: { type: "percentage", value: "1" },
        upi: { type: "percentage", value: "0" },
      },
      expenseCategory: "PG Charges",
      autoSettle: true,
    });

    // Update: change credit_card rate and add net_banking, keep settlementAccountId
    const updated = await caller.bankAccount.upsertGatewayConfig({
      bankAccountId: gateway.id,
      settlementAccountId: settlement.id,
      chargeConfig: {
        credit_card: { type: "percentage", value: "2.5" },
        net_banking: { type: "flat", value: "15.00" },
      },
      expenseCategory: "Updated PG Charges",
      autoSettle: false,
    });

    // The upsert replaces the full chargeConfig (not a merge)
    expect(updated.chargeConfig).toEqual({
      credit_card: { type: "percentage", value: "2.5" },
      net_banking: { type: "flat", value: "15.00" },
    });
    expect(updated.expenseCategory).toBe("Updated PG Charges");
    expect(updated.autoSettle).toBe(false);
  });
});

// =============================================================================
// 2. Payment via Gateway — Happy Path
// =============================================================================

describe("payment via gateway — happy path", () => {
  it("creates payment with auto charge expense and settlement transfer", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    // Setup: gateway account with 2% credit card charge, linked to a bank account
    const settlement = await createSettlementAccount("HP Settlement", "0.00");
    const gateway = await createGatewayWithConfig({
      name: "Razorpay HP",
      settlementAccountId: settlement.id,
      chargeConfig: {
        credit_card: { type: "percentage", value: "2" },
        default: { type: "percentage", value: "2" },
      },
    });

    const invoice = await createSaleInvoice("1000.00");

    // Action: create payment of 1000 via credit card through gateway
    const payment = await caller.payment.create({
      partyId: world.party1.id,
      invoiceId: invoice.id,
      amount: "1000.00",
      mode: "credit_card",
      bankAccountId: gateway.id,
    });

    expect(payment).toBeDefined();
    expect(payment.amount).toBe("1000.00");

    // Verify gateway account balance: deposit(1000) - charge(20) - settlement(980) = 0
    const [gwAcct] = await db
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, gateway.id));
    expect(gwAcct!.currentBalance).toBe("0.00");

    // Verify settlement account balance: deposit(980) = 980
    const [settAcct] = await db
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, settlement.id));
    expect(settAcct!.currentBalance).toBe("980.00");

    // Verify expense created: 20.00, category "Payment Gateway Charges"
    const expenseRows = await db
      .select({
        amount: expenses.amount,
        category: expenses.category,
        bankAccountId: expenses.bankAccountId,
        deletedAt: expenses.deletedAt,
      })
      .from(expenses)
      .where(
        and(
          eq(expenses.businessId, world.business1.id),
          eq(expenses.category, "Payment Gateway Charges"),
          eq(expenses.bankAccountId, gateway.id),
          isNull(expenses.deletedAt),
        )
      );

    // At least one matching expense of 20.00
    const chargeExpense = expenseRows.find((e) => e.amount === "20.00");
    expect(chargeExpense).toBeDefined();

    // Verify bank transactions on gateway: 3 (deposit, charge withdrawal, settlement withdrawal)
    const gwTxns = await db
      .select({
        type: bankTransactions.type,
        amount: bankTransactions.amount,
        referenceType: bankTransactions.referenceType,
        paymentId: bankTransactions.paymentId,
      })
      .from(bankTransactions)
      .where(eq(bankTransactions.bankAccountId, gateway.id));

    // Expect deposit (payment), withdrawal (charge), withdrawal (settlement)
    const gwDeposits = gwTxns.filter((t) => t.type === "deposit");
    const gwWithdrawals = gwTxns.filter((t) => t.type === "withdrawal");
    expect(gwDeposits.length).toBe(1);
    expect(gwDeposits[0]!.amount).toBe("1000.00");
    expect(gwWithdrawals.length).toBe(2);

    // One withdrawal is the charge (20), other is settlement (980)
    const chargeWithdrawal = gwWithdrawals.find((t) => t.referenceType === "gateway_charge");
    const settlementWithdrawal = gwWithdrawals.find((t) => t.referenceType === "gateway_settlement");
    expect(chargeWithdrawal).toBeDefined();
    expect(chargeWithdrawal!.amount).toBe("20.00");
    expect(settlementWithdrawal).toBeDefined();
    expect(settlementWithdrawal!.amount).toBe("980.00");

    // All gateway transactions should have paymentId set
    for (const txn of gwTxns) {
      if (txn.referenceType === "gateway_charge" || txn.referenceType === "gateway_settlement") {
        expect(txn.paymentId).toBe(payment.id);
      }
    }

    // Verify settlement account transaction: 1 deposit of 980
    const settTxns = await db
      .select({
        type: bankTransactions.type,
        amount: bankTransactions.amount,
        referenceType: bankTransactions.referenceType,
      })
      .from(bankTransactions)
      .where(eq(bankTransactions.bankAccountId, settlement.id));

    const settDeposit = settTxns.find((t) => t.referenceType === "gateway_settlement");
    expect(settDeposit).toBeDefined();
    expect(settDeposit!.type).toBe("deposit");
    expect(settDeposit!.amount).toBe("980.00");
  });

  it("zero charge mode (UPI 0%) — no expense, direct settlement", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const settlement = await createSettlementAccount("UPI Settlement", "0.00");
    const gateway = await createGatewayWithConfig({
      name: "Razorpay UPI",
      settlementAccountId: settlement.id,
      chargeConfig: {
        upi: { type: "percentage", value: "0" },
        default: { type: "percentage", value: "2" },
      },
    });

    const invoice = await createSaleInvoice("1000.00");

    const payment = await caller.payment.create({
      partyId: world.party1.id,
      invoiceId: invoice.id,
      amount: "1000.00",
      mode: "upi",
      bankAccountId: gateway.id,
    });

    // Gateway: deposit(1000) - settlement(1000) = 0
    const [gwAcct] = await db
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, gateway.id));
    expect(gwAcct!.currentBalance).toBe("0.00");

    // Settlement: deposit(1000)
    const [settAcct] = await db
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, settlement.id));
    expect(settAcct!.currentBalance).toBe("1000.00");

    // No expense created for this gateway on this payment (charge is 0)
    const gwChargeTxns = await db
      .select()
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.bankAccountId, gateway.id),
          eq(bankTransactions.referenceType, "gateway_charge"),
          eq(bankTransactions.paymentId, payment.id),
        )
      );
    expect(gwChargeTxns).toHaveLength(0);
  });

  it("flat charge — fixed fee regardless of amount", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const settlement = await createSettlementAccount("Flat Fee Settlement", "0.00");
    const gateway = await createGatewayWithConfig({
      name: "Razorpay Flat",
      settlementAccountId: settlement.id,
      chargeConfig: {
        credit_card: { type: "flat", value: "10.00" },
      },
    });

    const invoice = await createSaleInvoice("500.00");

    await caller.payment.create({
      partyId: world.party1.id,
      invoiceId: invoice.id,
      amount: "500.00",
      mode: "credit_card",
      bankAccountId: gateway.id,
    });

    // Gateway: deposit(500) - charge(10) - settlement(490) = 0
    const [gwAcct] = await db
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, gateway.id));
    expect(gwAcct!.currentBalance).toBe("0.00");

    // Settlement: deposit(490)
    const [settAcct] = await db
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, settlement.id));
    expect(settAcct!.currentBalance).toBe("490.00");

    // Verify the charge withdrawal is exactly 10.00 (flat)
    const chargeTxn = await db
      .select({ amount: bankTransactions.amount })
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.bankAccountId, gateway.id),
          eq(bankTransactions.referenceType, "gateway_charge"),
        )
      );
    expect(chargeTxn.length).toBe(1);
    expect(chargeTxn[0]!.amount).toBe("10.00");
  });

  it("auto-settle disabled — money stays in gateway account", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const settlement = await createSettlementAccount("No-Settle Settlement", "0.00");
    const gateway = await createGatewayWithConfig({
      name: "Manual Settle Gateway",
      settlementAccountId: settlement.id,
      chargeConfig: {
        credit_card: { type: "percentage", value: "2" },
      },
      autoSettle: false,
    });

    const invoice = await createSaleInvoice("1000.00");

    await caller.payment.create({
      partyId: world.party1.id,
      invoiceId: invoice.id,
      amount: "1000.00",
      mode: "credit_card",
      bankAccountId: gateway.id,
    });

    // Gateway: deposit(1000) - charge(20) = 980 (no settlement transfer)
    const [gwAcct] = await db
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, gateway.id));
    expect(gwAcct!.currentBalance).toBe("980.00");

    // Settlement: unchanged at 0
    const [settAcct] = await db
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, settlement.id));
    expect(settAcct!.currentBalance).toBe("0.00");

    // No settlement transactions on settlement account
    const settTxns = await db
      .select()
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.bankAccountId, settlement.id),
          eq(bankTransactions.referenceType, "gateway_settlement"),
        )
      );
    expect(settTxns).toHaveLength(0);
  });

  it("falls back to default rate when mode not in config", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const settlement = await createSettlementAccount("Fallback Settlement", "0.00");
    const gateway = await createGatewayWithConfig({
      name: "Fallback Gateway",
      settlementAccountId: settlement.id,
      chargeConfig: {
        credit_card: { type: "percentage", value: "2" },
        // No debit_card key — should fall back to default
        default: { type: "percentage", value: "1.5" },
      },
    });

    const invoice = await createSaleInvoice("1000.00");

    await caller.payment.create({
      partyId: world.party1.id,
      invoiceId: invoice.id,
      amount: "1000.00",
      mode: "debit_card",
      bankAccountId: gateway.id,
    });

    // 1.5% of 1000 = 15.00 charge, 985.00 settlement
    const [gwAcct] = await db
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, gateway.id));
    expect(gwAcct!.currentBalance).toBe("0.00");

    const [settAcct] = await db
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, settlement.id));
    expect(settAcct!.currentBalance).toBe("985.00");

    // Verify charge amount is 15.00 (default 1.5%)
    const chargeTxn = await db
      .select({ amount: bankTransactions.amount })
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.bankAccountId, gateway.id),
          eq(bankTransactions.referenceType, "gateway_charge"),
        )
      );
    expect(chargeTxn.length).toBe(1);
    expect(chargeTxn[0]!.amount).toBe("15.00");
  });
});

// =============================================================================
// 3. Payment Update/Delete with Gateway Reversal
// =============================================================================

describe("gateway reversal on payment update/delete", () => {
  it("delete payment reverses charge expense and settlement", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const settlement = await createSettlementAccount("Delete Reversal Settlement", "0.00");
    const gateway = await createGatewayWithConfig({
      name: "Delete Reversal Gateway",
      settlementAccountId: settlement.id,
      chargeConfig: {
        credit_card: { type: "percentage", value: "2" },
      },
    });

    const invoice = await createSaleInvoice("1000.00");

    const payment = await caller.payment.create({
      partyId: world.party1.id,
      invoiceId: invoice.id,
      amount: "1000.00",
      mode: "credit_card",
      bankAccountId: gateway.id,
    });

    // Verify initial state
    const [gwBefore] = await db
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, gateway.id));
    expect(gwBefore!.currentBalance).toBe("0.00");

    const [settBefore] = await db
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, settlement.id));
    expect(settBefore!.currentBalance).toBe("980.00");

    // Delete the payment
    await caller.payment.delete({ id: payment.id });

    // Gateway balance should be back to 0 (all transactions reversed)
    const [gwAfter] = await db
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, gateway.id));
    expect(gwAfter!.currentBalance).toBe("0.00");

    // Settlement balance should be back to 0
    const [settAfter] = await db
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, settlement.id));
    expect(settAfter!.currentBalance).toBe("0.00");

    // All gateway-related bank transactions should be deleted
    const gwTxns = await db
      .select()
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.paymentId, payment.id),
        )
      );
    expect(gwTxns).toHaveLength(0);

    // The charge expense should be soft-deleted
    const chargeExpenses = await db
      .select({ deletedAt: expenses.deletedAt })
      .from(expenses)
      .where(
        and(
          eq(expenses.businessId, world.business1.id),
          eq(expenses.category, "Payment Gateway Charges"),
          eq(expenses.bankAccountId, gateway.id),
        )
      );

    // Every charge expense for this gateway should have deletedAt set
    for (const exp of chargeExpenses) {
      expect(exp.deletedAt).not.toBeNull();
    }
  });

  it("update payment amount recalculates gateway charge", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const settlement = await createSettlementAccount("Update Amount Settlement", "0.00");
    const gateway = await createGatewayWithConfig({
      name: "Update Amount Gateway",
      settlementAccountId: settlement.id,
      chargeConfig: {
        credit_card: { type: "percentage", value: "2" },
      },
    });

    const invoice = await createSaleInvoice("2000.00");

    const payment = await caller.payment.create({
      partyId: world.party1.id,
      invoiceId: invoice.id,
      amount: "1000.00",
      mode: "credit_card",
      bankAccountId: gateway.id,
    });

    // Before update: charge = 20, settlement = 980
    const [settBefore] = await db
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, settlement.id));
    expect(settBefore!.currentBalance).toBe("980.00");

    // Update payment to 500 (from 1000)
    await caller.payment.update({
      id: payment.id,
      amount: "500.00",
    });

    // After update: new charge = 2% of 500 = 10, settlement = 490
    const [gwAfter] = await db
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, gateway.id));
    expect(gwAfter!.currentBalance).toBe("0.00");

    const [settAfter] = await db
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, settlement.id));
    expect(settAfter!.currentBalance).toBe("490.00");
  });

  it("update payment from gateway to regular account reverses gateway ops", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const settlement = await createSettlementAccount("Switch Away Settlement", "0.00");
    const gateway = await createGatewayWithConfig({
      name: "Switch Away Gateway",
      settlementAccountId: settlement.id,
      chargeConfig: {
        credit_card: { type: "percentage", value: "2" },
      },
    });

    const regularAccount = await caller.bankAccount.create({
      accountName: "Regular Account for Switch",
      accountType: "savings",
      openingBalance: "0.00",
      isDefault: false,
    });

    const invoice = await createSaleInvoice("1000.00");

    const payment = await caller.payment.create({
      partyId: world.party1.id,
      invoiceId: invoice.id,
      amount: "1000.00",
      mode: "credit_card",
      bankAccountId: gateway.id,
    });

    // Verify gateway processed: settlement has 980
    const [settBefore] = await db
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, settlement.id));
    expect(settBefore!.currentBalance).toBe("980.00");

    // Update: switch to regular bank account
    await caller.payment.update({
      id: payment.id,
      bankAccountId: regularAccount.id,
    });

    // Gateway should be back to 0 (reversed)
    const [gwAfter] = await db
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, gateway.id));
    expect(gwAfter!.currentBalance).toBe("0.00");

    // Settlement should be back to 0 (reversed)
    const [settAfter] = await db
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, settlement.id));
    expect(settAfter!.currentBalance).toBe("0.00");

    // Regular account should have the full 1000 deposited
    const [regAcct] = await db
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, regularAccount.id));
    expect(regAcct!.currentBalance).toBe("1000.00");

    // No gateway transactions should remain for this payment
    const gwChargeTxns = await db
      .select()
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.paymentId, payment.id),
          eq(bankTransactions.referenceType, "gateway_charge"),
        )
      );
    expect(gwChargeTxns).toHaveLength(0);

    const gwSettleTxns = await db
      .select()
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.paymentId, payment.id),
          eq(bankTransactions.referenceType, "gateway_settlement"),
        )
      );
    expect(gwSettleTxns).toHaveLength(0);
  });

  it("update payment mode changes charge rate", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const settlement = await createSettlementAccount("Mode Change Settlement", "0.00");
    const gateway = await createGatewayWithConfig({
      name: "Mode Change Gateway",
      settlementAccountId: settlement.id,
      chargeConfig: {
        credit_card: { type: "percentage", value: "2" },
        debit_card: { type: "percentage", value: "1" },
      },
    });

    const invoice = await createSaleInvoice("1000.00");

    const payment = await caller.payment.create({
      partyId: world.party1.id,
      invoiceId: invoice.id,
      amount: "1000.00",
      mode: "credit_card",
      bankAccountId: gateway.id,
    });

    // Before: 2% charge on credit_card = 20, settlement = 980
    const [settBefore] = await db
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, settlement.id));
    expect(settBefore!.currentBalance).toBe("980.00");

    // Update: change mode to debit_card
    await caller.payment.update({
      id: payment.id,
      mode: "debit_card",
    });

    // After: 1% charge on debit_card = 10, settlement = 990
    const [gwAfter] = await db
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, gateway.id));
    expect(gwAfter!.currentBalance).toBe("0.00");

    const [settAfter] = await db
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, settlement.id));
    expect(settAfter!.currentBalance).toBe("990.00");
  });
});

// =============================================================================
// 4. Edge Cases
// =============================================================================

describe("gateway edge cases", () => {
  it("charge equals payment amount — net is zero, no settlement", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const settlement = await createSettlementAccount("Full Charge Settlement", "0.00");
    const gateway = await createGatewayWithConfig({
      name: "Full Charge Gateway",
      settlementAccountId: settlement.id,
      chargeConfig: {
        // Flat charge of exactly 100 on a 100 payment
        credit_card: { type: "flat", value: "100.00" },
      },
    });

    const invoice = await createSaleInvoice("100.00");

    await caller.payment.create({
      partyId: world.party1.id,
      invoiceId: invoice.id,
      amount: "100.00",
      mode: "credit_card",
      bankAccountId: gateway.id,
    });

    // Gateway: deposit(100) - charge(100) = 0, no settlement (net = 0)
    const [gwAcct] = await db
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, gateway.id));
    expect(gwAcct!.currentBalance).toBe("0.00");

    // Settlement: unchanged at 0 (no net to settle)
    const [settAcct] = await db
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, settlement.id));
    expect(settAcct!.currentBalance).toBe("0.00");

    // No settlement transactions should exist
    const settTxns = await db
      .select()
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.bankAccountId, settlement.id),
          eq(bankTransactions.referenceType, "gateway_settlement"),
        )
      );
    expect(settTxns).toHaveLength(0);
  });

  it("charge rate 100% — full amount is charge, net zero", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const settlement = await createSettlementAccount("100% Charge Settlement", "0.00");
    const gateway = await createGatewayWithConfig({
      name: "100% Charge Gateway",
      settlementAccountId: settlement.id,
      chargeConfig: {
        credit_card: { type: "percentage", value: "100" },
      },
    });

    const invoice = await createSaleInvoice("500.00");

    await caller.payment.create({
      partyId: world.party1.id,
      invoiceId: invoice.id,
      amount: "500.00",
      mode: "credit_card",
      bankAccountId: gateway.id,
    });

    // Gateway: deposit(500) - charge(500) = 0
    const [gwAcct] = await db
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, gateway.id));
    expect(gwAcct!.currentBalance).toBe("0.00");

    // Settlement: 0 (net is zero)
    const [settAcct] = await db
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, settlement.id));
    expect(settAcct!.currentBalance).toBe("0.00");

    // Charge should be exactly 500.00
    const chargeTxn = await db
      .select({ amount: bankTransactions.amount })
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.bankAccountId, gateway.id),
          eq(bankTransactions.referenceType, "gateway_charge"),
        )
      );
    expect(chargeTxn.length).toBe(1);
    expect(chargeTxn[0]!.amount).toBe("500.00");
  });

  it("very small payment with 2% — charge rounds to paise precision", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const settlement = await createSettlementAccount("Small Payment Settlement", "0.00");
    const gateway = await createGatewayWithConfig({
      name: "Small Payment Gateway",
      settlementAccountId: settlement.id,
      chargeConfig: {
        credit_card: { type: "percentage", value: "2" },
      },
    });

    const invoice = await createSaleInvoice("1.00");

    await caller.payment.create({
      partyId: world.party1.id,
      invoiceId: invoice.id,
      amount: "1.00",
      mode: "credit_card",
      bankAccountId: gateway.id,
    });

    // 2% of 1.00 = 0.02, net = 0.98
    const [gwAcct] = await db
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, gateway.id));
    expect(gwAcct!.currentBalance).toBe("0.00");

    const [settAcct] = await db
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, settlement.id));
    expect(settAcct!.currentBalance).toBe("0.98");

    // Charge is 0.02
    const chargeTxn = await db
      .select({ amount: bankTransactions.amount })
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.bankAccountId, gateway.id),
          eq(bankTransactions.referenceType, "gateway_charge"),
        )
      );
    expect(chargeTxn.length).toBe(1);
    expect(chargeTxn[0]!.amount).toBe("0.02");
  });

  it("gateway config deleted but account exists — treated as regular account", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const settlement = await createSettlementAccount("Deleted Config Settlement", "0.00");
    const gateway = await createGatewayWithConfig({
      name: "Deleted Config Gateway",
      settlementAccountId: settlement.id,
      chargeConfig: {
        credit_card: { type: "percentage", value: "2" },
      },
    });

    // Delete the gateway config
    await caller.bankAccount.deleteGatewayConfig({
      bankAccountId: gateway.id,
    });

    const invoice = await createSaleInvoice("1000.00");

    // Payment through gateway account that no longer has a config
    await caller.payment.create({
      partyId: world.party1.id,
      invoiceId: invoice.id,
      amount: "1000.00",
      mode: "credit_card",
      bankAccountId: gateway.id,
    });

    // Gateway account should just have the deposit (treated as regular account)
    const [gwAcct] = await db
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, gateway.id));
    expect(gwAcct!.currentBalance).toBe("1000.00");

    // Settlement should be unchanged at 0
    const [settAcct] = await db
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, settlement.id));
    expect(settAcct!.currentBalance).toBe("0.00");

    // No gateway_charge or gateway_settlement transactions
    const gwSpecialTxns = await db
      .select()
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.bankAccountId, gateway.id),
          eq(bankTransactions.referenceType, "gateway_charge"),
        )
      );
    expect(gwSpecialTxns).toHaveLength(0);

    const gwSettleTxns = await db
      .select()
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.bankAccountId, gateway.id),
          eq(bankTransactions.referenceType, "gateway_settlement"),
        )
      );
    expect(gwSettleTxns).toHaveLength(0);
  });

  it("concurrent payments through same gateway process correctly", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const settlement = await createSettlementAccount("Concurrent Settlement", "0.00");
    const gateway = await createGatewayWithConfig({
      name: "Concurrent Gateway",
      settlementAccountId: settlement.id,
      chargeConfig: {
        credit_card: { type: "percentage", value: "2" },
      },
    });

    const inv1 = await createSaleInvoice("1000.00");
    const inv2 = await createSaleInvoice("2000.00");

    // Execute two payments concurrently
    const [payment1, payment2] = await Promise.all([
      caller.payment.create({
        partyId: world.party1.id,
        invoiceId: inv1.id,
        amount: "1000.00",
        mode: "credit_card",
        bankAccountId: gateway.id,
      }),
      caller.payment.create({
        partyId: world.party1.id,
        invoiceId: inv2.id,
        amount: "2000.00",
        mode: "credit_card",
        bankAccountId: gateway.id,
      }),
    ]);

    expect(payment1).toBeDefined();
    expect(payment2).toBeDefined();

    // Total charges: 2% of 1000 = 20 + 2% of 2000 = 40 → total charge = 60
    // Total settlement: 980 + 1960 = 2940
    // Gateway: deposits(3000) - charges(60) - settlements(2940) = 0
    const [gwAcct] = await db
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, gateway.id));
    expect(gwAcct!.currentBalance).toBe("0.00");

    // Settlement: 2940
    const [settAcct] = await db
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, settlement.id));
    expect(settAcct!.currentBalance).toBe("2940.00");
  });
});
