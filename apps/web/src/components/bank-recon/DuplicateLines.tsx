/**
 * Duplicate-line controls for the bank reconciliation upload/review flow.
 *
 * bankRecon.confirmMapping skips statement lines that already exist in another
 * import of the same bank account (same day, debit, credit and reference, or
 * narration when there is no reference) and reports how many in
 * `duplicatesSkipped`. These two pieces expose that to the user:
 *
 *   SkipDuplicatesToggle  on the column-mapping step; on by default
 *   DuplicateLinesNotice  on the review step, right after an import
 */

import { cn } from "@/lib/utils";

/** One-line summary shown in the toast after "Confirm & Auto-Match". */
export function importSummaryMessage(result: {
  totalLines: number;
  matchedLines: number;
  unmatchedLines: number;
  duplicatesSkipped: number;
}): string {
  const base = `Parsed ${result.totalLines} lines. ${result.matchedLines} auto-matched, ${result.unmatchedLines} unmatched.`;
  if (result.duplicatesSkipped <= 0) return base;
  const n = result.duplicatesSkipped;
  return `${base} ${n} duplicate ${n === 1 ? "line" : "lines"} skipped.`;
}

export function SkipDuplicatesToggle({
  checked,
  onChange,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}) {
  return (
    <label className={cn("flex items-start gap-3 cursor-pointer", className)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 w-4 h-4 rounded border-border-light text-brand-600"
      />
      <div>
        <span className="text-sm font-medium text-text-primary">
          Skip lines already imported from an earlier statement
        </span>
        <p className="text-xs text-text-tertiary">
          Overlapping statements repeat transactions. Lines with the same date, amount and
          reference (or narration, when there is no reference) as a line already imported for
          this bank account are left out. Turn off to import every line.
        </p>
      </div>
    </label>
  );
}

export function DuplicateLinesNotice({
  count,
  importedLines,
}: {
  /** `duplicatesSkipped` from the confirmMapping result. */
  count: number;
  /** Lines that were imported (the result's `totalLines`). */
  importedLines: number;
}) {
  if (count <= 0) return null;
  return (
    <div
      role="status"
      className="px-4 py-3 rounded-lg bg-amber-500/[0.08] border border-amber-500/30 text-sm text-text-primary"
    >
      <p className="font-medium">
        {count} duplicate {count === 1 ? "line was" : "lines were"} skipped
      </p>
      <p className="text-xs text-text-secondary mt-0.5">
        {count === 1 ? "It was" : "They were"} already imported from an earlier statement of this bank
        account, so {count === 1 ? "it is" : "they are"} not shown below.
        {importedLines === 0 && " Nothing new was imported from this file."}
      </p>
    </div>
  );
}
