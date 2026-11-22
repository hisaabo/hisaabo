/**
 * bank-statement-dedup.ts — duplicate detection for bank statement imports.
 *
 * Banks hand out overlapping statements (a Jan-Mar file followed by a Mar-May
 * file), and people re-upload the same file by mistake. Without detection every
 * overlapping line is imported twice, inflating the unmatched count and the
 * debit/credit totals of the reconciliation summary.
 *
 * A parsed line is a DUPLICATE when a line already exists in a *different*
 * import of the *same bank account* with the same
 *   (calendar day, debit, credit, reference number)
 * and, when the line has no reference number, the same normalized narration in
 * place of the reference. Lines inside the file being imported are never
 * compared with each other: two identical card swipes on the same day are two
 * transactions.
 *
 * Matching is multiset-style. If the earlier imports hold N lines with a given
 * key, at most N incoming lines with that key are treated as duplicates, so a
 * statement that legitimately contains one more identical line than before
 * still gets that extra line imported.
 *
 * Pure functions only; the router does the single database query.
 */

import { money } from "@hisaabo/shared";

const MS_PER_DAY = 86_400_000;

/** The columns of a statement line that take part in duplicate detection. */
export interface DedupLine {
  transactionDate: Date;
  debit: string | null | undefined;
  credit: string | null | undefined;
  referenceNumber?: string | null;
  narration?: string | null;
}

/**
 * Calendar-day number of a statement date.
 *
 * parseDate() builds ISO dates at UTC midnight but dd/mm/yyyy style dates at
 * server-local midnight, so the same statement day can be a different instant
 * depending on the file format and the server's timezone. Local midnight is
 * always within 12h of UTC midnight of the same day, so rounding to the nearest
 * UTC day maps both to the same number.
 */
export function statementDay(date: Date): number {
  return Math.round(date.getTime() / MS_PER_DAY);
}

/** Lower-case, collapse whitespace, trim. */
export function normalizeNarration(narration: string | null | undefined): string {
  return (narration ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeMoney(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  return money.add(v === "" ? "0" : v, "0");
}

/** Stable comparison key for a statement line. */
export function dedupKey(line: DedupLine): string {
  const ref = (line.referenceNumber ?? "").trim().toLowerCase();
  const tail = ref !== "" ? `r:${ref}` : `n:${normalizeNarration(line.narration)}`;
  return [
    statementDay(line.transactionDate),
    normalizeMoney(line.debit),
    normalizeMoney(line.credit),
    tail,
  ].join("|");
}

/**
 * Split `incoming` into lines to import (`fresh`) and the lines that already
 * exist in `existing` (`duplicates`, each paired with the existing line it
 * matched). `existing` must come from other imports of the same bank account,
 * never from the import being (re-)confirmed. Order is preserved in both lists.
 */
export function splitDuplicateLines<T extends DedupLine, E extends DedupLine = DedupLine>(
  incoming: readonly T[],
  existing: readonly E[],
): { fresh: T[]; duplicates: Array<{ line: T; existing: E }> } {
  // One queue of still-unclaimed existing lines per key; each incoming line
  // claims at most one (multiset matching).
  const available = new Map<string, E[]>();
  for (const line of existing) {
    const key = dedupKey(line);
    const queue = available.get(key);
    if (queue) queue.push(line);
    else available.set(key, [line]);
  }

  const fresh: T[] = [];
  const duplicates: Array<{ line: T; existing: E }> = [];
  for (const line of incoming) {
    const match = available.get(dedupKey(line))?.shift();
    if (match) duplicates.push({ line, existing: match });
    else fresh.push(line);
  }
  return { fresh, duplicates };
}

/** [from, to] bounds (inclusive, widened by one day for timezone drift) to query existing lines for. */
export function dedupWindow(lines: readonly DedupLine[]): { from: Date; to: Date } | null {
  if (lines.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const l of lines) {
    const t = l.transactionDate.getTime();
    if (t < min) min = t;
    if (t > max) max = t;
  }
  return { from: new Date(min - MS_PER_DAY), to: new Date(max + MS_PER_DAY) };
}
