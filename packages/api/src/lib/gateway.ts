/**
 * Payment Gateway Processing
 *
 * When a payment is recorded through a payment_gateway bank account,
 * this module automatically:
 *   1. Creates an expense for the gateway charge (deducted from the gateway account)
 *   2. Optionally settles the net amount to the business's settlement bank account
 *
 * All money values are strings — never JS floating point.
 */

import { eq, and, inArray } from "drizzle-orm";
import { bankAccounts, bankTransactions, expenses, paymentGatewayConfigs } from "@hisaabo/db";
import { calculateGatewayCharge, money } from "@hisaabo/shared";
import type { TenantDatabase } from "../trpc.js";

/**
 * Accepts both the full TenantDatabase and a PgTransaction from `.transaction()`.
 * We use a structural pick so that both types satisfy the constraint.
 */
type DbOrTx = Pick<TenantDatabase, "select" | "insert" | "update" | "delete">;

export interface ProcessGatewayPaymentParams {
  businessId: string;
  paymentId: string;
  paymentNumber: string;
  bankAccountId: string;
  amount: string;
  mode: string;
  paymentDate: Date;
}

export interface ProcessGatewayResult {
  chargeAmount: string;
  netSettlement: string;
  expenseId: string | null;
  settlementAccountId: string | null;
}

/**
 * Process gateway charge + optional settlement after a payment deposit
 * is created on a payment_gateway bank account.
 *
 * Must be called inside the same transaction as the payment insert.
 */
export async function processGatewayPayment(
  db: DbOrTx,
  params: ProcessGatewayPaymentParams,
): Promise<ProcessGatewayResult | null> {
  // 1. Fetch gateway config for this bank account
  const [config] = await db
    .select()
    .from(paymentGatewayConfigs)
    .where(
      and(
        eq(paymentGatewayConfigs.bankAccountId, params.bankAccountId),
        eq(paymentGatewayConfigs.businessId, params.businessId),
      )
    )
    .limit(1);

  if (!config || !config.isActive) {
    return null;
  }

  // 2. Calculate gateway charge
  const { chargeAmount, netSettlement } = calculateGatewayCharge(
    params.amount,
    config.chargeConfig,
    params.mode,
  );

  let expenseId: string | null = null;

  // 3. If charge > 0, create the charge expense + withdrawal transaction
  if (money.compare(chargeAmount, "0") > 0) {
    // Lock the gateway bank account for balance update
    const [gatewayAccount] = await db
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, params.bankAccountId))
      .for("update")
      .limit(1);

    if (!gatewayAccount) {
      return null;
    }

    // Create the expense record for the gateway charge
    const [expense] = await db
      .insert(expenses)
      .values({
        businessId: params.businessId,
        category: config.expenseCategory,
        description: `Gateway charge on payment ${params.paymentNumber}`,
        amount: chargeAmount,
        mode: "other",
        expenseDate: params.paymentDate,
        bankAccountId: params.bankAccountId,
      })
      .returning();

    expenseId = expense.id;

    // Create withdrawal transaction for the charge
    await db.insert(bankTransactions).values({
      businessId: params.businessId,
      bankAccountId: params.bankAccountId,
      type: "withdrawal",
      amount: chargeAmount,
      description: `Gateway charge: ${params.paymentNumber}`,
      referenceType: "gateway_charge",
      referenceId: expense.id,
      paymentId: params.paymentId,
      transactionDate: params.paymentDate,
    });

    // Deduct charge from gateway account balance
    const newGatewayBalance = money.sub(gatewayAccount.currentBalance, chargeAmount);
    await db
      .update(bankAccounts)
      .set({ currentBalance: newGatewayBalance, updatedAt: new Date() })
      .where(eq(bankAccounts.id, params.bankAccountId));
  }

  // 4. If autoSettle and net > 0, transfer net amount to settlement account
  let settlementAccountId: string | null = null;

  if (config.autoSettle && money.compare(netSettlement, "0") > 0) {
    settlementAccountId = config.settlementAccountId;

    // Lock both accounts in consistent order to prevent deadlocks
    const firstId = params.bankAccountId < config.settlementAccountId
      ? params.bankAccountId
      : config.settlementAccountId;
    const secondId = params.bankAccountId < config.settlementAccountId
      ? config.settlementAccountId
      : params.bankAccountId;

    const [firstAccount] = await db
      .select({ id: bankAccounts.id, currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, firstId))
      .for("update")
      .limit(1);

    const [secondAccount] = await db
      .select({ id: bankAccounts.id, currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, secondId))
      .for("update")
      .limit(1);

    if (!firstAccount || !secondAccount) {
      return { chargeAmount, netSettlement, expenseId, settlementAccountId: null };
    }

    const gatewayAcct = firstAccount.id === params.bankAccountId ? firstAccount : secondAccount;
    const settlementAcct = firstAccount.id === config.settlementAccountId ? firstAccount : secondAccount;

    // Withdrawal from gateway account
    await db.insert(bankTransactions).values({
      businessId: params.businessId,
      bankAccountId: params.bankAccountId,
      type: "withdrawal",
      amount: netSettlement,
      description: `Settlement transfer: ${params.paymentNumber}`,
      referenceType: "gateway_settlement",
      referenceId: config.settlementAccountId,
      paymentId: params.paymentId,
      transactionDate: params.paymentDate,
    });

    // Deposit to settlement account
    await db.insert(bankTransactions).values({
      businessId: params.businessId,
      bankAccountId: config.settlementAccountId,
      type: "deposit",
      amount: netSettlement,
      description: `Gateway settlement: ${params.paymentNumber}`,
      referenceType: "gateway_settlement",
      referenceId: params.bankAccountId,
      paymentId: params.paymentId,
      transactionDate: params.paymentDate,
    });

    // Update balances
    const newGatewayBalance = money.sub(gatewayAcct.currentBalance, netSettlement);
    const newSettlementBalance = money.add(settlementAcct.currentBalance, netSettlement);

    await db
      .update(bankAccounts)
      .set({ currentBalance: newGatewayBalance, updatedAt: new Date() })
      .where(eq(bankAccounts.id, params.bankAccountId));

    await db
      .update(bankAccounts)
      .set({ currentBalance: newSettlementBalance, updatedAt: new Date() })
      .where(eq(bankAccounts.id, config.settlementAccountId));
  }

  return { chargeAmount, netSettlement, expenseId, settlementAccountId };
}

export interface ReverseGatewayPaymentParams {
  businessId: string;
  paymentId: string;
}

/**
 * Reverse all gateway-related transactions for a payment.
 *
 * Must be called inside the same transaction, BEFORE the main payment
 * bank transaction is reversed.
 */
export async function reverseGatewayPayment(
  db: DbOrTx,
  params: ReverseGatewayPaymentParams,
): Promise<void> {
  // Find all gateway-related bank transactions for this payment
  const gatewayTxns = await db
    .select({
      id: bankTransactions.id,
      bankAccountId: bankTransactions.bankAccountId,
      type: bankTransactions.type,
      amount: bankTransactions.amount,
      referenceType: bankTransactions.referenceType,
      referenceId: bankTransactions.referenceId,
    })
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.paymentId, params.paymentId),
        inArray(bankTransactions.referenceType, ["gateway_charge", "gateway_settlement"]),
      )
    );

  if (gatewayTxns.length === 0) return;

  // Process charge transactions: soft-delete linked expense, restore balance
  for (const txn of gatewayTxns) {
    if (txn.referenceType === "gateway_charge") {
      // Soft-delete the linked expense
      if (txn.referenceId) {
        await db
          .update(expenses)
          .set({ deletedAt: new Date() })
          .where(
            and(
              eq(expenses.id, txn.referenceId),
              eq(expenses.businessId, params.businessId),
            )
          );
      }

      // Lock and restore gateway account balance (reverse the withdrawal)
      const [account] = await db
        .select({ currentBalance: bankAccounts.currentBalance })
        .from(bankAccounts)
        .where(eq(bankAccounts.id, txn.bankAccountId))
        .for("update")
        .limit(1);

      if (account) {
        const restoredBalance = money.add(account.currentBalance, txn.amount);
        await db
          .update(bankAccounts)
          .set({ currentBalance: restoredBalance, updatedAt: new Date() })
          .where(eq(bankAccounts.id, txn.bankAccountId));
      }

      // Delete the charge bank transaction
      await db.delete(bankTransactions).where(eq(bankTransactions.id, txn.id));
    }
  }

  // Process settlement transactions: reverse both sides
  // Settlement transactions come in pairs: withdrawal from gateway, deposit to settlement
  const settlementTxns = gatewayTxns.filter((t) => t.referenceType === "gateway_settlement");

  for (const txn of settlementTxns) {
    // Lock and restore the balance for this transaction's bank account
    const [account] = await db
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, txn.bankAccountId))
      .for("update")
      .limit(1);

    if (account) {
      // Reverse: if it was a withdrawal, add back; if deposit, subtract
      const restoredBalance =
        txn.type === "withdrawal"
          ? money.add(account.currentBalance, txn.amount)
          : money.sub(account.currentBalance, txn.amount);

      await db
        .update(bankAccounts)
        .set({ currentBalance: restoredBalance, updatedAt: new Date() })
        .where(eq(bankAccounts.id, txn.bankAccountId));
    }

    // Delete the settlement bank transaction
    await db.delete(bankTransactions).where(eq(bankTransactions.id, txn.id));
  }
}
