/**
 * preprocess.ts — Apply bank-specific preprocessing to raw CSV rows.
 *
 * WHY THIS FILE EXISTS:
 * Indian bank CSVs often have multiple header rows, subtotal rows, and
 * non-transaction rows (disclaimers, account summaries) mixed in with
 * transaction data. These need to be stripped BEFORE column mapping runs.
 */

export interface PreprocessRules {
  extraHeaderRows?: number;
  skipRowPatterns?: string[];
  amountParsingMode?: "standard" | "dr_cr_suffix" | "parentheses_negative" | "signed";
  skipSubtotalRows?: boolean;
  encoding?: string;
}

const SUBTOTAL_PATTERNS = [
  /\btotal\b/i,
  /\bsub[\s-]?total\b/i,
  /\bgrand[\s-]?total\b/i,
  /\bopening[\s-]?balance\b/i,
  /\bclosing[\s-]?balance\b/i,
];

/**
 * Apply bank-specific preprocessing to raw CSV rows BEFORE column mapping.
 *
 * Steps:
 *  1. Skip extra header rows: keep row[0] as primary header, remove rows 1..extraHeaderRows
 *  2. Skip rows matching skipRowPatterns (regex against joined row text)
 *  3. Skip subtotal rows if skipSubtotalRows is set
 */
export function preprocessRows(rows: string[][], rules: PreprocessRules): string[][] {
  if (rows.length === 0) return rows;

  const extraHeaderRows = rules.extraHeaderRows ?? 0;
  const skipRowPatterns = (rules.skipRowPatterns ?? []).map((p) => new RegExp(p, "i"));
  const skipSubtotals = rules.skipSubtotalRows ?? false;

  const result: string[][] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;

    // Step 1: skip extra header rows (indices 1..extraHeaderRows)
    // Row 0 is the primary header and is always kept.
    if (i > 0 && i <= extraHeaderRows) {
      continue;
    }

    const joinedText = row.join(" ");

    // Step 2: skip rows matching user-defined patterns
    if (skipRowPatterns.some((p) => p.test(joinedText))) {
      continue;
    }

    // Step 3: skip subtotal / summary rows
    if (skipSubtotals && SUBTOTAL_PATTERNS.some((p) => p.test(joinedText))) {
      continue;
    }

    result.push(row);
  }

  return result;
}
