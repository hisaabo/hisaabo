/**
 * gstr2b-parser.ts — GSTR-2B JSON / CSV parser and reconciliation engine.
 *
 * GSTR-2B is a monthly auto-generated statement from the GST portal that shows
 * all inward supplies (purchases) as reported by a business's suppliers. SMBs
 * download it from gstn.gov.in and reconcile against their own purchase records
 * to verify ITC availability and ensure accurate GSTR-3B Table 4 filings.
 *
 * Supported formats:
 *   JSON — portal-format with nested b2b / cdnr / isd sections.
 *   CSV  — tab or comma-separated with a standard header row.
 *
 * Reconciliation logic:
 *   1. Match on: supplier GSTIN + invoice number (exact) + invoice date (±3 days).
 *   2. If all amount fields agree: "matched".
 *   3. If amounts differ: "mismatched" + list of mismatch reasons.
 *   4. 2B record not found in books: "missing_in_books".
 *   5. Our purchase invoice not in 2B: status "missing_in_2b" (returned separately).
 */

// ── Types ──────────────────────────────────────────────────────

export interface GSTR2BRecord {
  supplierGstin: string;
  supplierName: string | null;
  invoiceNumber: string;
  invoiceDate: Date | null;
  invoiceValue: string;
  taxableValue: string;
  cgst: string;
  sgst: string;
  igst: string;
  cess: string;
  itcAvailable: string | null;  // "Y" | "N"
  reason: string | null;
  sourceType: string;           // "B2B" | "B2BA" | "CDNR" | "ISD"
}

export interface PurchaseInvoice {
  id: string;
  invoiceNumber: string;
  invoiceDate: Date;
  partyGstin: string | null;
  subtotal: string;       // taxable value
  cgst: string;
  sgst: string;
  igst: string;
  cess?: string;
}

export type MatchStatus = "matched" | "mismatched" | "missing_in_books" | "pending";

export interface ReconciliationResult {
  record: GSTR2BRecord;
  matchStatus: MatchStatus;
  matchedInvoiceId: string | null;
  mismatchReasons: string[];
}

export interface MissingIn2BResult {
  invoice: PurchaseInvoice;
}

// ── Date parsing ───────────────────────────────────────────────

/**
 * Parse GST portal date string.
 * Accepts "DD-MM-YYYY", "DD/MM/YYYY", and ISO 8601.
 */
function parseGSTDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;

  // DD-MM-YYYY or DD/MM/YYYY
  const dmy = raw.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (dmy) {
    const d = Number(dmy[1]), m = Number(dmy[2]), y = Number(dmy[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return new Date(Date.UTC(y, m - 1, d));
    }
  }

  // ISO 8601
  const ts = Date.parse(raw);
  if (!isNaN(ts)) return new Date(ts);

  return null;
}

/** Absolute difference in days between two dates. */
function daysDiff(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24);
}

// ── Money normalisation ───────────────────────────────────────

function toMoney(val: unknown): string {
  const n = typeof val === "number" ? val : parseFloat(String(val ?? "0"));
  if (isNaN(n)) return "0.00";
  return n.toFixed(2);
}

// ── JSON Parser ───────────────────────────────────────────────

interface PortalItem {
  num?: number;
  rt?: number;
  txval?: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  cess?: number;
}

interface PortalInvoice {
  inum?: string;
  dt?: string;
  val?: number;
  pos?: string;
  itcavl?: string;
  rev?: string;
  typ?: string;
  items?: PortalItem[];
  // Credit/debit note fields
  nt?: Array<{
    ntnum?: string;
    dt?: string;
    val?: number;
    typ?: string;
    itcavl?: string;
    items?: PortalItem[];
  }>;
}

interface PortalB2BEntry {
  ctin?: string;
  trdnm?: string;
  inv?: PortalInvoice[];
}

interface PortalCDNREntry {
  ctin?: string;
  trdnm?: string;
  nt?: Array<{
    ntnum?: string;
    dt?: string;
    val?: number;
    typ?: string;
    itcavl?: string;
    items?: PortalItem[];
  }>;
}

interface PortalISDEntry {
  isd?: string;
  isdnm?: string;
  doclist?: Array<{
    docnum?: string;
    docdt?: string;
    docval?: number;
    igstisd?: number;
    cgstisd?: number;
    sgstisd?: number;
    igstcess?: number;
  }>;
}

interface PortalDocData {
  b2b?: PortalB2BEntry[];
  b2ba?: PortalB2BEntry[];  // Amendments
  cdnr?: PortalCDNREntry[];
  cdnra?: PortalCDNREntry[];
  isd?: PortalISDEntry[];
}

interface PortalGSTR2B {
  gstin?: string;
  ret_period?: string;
  docdata?: PortalDocData;
  // Some exports wrap docdata in a data.docdata
  data?: { docdata?: PortalDocData };
}

function sumItems(items: PortalItem[] | undefined): {
  txval: string; cgst: string; sgst: string; igst: string; cess: string;
} {
  let txval = 0, cgst = 0, sgst = 0, igst = 0, cess = 0;
  for (const item of items ?? []) {
    txval += item.txval ?? 0;
    cgst  += item.cgst  ?? 0;
    sgst  += item.sgst  ?? 0;
    igst  += item.igst  ?? 0;
    cess  += item.cess  ?? 0;
  }
  return {
    txval: toMoney(txval),
    cgst:  toMoney(cgst),
    sgst:  toMoney(sgst),
    igst:  toMoney(igst),
    cess:  toMoney(cess),
  };
}

export function parseGSTR2BJSON(jsonContent: string): GSTR2BRecord[] {
  let root: PortalGSTR2B;
  try {
    root = JSON.parse(jsonContent) as PortalGSTR2B;
  } catch {
    throw new Error("Invalid JSON: unable to parse GSTR-2B file");
  }

  // Support both direct docdata and nested data.docdata
  const docdata: PortalDocData = root.docdata ?? root.data?.docdata ?? {};
  const records: GSTR2BRecord[] = [];

  // ── B2B (and B2BA amendments) ─────────────────────────────────
  for (const section of ["b2b", "b2ba"] as const) {
    for (const entry of docdata[section] ?? []) {
      const gstin = (entry.ctin ?? "").trim().toUpperCase();
      const name  = entry.trdnm ?? null;

      for (const inv of entry.inv ?? []) {
        const taxes = sumItems(inv.items);
        records.push({
          supplierGstin: gstin,
          supplierName: name,
          invoiceNumber: (inv.inum ?? "").trim(),
          invoiceDate: parseGSTDate(inv.dt),
          invoiceValue: toMoney(inv.val),
          taxableValue: taxes.txval,
          cgst: taxes.cgst,
          sgst: taxes.sgst,
          igst: taxes.igst,
          cess: taxes.cess,
          itcAvailable: inv.itcavl ?? null,
          reason: null,
          sourceType: section === "b2ba" ? "B2BA" : "B2B",
        });
      }
    }
  }

  // ── CDNR / CDNRA (Credit / Debit Notes Registered) ────────────
  for (const section of ["cdnr", "cdnra"] as const) {
    for (const entry of docdata[section] ?? []) {
      const gstin = (entry.ctin ?? "").trim().toUpperCase();
      const name  = entry.trdnm ?? null;

      for (const nt of entry.nt ?? []) {
        const taxes = sumItems(nt.items);
        records.push({
          supplierGstin: gstin,
          supplierName: name,
          invoiceNumber: (nt.ntnum ?? "").trim(),
          invoiceDate: parseGSTDate(nt.dt),
          invoiceValue: toMoney(nt.val),
          taxableValue: taxes.txval,
          cgst: taxes.cgst,
          sgst: taxes.sgst,
          igst: taxes.igst,
          cess: taxes.cess,
          itcAvailable: nt.itcavl ?? null,
          reason: null,
          sourceType: section === "cdnra" ? "CDNRA" : "CDNR",
        });
      }
    }
  }

  // ── ISD (Input Service Distributor) ──────────────────────────
  for (const entry of docdata.isd ?? []) {
    const gstin = (entry.isd ?? "").trim().toUpperCase();
    const name  = entry.isdnm ?? null;

    for (const doc of entry.doclist ?? []) {
      records.push({
        supplierGstin: gstin,
        supplierName: name,
        invoiceNumber: (doc.docnum ?? "").trim(),
        invoiceDate: parseGSTDate(doc.docdt),
        invoiceValue: toMoney(doc.docval),
        taxableValue: "0.00",
        cgst:  toMoney(doc.cgstisd),
        sgst:  toMoney(doc.sgstisd),
        igst:  toMoney(doc.igstisd),
        cess:  toMoney(doc.igstcess),
        itcAvailable: "Y",
        reason: null,
        sourceType: "ISD",
      });
    }
  }

  return records;
}

// ── CSV Parser ────────────────────────────────────────────────

/**
 * Parses GSTR-2B CSV export. Header row is expected to contain these columns
 * (case-insensitive, trim whitespace):
 *   GSTIN / Supplier GSTIN / Supplier_GSTIN
 *   Trade Name / Supplier Name
 *   Invoice No / Invoice Number
 *   Invoice Date / Invoice_Date
 *   Invoice Value
 *   Taxable Value
 *   CGST
 *   SGST
 *   IGST
 *   Cess (optional)
 *   ITC Eligible / ITC Available (optional)
 */
export function parseGSTR2BCSV(csvContent: string): GSTR2BRecord[] {
  const lines = csvContent.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  // Find the header row (first non-empty line)
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (raw.length > 0) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) throw new Error("CSV file is empty");

  // Detect separator
  const headerLine = lines[headerIdx];
  const sep = headerLine.includes("\t") ? "\t" : ",";

  function parseLine(line: string): string[] {
    const cols: string[] = [];
    let cur = "", inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuote = !inQuote;
      } else if (ch === sep && !inQuote) {
        cols.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    cols.push(cur.trim());
    return cols;
  }

  const headers = parseLine(headerLine).map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, ""));

  function idx(...aliases: string[]): number {
    for (const alias of aliases) {
      const i = headers.indexOf(alias);
      if (i >= 0) return i;
    }
    return -1;
  }

  const COL_GSTIN      = idx("gstin", "supplier_gstin", "ctin");
  const COL_NAME       = idx("trade_name", "supplier_name", "trdnm");
  const COL_INV_NO     = idx("invoice_no", "invoice_number", "inum");
  const COL_INV_DATE   = idx("invoice_date", "dt");
  const COL_INV_VAL    = idx("invoice_value", "val");
  const COL_TAX_VAL    = idx("taxable_value", "taxable_amount", "txval");
  const COL_CGST       = idx("cgst");
  const COL_SGST       = idx("sgst");
  const COL_IGST       = idx("igst");
  const COL_CESS       = idx("cess");
  const COL_ITC        = idx("itc_eligible", "itc_available", "itcavl");

  if (COL_GSTIN < 0 || COL_INV_NO < 0) {
    throw new Error("CSV missing required columns: GSTIN and Invoice No are mandatory");
  }

  const records: GSTR2BRecord[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseLine(line);

    const gstin = (cols[COL_GSTIN] ?? "").trim().toUpperCase();
    const invNo = (cols[COL_INV_NO] ?? "").trim();
    if (!gstin || !invNo) continue;

    records.push({
      supplierGstin: gstin,
      supplierName: COL_NAME >= 0 ? (cols[COL_NAME] ?? null) : null,
      invoiceNumber: invNo,
      invoiceDate: parseGSTDate(COL_INV_DATE >= 0 ? cols[COL_INV_DATE] : null),
      invoiceValue: toMoney(COL_INV_VAL >= 0 ? cols[COL_INV_VAL] : "0"),
      taxableValue: toMoney(COL_TAX_VAL >= 0 ? cols[COL_TAX_VAL] : "0"),
      cgst: toMoney(COL_CGST >= 0 ? cols[COL_CGST] : "0"),
      sgst: toMoney(COL_SGST >= 0 ? cols[COL_SGST] : "0"),
      igst: toMoney(COL_IGST >= 0 ? cols[COL_IGST] : "0"),
      cess: toMoney(COL_CESS >= 0 ? cols[COL_CESS] : "0"),
      itcAvailable: COL_ITC >= 0 ? ((cols[COL_ITC] ?? "").toUpperCase() || null) : null,
      reason: null,
      sourceType: "B2B",
    });
  }

  return records;
}

// ── Reconciliation Engine ─────────────────────────────────────

const AMOUNT_TOLERANCE = 1.01;   // ₹1.01 tolerance for rounding differences
const DATE_TOLERANCE_DAYS = 3;   // ±3 days for invoice date matching

function amountsMatch(a: string, b: string): boolean {
  return Math.abs(parseFloat(a) - parseFloat(b)) <= AMOUNT_TOLERANCE;
}

/**
 * Reconcile 2B records against our own purchase invoices.
 *
 * Returns:
 *   results — ReconciliationResult[] for every 2B record
 *   missingIn2B — PurchaseInvoice[] that are in our books but not found in 2B
 */
export function reconcileWithBooks(
  records: GSTR2BRecord[],
  purchaseInvoices: PurchaseInvoice[],
): {
  results: ReconciliationResult[];
  missingIn2B: PurchaseInvoice[];
} {
  // Build a lookup: normalised GSTIN → invoices from our books
  const byGstin = new Map<string, PurchaseInvoice[]>();
  for (const inv of purchaseInvoices) {
    if (!inv.partyGstin) continue;
    const key = inv.partyGstin.trim().toUpperCase();
    if (!byGstin.has(key)) byGstin.set(key, []);
    byGstin.get(key)!.push(inv);
  }

  const matchedInvoiceIds = new Set<string>();
  const results: ReconciliationResult[] = [];

  for (const rec of records) {
    const candidates = byGstin.get(rec.supplierGstin) ?? [];

    // Step 1: find by GSTIN + invoice number
    let matched = candidates.filter(
      (c) => c.invoiceNumber.trim().toUpperCase() === rec.invoiceNumber.trim().toUpperCase(),
    );

    // Step 2: narrow by date ±3 days
    if (matched.length > 1 && rec.invoiceDate) {
      const byDate = matched.filter(
        (c) => daysDiff(c.invoiceDate, rec.invoiceDate!) <= DATE_TOLERANCE_DAYS,
      );
      if (byDate.length > 0) matched = byDate;
    }

    if (matched.length === 0) {
      results.push({
        record: rec,
        matchStatus: "missing_in_books",
        matchedInvoiceId: null,
        mismatchReasons: [],
      });
      continue;
    }

    // Pick the closest date match
    const inv = rec.invoiceDate
      ? matched.reduce((best, cur) =>
          daysDiff(cur.invoiceDate, rec.invoiceDate!) < daysDiff(best.invoiceDate, rec.invoiceDate!)
            ? cur
            : best,
        )
      : matched[0];

    matchedInvoiceIds.add(inv.id);

    // Compare amounts
    const mismatchReasons: string[] = [];

    if (!amountsMatch(rec.taxableValue, inv.subtotal)) {
      mismatchReasons.push("taxable_value_difference");
    }
    if (!amountsMatch(rec.cgst, inv.cgst)) {
      mismatchReasons.push("cgst_difference");
    }
    if (!amountsMatch(rec.sgst, inv.sgst)) {
      mismatchReasons.push("sgst_difference");
    }
    if (!amountsMatch(rec.igst, inv.igst)) {
      mismatchReasons.push("igst_difference");
    }
    if (rec.invoiceDate && daysDiff(rec.invoiceDate, inv.invoiceDate) > DATE_TOLERANCE_DAYS) {
      mismatchReasons.push("date_difference");
    }

    results.push({
      record: rec,
      matchStatus: mismatchReasons.length === 0 ? "matched" : "mismatched",
      matchedInvoiceId: inv.id,
      mismatchReasons,
    });
  }

  // Invoices in our books but not in any 2B record
  const missingIn2B = purchaseInvoices.filter((inv) => {
    if (!inv.partyGstin) return false; // no GSTIN — can't appear in 2B
    return !matchedInvoiceIds.has(inv.id);
  });

  return { results, missingIn2B };
}
