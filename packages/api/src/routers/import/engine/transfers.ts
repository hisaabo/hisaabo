import { bankAccounts, bankTransactions } from "@hisaabo/db";
import { eq, sql } from "drizzle-orm";
import type { TenantDatabase } from "../../../trpc.js";
import type { CanonicalTransfer } from "../types.js";

export interface TransfersImportResult {
  created: number;
  total: number;
  errors: string[];
  accounts: Array<{ type: string; id: string; name: string }>;
}

export async function runTransfersImport(
  db: TenantDatabase,
  businessId: string,
  _userId: string,
  _source: string,
  canonicalTransfers: CanonicalTransfer[],
): Promise<TransfersImportResult> {
  let created = 0;
  const errors: string[] = [];

  // Map mode → account type
  const modeToType: Record<string, "cash" | "savings" | "upi"> = {
    cash: "cash",
    bank: "savings",
    upi: "upi",
  };

  const modeToName: Record<string, string> = {
    cash: "Cash",
    bank: "Bank Account",
    upi: "UPI",
  };

  // Ensure accounts exist for each mode used in transfers
  const modesNeeded = new Set<string>();
  for (const t of canonicalTransfers) {
    modesNeeded.add(t.fromMode);
    modesNeeded.add(t.toMode);
  }

  const existingAccounts = await db.select()
    .from(bankAccounts)
    .where(eq(bankAccounts.businessId, businessId));

  const accountByType = new Map(existingAccounts.map(a => [a.accountType, a]));

  // Auto-create missing accounts
  for (const mode of modesNeeded) {
    const acctType = modeToType[mode] || "savings";
    if (!accountByType.has(acctType)) {
      const [acct] = await db.insert(bankAccounts).values({
        businessId,
        accountName: modeToName[mode] || mode,
        accountType: acctType,
        openingBalance: "0",
        currentBalance: "0",
        isDefault: acctType === "savings",
      }).returning();
      accountByType.set(acctType, acct);
    }
  }

  // Process transfers
  for (const t of canonicalTransfers) {
    const fromType = modeToType[t.fromMode] || "savings";
    const toType = modeToType[t.toMode] || "savings";
    const fromAccount = accountByType.get(fromType);
    const toAccount = accountByType.get(toType);

    if (!fromAccount || !toAccount || fromAccount.id === toAccount.id) {
      errors.push(`Cannot transfer: ${t.fromMode} → ${t.toMode}`);
      continue;
    }

    await db.transaction(async (tx) => {
      const amount = t.amount;

      // Withdraw from source
      await tx.insert(bankTransactions).values({
        bankAccountId: fromAccount.id,
        businessId,
        type: "withdrawal",
        amount,
        description: t.notes || `Transfer to ${modeToName[t.toMode] || t.toMode}`,
        referenceType: "transfer",
        transactionDate: t.date,
      });
      await tx.update(bankAccounts).set({
        currentBalance: sql`${bankAccounts.currentBalance}::numeric - ${amount}::numeric`,
        updatedAt: new Date(),
      }).where(eq(bankAccounts.id, fromAccount.id));

      // Deposit to destination
      await tx.insert(bankTransactions).values({
        bankAccountId: toAccount.id,
        businessId,
        type: "deposit",
        amount,
        description: t.notes || `Transfer from ${modeToName[t.fromMode] || t.fromMode}`,
        referenceType: "transfer",
        transactionDate: t.date,
      });
      await tx.update(bankAccounts).set({
        currentBalance: sql`${bankAccounts.currentBalance}::numeric + ${amount}::numeric`,
        updatedAt: new Date(),
      }).where(eq(bankAccounts.id, toAccount.id));
    });

    created++;
  }

  // Return the account IDs so frontend knows what was created
  const accounts = Array.from(accountByType.entries()).map(([type, a]) => ({
    type,
    id: a.id,
    name: a.accountName,
  }));

  return { created, total: canonicalTransfers.length, errors, accounts };
}
