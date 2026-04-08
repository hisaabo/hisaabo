/**
 * csv-parser.ts — CSV parsing utilities for Indian bank statements.
 *
 * WHY THIS FILE EXISTS:
 * Indian bank CSV exports are notoriously inconsistent: BOMs, footer rows,
 * varied date formats (DD/MM/YYYY, DD-MMM-YYYY, etc.), combined debit/credit
 * columns with +/- signs, and encoding quirks from legacy core banking systems.
 * This module normalises all of that into a uniform structure the reconciliation
 * engine can work with.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ParseCSVOptions {
  /** Hint at encoding when reading raw bytes (best-effort). Default: UTF-8 */
  encoding?: string;
}

export interface ColumnMapping {
  date: number;
  narration: number;
  debit?: number;
  credit?: number;
  amount?: number;
  type?: number;
  reference?: number;
  balance?: number;
  dateFormat: string;
  skipRows: number;
  amountSignConvention?: "debit_positive" | "credit_positive";
}

export interface ParsedStatementLine {
  lineNumber: number;
  transactionDate: Date;
  narration: string;
  debit: string;
  credit: string;
  balance?: string;
  referenceNumber?: string;
  rawData: Record<string, string>;
}

// ── CSV Parsing ───────────────────────────────────────────────────────────────

/**
 * Parse raw CSV content into a 2D array of strings.
 * Handles:
 *  - UTF-8 BOM (\uFEFF)
 *  - Windows line endings (\r\n)
 *  - Quoted fields with embedded commas and newlines
 *  - Empty/footer rows (rows where all cells are empty or contain only dashes)
 */
export function parseCSV(csvContent: string, _options?: ParseCSVOptions): string[][] {
  // Strip BOM
  let content = csvContent;
  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1);
  }

  // Normalise line endings
  content = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuote = false;
  let i = 0;

  while (i < content.length) {
    const ch = content[i]!;

    if (inQuote) {
      if (ch === '"') {
        // Check for escaped quote ""
        if (content[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuote = false;
      } else if (ch === "\n") {
        field += "\n";
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuote = true;
      } else if (ch === ",") {
        row.push(field.trim());
        field = "";
      } else if (ch === "\n") {
        row.push(field.trim());
        field = "";
        // Only keep non-empty rows and non-footer rows
        if (!isEmptyOrFooterRow(row)) {
          rows.push(row);
        }
        row = [];
        i++;
        continue;
      } else {
        field += ch;
      }
    }
    i++;
  }

  // Handle trailing field / row
  if (field || row.length > 0) {
    row.push(field.trim());
    if (!isEmptyOrFooterRow(row)) {
      rows.push(row);
    }
  }

  return rows;
}

function isEmptyOrFooterRow(row: string[]): boolean {
  if (row.length === 0) return true;
  // All cells empty
  if (row.every((c) => c === "")) return true;
  // Footer separator rows like "---" or "==="
  if (row.every((c) => /^[-=*]+$/.test(c) || c === "")) return true;
  return false;
}

// ── Header Detection ──────────────────────────────────────────────────────────

const HEADER_PATTERNS: Array<{
  field: keyof Omit<ColumnMapping, "dateFormat" | "skipRows" | "amountSignConvention">;
  patterns: RegExp[];
}> = [
  {
    field: "date",
    patterns: [
      /^(txn\s*)?date$/i,
      /^(value|posting|transaction|tran|trans)\s*date$/i,
      /^dt$/i,
    ],
  },
  {
    field: "narration",
    patterns: [
      /^(narration|description|particulars|remarks|details|memo)$/i,
      /^(transaction\s*)?description$/i,
      /^(transaction|tran|txn)\s*(detail|narration|particulars)$/i,
    ],
  },
  {
    field: "debit",
    patterns: [
      /^debit(\s*(amount|amt))?$/i,
      /^(withdrawal|dr)(\.?\s*(amount|amt))?$/i,
    ],
  },
  {
    field: "credit",
    patterns: [
      /^credit(\s*(amount|amt))?$/i,
      /^(deposit|cr)(\.?\s*(amount|amt))?$/i,
    ],
  },
  {
    field: "amount",
    patterns: [
      /^amount$/i,
      /^(transaction|txn|tran)?\s*amount$/i,
    ],
  },
  {
    field: "type",
    patterns: [
      /^(cr\/dr|dr\/cr|type|transaction\s*type|debit\/credit)$/i,
    ],
  },
  {
    field: "reference",
    patterns: [
      /^(cheque\s*(no|number)|chq\.?\s*(no|number))$/i,
      /^(ref\.?\s*(no|number)|reference\s*(no|number)?)$/i,
      /^(utr|neft\s*ref|imps\s*ref)$/i,
    ],
  },
  {
    field: "balance",
    patterns: [
      /^(closing\s*)?balance(\s*(amount|amt))?$/i,
      /^(available|running)\s*balance$/i,
    ],
  },
];

/**
 * Heuristically detect which column index corresponds to which semantic field.
 * Returns a partial mapping; the caller should fill in missing fields or let the
 * user override via the UI.
 */
export function detectColumnMapping(headers: string[]): Partial<ColumnMapping> {
  const mapping: Partial<ColumnMapping> = {};

  for (let colIdx = 0; colIdx < headers.length; colIdx++) {
    const header = (headers[colIdx] ?? "").trim();
    for (const { field, patterns } of HEADER_PATTERNS) {
      if (patterns.some((p) => p.test(header))) {
        // Only assign if not already assigned (first match wins)
        if (!(field in mapping)) {
          (mapping as Record<string, number>)[field] = colIdx;
        }
        break;
      }
    }
  }

  // Default skipRows = 1 (skip the header row itself)
  mapping.skipRows = 1;
  // Default date format
  mapping.dateFormat = "DD/MM/YYYY";

  return mapping;
}

// ── Date Parsing ─────────────────────────────────────────────────────────────

const MONTH_MAP: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Parse a date string supporting multiple formats commonly seen in Indian bank
 * statements. Returns a Date or null if unparseable.
 *
 * Supported formats:
 *   DD/MM/YYYY, D/M/YYYY
 *   MM/DD/YYYY  (rare but some private banks)
 *   YYYY-MM-DD  (ISO)
 *   DD-MMM-YYYY (01-Jan-2024)
 *   DD-MMM-YY   (01-Jan-24)
 *   DD.MM.YYYY
 *   YYYYMMDD
 */
export function parseDate(raw: string, format?: string): Date | null {
  const s = raw.trim();
  if (!s) return null;

  // Try ISO first (most unambiguous)
  if (/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(s)) {
    const d = new Date(s.slice(0, 10));
    return isNaN(d.getTime()) ? null : d;
  }

  // YYYYMMDD
  if (/^\d{8}$/.test(s)) {
    const year = parseInt(s.slice(0, 4), 10);
    const month = parseInt(s.slice(4, 6), 10) - 1;
    const day = parseInt(s.slice(6, 8), 10);
    const d = new Date(year, month, day);
    return isNaN(d.getTime()) ? null : d;
  }

  // DD-MMM-YYYY or DD-MMM-YY
  const dmmm = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{2,4})$/);
  if (dmmm) {
    const day = parseInt(dmmm[1]!, 10);
    const month = MONTH_MAP[dmmm[2]!.toLowerCase()];
    if (month === undefined) return null;
    let year = parseInt(dmmm[3]!, 10);
    if (year < 100) year += year < 50 ? 2000 : 1900;
    const d = new Date(year, month, day);
    return isNaN(d.getTime()) ? null : d;
  }

  // Separator-based: try to figure out format from hint or by inference
  const sep = s.includes("/") ? "/" : s.includes(".") ? "." : s.includes("-") ? "-" : null;
  if (!sep) return null;

  const parts = s.split(sep);
  if (parts.length < 3) return null;

  const a = parseInt(parts[0]!, 10);
  const b = parseInt(parts[1]!, 10);
  const c = parseInt(parts[2]!, 10);

  let day: number, month: number, year: number;

  if (format === "MM/DD/YYYY") {
    month = a - 1;
    day = b;
    year = c;
  } else if (format === "YYYY-MM-DD") {
    year = a;
    month = b - 1;
    day = c;
  } else {
    // Default: DD/MM/YYYY (Indian standard)
    day = a;
    month = b - 1;
    year = c;
  }

  if (year < 100) year += year < 50 ? 2000 : 1900;

  const d = new Date(year, month, day);
  return isNaN(d.getTime()) ? null : d;
}

// ── Statement Line Parser ─────────────────────────────────────────────────────

/**
 * Parse all CSV rows using a confirmed column mapping into typed statement lines.
 * Skips the header/summary rows per mapping.skipRows.
 */
export function parseStatementLines(
  rows: string[][],
  mapping: ColumnMapping,
): ParsedStatementLine[] {
  const lines: ParsedStatementLine[] = [];
  const startRow = mapping.skipRows;

  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i]!;
    const rawDateStr = row[mapping.date] ?? "";
    const date = parseDate(rawDateStr, mapping.dateFormat);
    if (!date) continue; // skip rows that don't have a parseable date

    const narration = (row[mapping.narration] ?? "").trim();

    // Determine debit / credit amounts
    let debit = "0.00";
    let credit = "0.00";

    if (mapping.debit !== undefined && mapping.credit !== undefined) {
      debit = cleanAmount(row[mapping.debit] ?? "");
      credit = cleanAmount(row[mapping.credit] ?? "");
    } else if (mapping.amount !== undefined) {
      const rawAmt = cleanAmount(row[mapping.amount] ?? "");
      const amt = parseFloat(rawAmt);
      if (!isNaN(amt)) {
        if (mapping.type !== undefined) {
          const typeVal = (row[mapping.type] ?? "").trim().toLowerCase();
          const isDebit =
            mapping.amountSignConvention === "debit_positive"
              ? amt > 0
              : typeVal === "dr" || typeVal === "debit" || typeVal === "withdrawal";
          if (isDebit) {
            debit = Math.abs(amt).toFixed(2);
          } else {
            credit = Math.abs(amt).toFixed(2);
          }
        } else if (amt < 0) {
          debit = Math.abs(amt).toFixed(2);
        } else {
          credit = amt.toFixed(2);
        }
      }
    }

    const balance =
      mapping.balance !== undefined ? cleanAmount(row[mapping.balance] ?? "") || undefined : undefined;

    const referenceNumber =
      mapping.reference !== undefined ? (row[mapping.reference] ?? "").trim() || undefined : undefined;

    // Build rawData map from all columns
    const rawData: Record<string, string> = {};
    for (let c = 0; c < row.length; c++) {
      rawData[`col_${c}`] = row[c] ?? "";
    }

    lines.push({
      lineNumber: i - startRow + 1,
      transactionDate: date,
      narration,
      debit,
      credit,
      balance,
      referenceNumber,
      rawData,
    });
  }

  return lines;
}

/**
 * Strip currency symbols, commas, and whitespace from amount strings.
 *
 * amountParsingMode:
 *   "standard"              (default) — strip non-numeric chars, take absolute value
 *   "dr_cr_suffix"          — "1,234.56 Dr" → debit (positive), "1,234.56 Cr" → credit (negative)
 *   "parentheses_negative"  — "(1,234.56)" → negative (debit)
 *   "signed"                — "+1,234.56" / "-1,234.56" — preserve sign
 *
 * Returns absolute value string; callers that need sign information should
 * use parseAmountWithSign and inspect the returned sign flag directly.
 */
export function cleanAmount(
  raw: string,
  mode: "standard" | "dr_cr_suffix" | "parentheses_negative" | "signed" = "standard",
): string {
  const { value } = parseAmountWithSign(raw, mode);
  return value;
}

/**
 * Parse an amount string and return its absolute value plus a sign flag.
 * isDebit = true means the value represents money going out.
 */
export function parseAmountWithSign(
  raw: string,
  mode: "standard" | "dr_cr_suffix" | "parentheses_negative" | "signed" = "standard",
): { value: string; isDebit: boolean | null } {
  const s = raw.trim();

  if (mode === "dr_cr_suffix") {
    // e.g. "1,234.56 Dr" or "1,234.56Cr"
    const match = s.match(/^([\d,]+(?:\.\d+)?)\s*(Dr|CR|Cr|DR)$/i);
    if (match) {
      const num = parseFloat(match[1]!.replace(/,/g, ""));
      if (isNaN(num)) return { value: "0.00", isDebit: null };
      const isDebit = /^dr$/i.test(match[2]!);
      return { value: Math.abs(num).toFixed(2), isDebit };
    }
    // Fall through to standard if pattern doesn't match
  }

  if (mode === "parentheses_negative") {
    // e.g. "(1,234.56)" means negative/debit
    const match = s.match(/^\(([\d,]+(?:\.\d+)?)\)$/);
    if (match) {
      const num = parseFloat(match[1]!.replace(/,/g, ""));
      if (isNaN(num)) return { value: "0.00", isDebit: null };
      return { value: Math.abs(num).toFixed(2), isDebit: true };
    }
    // Fall through to standard if not parenthesised
  }

  if (mode === "signed") {
    // e.g. "+1,234.56" (credit) or "-1,234.56" (debit)
    const cleaned = s.replace(/[₹,\s]/g, "");
    const num = parseFloat(cleaned);
    if (isNaN(num)) return { value: "0.00", isDebit: null };
    return { value: Math.abs(num).toFixed(2), isDebit: num < 0 };
  }

  // Standard: strip currency symbols/commas, take absolute value
  const cleaned = s.replace(/[₹,\s]/g, "").replace(/[^0-9.-]/g, "");
  const num = parseFloat(cleaned);
  if (isNaN(num)) return { value: "0.00", isDebit: null };
  return { value: Math.abs(num).toFixed(2), isDebit: null };
}
