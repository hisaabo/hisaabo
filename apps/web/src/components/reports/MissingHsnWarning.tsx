/**
 * Warning on the GSTR-1 report when sale lines have no HSN code. Table 12 files them under
 * "0000", which is not a real code, so the GSTR-1 JSON export is refused until they are fixed;
 * the report and the CSV still show them. Lists each item (with the invoices that sold it) and
 * the lines typed in without an item.
 */

export interface MissingHsnLine {
  invoiceNumber: string;
  /** 1-based line number on the invoice */
  line: number;
  itemName: string;
  /** null for a line typed in without an item */
  itemId: string | null;
}

/** A sale line whose item HSN cannot be filed (not 4 to 8 digits, or too short for the turnover). */
export interface InvalidHsnLine {
  invoiceNumber: string;
  line: number;
  itemName: string;
  itemId: string;
  hsn: string;
  /** e.g. "line 2 'Steel Rods' has HSN code '730', which is not 4 to 8 digits; correct it on the item" */
  problem: string;
}

export function MissingHsnWarning({ lines, invalid }: { lines: MissingHsnLine[] | undefined; invalid?: InvalidHsnLine[] | undefined }) {
  const missingLines = lines ?? [];
  const invalidLines = invalid ?? [];
  if (missingLines.length === 0 && invalidLines.length === 0) return null;
  const total = missingLines.length + invalidLines.length;

  const byItem = new Map<string, { name: string; where: string[] }>();
  const typedIn: string[] = [];
  for (const m of missingLines) {
    const where = `${m.invoiceNumber} line ${m.line}`;
    if (!m.itemId) {
      typedIn.push(`${where} (${m.itemName})`);
      continue;
    }
    const entry = byItem.get(m.itemId) ?? { name: m.itemName, where: [] };
    entry.where.push(where);
    byItem.set(m.itemId, entry);
  }

  return (
    <div
      role="alert"
      className="card px-5 py-4 border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 mb-6"
    >
      <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
        {total} line{total === 1 ? "" : "s"} {total === 1 ? "has" : "have"} {invalidLines.length === 0 ? "no HSN code" : "a missing or unusable HSN code"}
      </p>
      <p className="text-sm text-amber-800 dark:text-amber-300 mt-1">
        {missingLines.length > 0 && "Lines without an HSN are filed under HSN 0000 in Table 12, which is not a real code. "}
        {invalidLines.length > 0 && "A code must be 4 to 8 digits, and at least 6 digits when turnover is above \u20b95 Cr. "}
        The GSTR-1 JSON file cannot be exported until every line has a usable HSN. Fix them before filing.
      </p>
      <ul className="mt-2 text-sm text-amber-900 dark:text-amber-200 list-disc pl-5 space-y-1">
        {[...byItem.entries()].map(([id, e]) => (
          <li key={id}>
            Add the HSN on item <strong>{e.name}</strong> ({e.where.join(", ")})
          </li>
        ))}
        {typedIn.map((t) => (
          <li key={t}>
            {t}: typed in without an item, so it cannot carry an HSN; bill a catalogue item with an HSN
          </li>
        ))}
        {invalidLines.map((m) => (
          <li key={`${m.invoiceNumber}-${m.line}`}>
            {m.invoiceNumber} {m.problem}
          </li>
        ))}
      </ul>
    </div>
  );
}
