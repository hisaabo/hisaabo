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

  // Validate up front: the only per-row failures are unresolvable/identical
  // accounts, so valid rows can be written in bulk.
  const valid: Array<{ t: CanonicalTransfer; fromId: string; toId: string }> = [];
  for (const t of canonicalTransfers) {
    const fromAccount = accountByType.get(modeToType[t.fromMode] || "savings");
    const toAccount = accountByType.get(modeToType[t.toMode] || "savings");

    if (!fromAccount || !toAccount || fromAccount.id === toAccount.id) {
      errors.push(`Cannot transfer: ${t.fromMode} → ${t.toMode}`);
      continue;
    }
    valid.push({ t, fromId: fromAccount.id, toId: toAccount.id });
  }

  // One transaction per chunk: multi-row insert of withdrawal+deposit rows
  // (kept in per-transfer order) and a single balance UPDATE per distinct
  // account, with deltas summed in SQL numeric.
  const CHUNK = 500;
  for (let i = 0; i < valid.length; i += CHUNK) {
    const chunk = valid.slice(i, i + CHUNK);

    await db.transaction(async (tx) => {
      await tx.insert(bankTransactions).values(
        chunk.flatMap(({ t, fromId, toId }) => [
          {
            bankAccountId: fromId,
            businessId,
            type: "withdrawal" as const,
            amount: t.amount,
            description: t.notes || `Transfer to ${modeToName[t.toMode] || t.toMode}`,
            referenceType: "transfer",
            transactionDate: t.date,
          },
          {
            bankAccountId: toId,
            businessId,
            type: "deposit" as const,
            amount: t.amount,
            description: t.notes || `Transfer from ${modeToName[t.fromMode] || t.fromMode}`,
            referenceType: "transfer",
            transactionDate: t.date,
          },
        ]),
      );

      const deltaRows = sql.join(
        chunk.flatMap(({ t, fromId, toId }) => [
          sql`(${fromId}::uuid, ${t.amount}::numeric, -1)`,
          sql`(${toId}::uuid, ${t.amount}::numeric, 1)`,
        ]),
        sql`, `,
      );
      await tx.execute(sql`
        UPDATE bank_accounts SET
          current_balance = bank_accounts.current_balance::numeric + d.delta,
          updated_at = NOW()
        FROM (
          SELECT id, SUM(amount * sign) AS delta
          FROM (VALUES ${deltaRows}) AS x(id, amount, sign)
          GROUP BY id
        ) d
        WHERE bank_accounts.id = d.id
      `);
    });

    created += chunk.length;
  }

  // Return the account IDs so frontend knows what was created
  const accounts = Array.from(accountByType.entries()).map(([type, a]) => ({
    type,
    id: a.id,
    name: a.accountName,
  }));

  return { created, total: canonicalTransfers.length, errors, accounts };
}
