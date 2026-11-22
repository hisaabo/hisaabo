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

import { cn, formatCurrency, formatDate } from "@/lib/utils";

/** One skipped line, as returned in `duplicates` by bankRecon.confirmMapping. */
export interface SkippedDuplicateLine {
  /** Position of the line in the uploaded file. */
  lineNumber: number;
  transactionDate: Date | string;
  debit: string;
  credit: string;
  referenceNumber: string | null;
  narration: string;
  /** The earlier import that already holds this line. */
  existingImportId: string;
  existingImportFileName: string;
}

/** What the page remembers about the import that was just confirmed. */
export interface ImportOutcome {
  importId: string;
  /** Lines actually imported (the result's `totalLines`). */
  totalLines: number;
  duplicatesSkipped: number;
  duplicates: SkippedDuplicateLine[];
}

function amountCell(value: string): string {
  const n = parseFloat(value);
  return Number.isFinite(n) && n !== 0 ? formatCurrency(n) : "—";
}

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
  lines,
}: {
  /** `duplicatesSkipped` from the confirmMapping result. */
  count: number;
  /** Lines that were imported (the result's `totalLines`). */
  importedLines: number;
  /** `duplicates` from the confirmMapping result (capped by the server; `count` is complete). */
  lines?: readonly SkippedDuplicateLine[];
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

      {lines && lines.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium text-text-secondary">
            Review skipped {lines.length === 1 ? "line" : "lines"}
          </summary>
          <div className="mt-2 overflow-x-auto">
            <table className="table-auto w-full text-xs">
              <thead>
                <tr className="border-b border-amber-500/30 text-left text-text-secondary">
                  <th className="px-2 py-1 font-medium">#</th>
                  <th className="px-2 py-1 font-medium">Date</th>
                  <th className="px-2 py-1 font-medium">Narration</th>
                  <th className="px-2 py-1 font-medium text-right">Debit</th>
                  <th className="px-2 py-1 font-medium text-right">Credit</th>
                  <th className="px-2 py-1 font-medium">Already in</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={`${l.lineNumber}-${l.existingImportId}`} className="border-b border-amber-500/20 last:border-0">
                    <td className="px-2 py-1 text-text-tertiary">{l.lineNumber}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{formatDate(l.transactionDate)}</td>
                    <td className="px-2 py-1 max-w-xs">
                      <p className="truncate">{l.narration || "—"}</p>
                      {l.referenceNumber && <p className="text-text-tertiary truncate">Ref {l.referenceNumber}</p>}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{amountCell(l.debit)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{amountCell(l.credit)}</td>
                    <td className="px-2 py-1 max-w-[12rem] truncate" title={l.existingImportFileName}>
                      {l.existingImportFileName}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {lines.length < count && (
            <p className="mt-1 text-xs text-text-tertiary">
              Showing the first {lines.length} of {count} skipped lines.
            </p>
          )}
        </details>
      )}
    </div>
  );
}
