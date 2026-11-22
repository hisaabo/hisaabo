/**
 * journal-reversal.ts — helpers for system code that posts a persisted journal
 * and later has to take it back (today: `itc.recordUtilization`, which must be
 * idempotent per return period).
 *
 * A reversal is the original's lines with debit and credit swapped, dated like
 * the original, linked both ways (`reverses_entry_id` on the reversal,
 * `voided_by_entry_id` + `is_voided` on the original) exactly as `journal.void`
 * does, so the two entries net to zero in every report and the history stays
 * auditable. Nothing is deleted.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { journalEntries, journalEntryLines } from "@hisaabo/db";

// A Drizzle transaction (tenant DB).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

/**
 * Take the per-business lock that serialises journal numbering. Journal.create /
 * void / template use the same key, so system and manual postings never race
 * for the same `JE-nnnnn`. Held until the transaction ends.
 */
export async function lockJournalNumbering(tx: Tx, businessId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${businessId} || ':journal_entry_number'))`);
}

/** The next `JE-nnnnn` number for the business. Call it under `lockJournalNumbering`. */
export async function nextJournalEntryNumber(tx: Tx, businessId: string): Promise<string> {
  const [maxEntry] = await tx
    .select({
      count: sql<number>`COALESCE(MAX(CAST(SUBSTRING(entry_number FROM '[0-9]+$') AS INTEGER)), 0)`,
    })
    .from(journalEntries)
    .where(eq(journalEntries.businessId, businessId));
  const nextNum = (maxEntry?.count ?? 0) + 1;
  return `JE-${String(nextNum).padStart(5, "0")}`;
}

/** Live (not voided, not itself a reversal) SYSTEM journals of a business with exactly this narration. */
export async function findLiveSystemJournals(
  tx: Tx,
  businessId: string,
  narration: string,
): Promise<Array<{ id: string; entryNumber: string; entryDate: Date }>> {
  return tx
    .select({
      id: journalEntries.id,
      entryNumber: journalEntries.entryNumber,
      entryDate: journalEntries.entryDate,
    })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.businessId, businessId),
        eq(journalEntries.source, "system"),
        eq(journalEntries.isVoided, false),
        isNull(journalEntries.reversesEntryId),
        eq(journalEntries.narration, narration),
      ),
    );
}

/**
 * Reverse `entry` inside the caller's transaction (which must hold
 * `lockJournalNumbering`): insert the mirrored entry and mark the original
 * voided. Returns the reversing entry's id.
 */
export async function reverseJournalEntry(
  tx: Tx,
  businessId: string,
  entry: { id: string; entryNumber: string; entryDate: Date },
  by: { userId: string; userName: string | null },
): Promise<string> {
  const originalLines: Array<{
    accountId: string;
    debit: string;
    credit: string;
    narration: string | null;
  }> = await tx
    .select({
      accountId: journalEntryLines.accountId,
      debit: journalEntryLines.debit,
      credit: journalEntryLines.credit,
      narration: journalEntryLines.narration,
    })
    .from(journalEntryLines)
    .where(eq(journalEntryLines.journalEntryId, entry.id));

  const entryNumber = await nextJournalEntryNumber(tx, businessId);
  const [reversal] = await tx
    .insert(journalEntries)
    .values({
      businessId,
      entryNumber,
      entryDate: entry.entryDate,
      narration: `Void: reversal of ${entry.entryNumber}`,
      source: "system",
      reversesEntryId: entry.id,
      createdByUserId: by.userId,
      createdByName: by.userName,
    })
    .returning();

  if (originalLines.length > 0) {
    await tx.insert(journalEntryLines).values(
      originalLines.map((line) => ({
        journalEntryId: reversal.id,
        accountId: line.accountId,
        debit: line.credit, // swap: the original credit becomes a debit
        credit: line.debit,
        narration: line.narration,
      })),
    );
  }

  await tx
    .update(journalEntries)
    .set({ isVoided: true, voidedByEntryId: reversal.id, updatedAt: new Date() })
    .where(eq(journalEntries.id, entry.id));

  return reversal.id as string;
}
