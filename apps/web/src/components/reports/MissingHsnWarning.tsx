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

export function MissingHsnWarning({ lines }: { lines: MissingHsnLine[] | undefined }) {
  if (!lines || lines.length === 0) return null;

  const byItem = new Map<string, { name: string; where: string[] }>();
  const typedIn: string[] = [];
  for (const m of lines) {
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
        {lines.length} line{lines.length === 1 ? "" : "s"} {lines.length === 1 ? "has" : "have"} no HSN code
      </p>
      <p className="text-sm text-amber-800 dark:text-amber-300 mt-1">
        They are filed under HSN 0000 in Table 12, which is not a real code, so the GSTR-1 JSON file cannot be
        exported until every line has an HSN. Fix them before filing.
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
      </ul>
    </div>
  );
}
