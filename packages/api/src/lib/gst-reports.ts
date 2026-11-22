import { eq, and, sql, inArray, isNull } from "drizzle-orm";
import { invoices, invoiceItems, parties, businesses, items as itemsTable } from "@hisaabo/db";
import type { TenantDatabase } from "@hisaabo/db";
import { csvCell, csvRow, money, splitDocumentGst, BUSINESS_TIME_ZONE } from "@hisaabo/shared";
import { buildBusinessDateFilter } from "./business-date.js";
import { gstMonthWindow } from "./gst-period.js";
import { classifyLedgerDocument } from "./ledger-documents.js";
import { documentGstSplit, isIntraStateSupply, loadLineGstSplits } from "./gst-split.js";

// ── Types ──────────────────────────────────────────────────────

/**
 * A credit / debit note line of GSTR-1. `taxAmount` is the document's GST;
 * `cgst`, `sgst` and `igst` are its split by head (intra-state: CGST + SGST via
 * `money.splitHalf`, inter-state: IGST), the same split the ledger posts.
 */
export interface GSTR1Note {
  invoiceNumber: string;
  originalInvoiceNumber?: string;
  invoiceDate: string;
  partyName: string;
  partyGstin: string;
  totalAmount: string;
  taxableAmount: string;
  taxAmount: string;
  cgst: number;
  sgst: number;
  igst: number;
}

/** One sale line that has no HSN code (`itemId` is null for a line typed in without an item). */
export interface GSTR1HsnMissingLine {
  invoiceNumber: string;
  /** 1-based line number on the invoice */
  line: number;
  itemName: string;
  itemId: string | null;
}

export interface GSTR1Report {
  period: string; // e.g. "Apr 2025"
  businessGstin: string;
  businessName: string;
  // B2B - outward supplies to registered persons
  b2b: Array<{
    partyGstin: string;
    partyName: string;
    invoiceNumber: string;
    invoiceDate: string;
    invoiceType: string; // "Regular" | "SEZ" etc
    taxableValue: number;
    cgst: number;
    sgst: number;
    igst: number;
    totalInvoiceValue: number;
  }>;
  // B2C Large - to unregistered (> ₹2.5L inter-state)
  b2cLarge: Array<{
    state: string;
    taxableValue: number;
    cgst: number;
    sgst: number;
    igst: number;
  }>;
  // B2C Small - to unregistered (≤ ₹2.5L or intra-state)
  b2cSmall: Array<{
    taxRate: number;
    taxableValue: number;
    cgst: number;
    sgst: number;
    igst: number;
  }>;
  // HSN summary (Table 12): one row per (HSN, UQC, GST rate). The same HSN sold at 5% and at 18%
  // is two rows, and quantities in different units are never added together.
  hsn: Array<{
    hsn: string;
    description: string;
    /** UQC (unit quantity code) of the unit `quantity` is in, e.g. "KGS", "NOS" */
    uqc: string;
    /** GST rate of the lines in this row, in percent, e.g. 18 */
    taxRate: number;
    quantity: number;
    taxableValue: number;
    cgst: number;
    sgst: number;
    igst: number;
    totalValue: number;
  }>;
  // Sale lines with no HSN code (a typed-in line, or an item that has none). Table 12 files them
  // under "0000", which is not a real code: the portal JSON export is refused while this list is
  // not empty, and the CSV flags them. Fix the item (or the line) first.
  hsnMissing: GSTR1HsnMissingLine[];
  // Credit Notes (sales returns / adjustments reducing output tax)
  creditNotes: GSTR1Note[];
  // Debit Notes (sale-side: additional charges to the buyer, increasing output tax)
  debitNotes: GSTR1Note[];
  // Totals
  totalTaxableValue: number;
  totalCgst: number;
  totalSgst: number;
  totalIgst: number;
  totalTax: number;
  totalInvoiceValue: number;
  invoiceCount: number;
}

export interface GSTR3BReport {
  period: string;
  businessGstin: string;
  businessName: string;
  // 3.1 - Outward supplies
  outwardSupplies: {
    taxable: { taxableValue: number; igst: number; cgst: number; sgst: number };
    zeroRated: { taxableValue: number; igst: number; cgst: number; sgst: number };
    exempt: { taxableValue: number; igst: number; cgst: number; sgst: number };
  };
  // 3.1(d) - Inward supplies liable to reverse charge
  rcmSupplies: { taxableValue: string; cgst: string; sgst: string; igst: string };
  // 3.2 - Inter-state supplies to unregistered
  interStateUnregistered: Array<{
    state: string;
    taxableValue: number;
    igst: number;
  }>;
  // 4 - Eligible ITC (from purchases)
  itc: {
    igst: number;
    cgst: number;
    sgst: number;
    total: number;
  };
  // 5 - Tax payable
  taxPayable: {
    igst: number;
    cgst: number;
    sgst: number;
  };
  // Net tax (after ITC)
  netTax: {
    igst: number;
    cgst: number;
    sgst: number;
    total: number;
  };
}

// ── Table 12 helpers ───────────────────────────────────────────

/** Key of one Table 12 row: the same HSN at another rate, or in another unit, is another row. */
function hsnRowKey(hsn: string, uqc: string, taxRate: number): string {
  return `${hsn}|${uqc}|${taxRate}`;
}

/** A stored quantity ("12.500", at most 3 decimals) as integer thousandths, by digits. */
function quantityToMilli(quantity: string): bigint {
  const m = /^(-?)(\d+)(?:\.(\d*))?$/.exec(quantity.trim());
  if (!m) return 0n;
  const milli = BigInt(m[2]! + (m[3] ?? "").padEnd(3, "0").slice(0, 3));
  return m[1] ? -milli : milli;
}

// ── Generator ──────────────────────────────────────────────────

export async function generateGSTR1(
  businessId: string,
  year: number,
  month: number, // 1-12
  db: TenantDatabase
): Promise<GSTR1Report> {
  // The calendar month on the IST business calendar, half-open (see gst-period.ts).
  const { from: startDate, before: endBefore } = gstMonthWindow(year, month);

  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);

  // Get all sale invoices for the period with their items and parties
  const saleInvoices = await db.select({
    id: invoices.id,
    invoiceNumber: invoices.invoiceNumber,
    invoiceDate: invoices.invoiceDate,
    totalAmount: invoices.totalAmount,
    subtotal: invoices.subtotal,
    taxAmount: invoices.taxAmount,
    partyName: parties.name,
    partyGstin: parties.gstin,
    partyState: parties.state,
    partyStateCode: parties.stateCode,
  }).from(invoices)
    .innerJoin(parties, eq(parties.id, invoices.partyId))
    .where(and(
      eq(invoices.businessId, businessId),
      eq(invoices.type, "sale"),
      eq(invoices.documentType, "invoice"),
      sql`${invoices.status} != 'cancelled'`,
      isNull(invoices.deletedAt),
      ...buildBusinessDateFilter(invoices, { from: startDate, before: endBefore }),
    ))
    .orderBy(invoices.invoiceDate);

  // Get line items for all these invoices
  const allInvoiceIds = saleInvoices.map((inv) => inv.id);
  const allLineItems = allInvoiceIds.length > 0
    ? await db.select().from(invoiceItems).where(inArray(invoiceItems.invoiceId, allInvoiceIds))
    : [];

  const lineItemsByInvoice = new Map<string, typeof allLineItems>();
  for (const li of allLineItems) {
    const existing = lineItemsByInvoice.get(li.invoiceId) || [];
    existing.push(li);
    lineItemsByInvoice.set(li.invoiceId, existing);
  }

  // Pre-fetch HSN codes for all items referenced in these line items.
  //
  // Historical join — GSTR-1 aggregates taxable value per HSN across all
  // invoices in the period. Soft-deleted items must still contribute
  // their HSN (otherwise the HSN summary drops rows for items the user
  // deleted between filing periods). Do NOT filter `itemsTable.deletedAt`.
  const allItemIds = new Set<string>();
  for (const li of allLineItems) {
    if (li.itemId) allItemIds.add(li.itemId);
  }
  //
  // The HSN is the item's CURRENT one: invoice lines carry no HSN snapshot until 0.11.0, so
  // editing an item's HSN also moves its past invoices in this summary.
  const itemHsnData = allItemIds.size > 0
    ? await db.select({ id: itemsTable.id, hsn: itemsTable.hsn, unit: itemsTable.unit })
        .from(itemsTable)
        .where(inArray(itemsTable.id, [...allItemIds]))
    : [];
  const itemHsnLookup = new Map(itemHsnData.map((i) => [i.id, i.hsn?.trim() || ""]));
  const itemUnitLookup = new Map(itemHsnData.map((i) => [i.id, i.unit as string | null]));

  // Fix 3: State comparison using stateCode (preferred) with text fallback
  const isSameState = (partyState: string | null, partyStateCode: string | null) =>
    isIntraStateSupply(biz, { state: partyState, stateCode: partyStateCode });

  // All money below is accumulated as decimal strings (integer paise) and only
  // converted to the JS numbers of the report types when the rows are emitted.
  // CGST / SGST are split LINE BY LINE with `money.splitHalf` (the e-invoice rule, see
  // gst-split.ts) and every section adds those line splits up, so the B2B rows, the B2CS
  // rows, the HSN rows and the totals all tie to the same figures, and CGST + SGST always
  // equals the tax they came from.
  const b2b: GSTR1Report["b2b"] = [];
  const b2cLargeMap = new Map<string, { state: string; taxable: string; igst: string }>();
  const b2cSmallMap = new Map<number, {
    taxRate: number; taxable: string; cgst: string; sgst: string; igst: string;
  }>();
  // Table 12 rows keyed by HSN + UQC + GST rate (see `hsnRowKey`); the quantity is summed in
  // integer thousandths (stored quantities have three decimals), never as JS floats.
  const hsnMissing: GSTR1HsnMissingLine[] = [];
  const hsnSummaryMap = new Map<string, {
    hsn: string; description: string; uqc: string; taxRate: number; quantityMilli: bigint;
    taxable: string; totalValue: string; cgst: string; sgst: string; igst: string;
  }>();
  /** One line's tax as [cgst, sgst, igst]: split in half (odd paisa to CGST) intra-state, IGST otherwise. */
  const lineTaxHeads = (itemTax: string, sameState: boolean): [string, string, string] => {
    if (!sameState) return ["0.00", "0.00", itemTax];
    const [cgst, sgst] = money.splitHalf(itemTax);
    return [cgst, sgst, "0.00"];
  };

  let totalTaxableValue = "0.00";
  let totalCgst = "0.00";
  let totalSgst = "0.00";
  let totalIgst = "0.00";
  let totalInvoiceValue = "0.00";

  for (const inv of saleInvoices) {
    const lineItems = lineItemsByInvoice.get(inv.id) || [];
    const sameState = isSameState(inv.partyState, inv.partyStateCode);
    const taxable = money.add(inv.subtotal, "0");
    const tax = money.add(inv.taxAmount, "0");
    const total = money.add(inv.totalAmount, "0");

    const [cgst, sgst] = sameState
      ? splitDocumentGst(tax, lineItems.map((li) => li.taxAmount))
      : ["0.00", "0.00"];
    const igst = sameState ? "0.00" : tax;

    totalTaxableValue = money.add(totalTaxableValue, taxable);
    totalCgst = money.add(totalCgst, cgst);
    totalSgst = money.add(totalSgst, sgst);
    totalIgst = money.add(totalIgst, igst);
    totalInvoiceValue = money.add(totalInvoiceValue, total);

    // B2B: party has GSTIN
    if (inv.partyGstin) {
      b2b.push({
        partyGstin: inv.partyGstin,
        partyName: inv.partyName,
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate.toISOString(),
        invoiceType: "Regular",
        taxableValue: money.toNumber(taxable),
        cgst: money.toNumber(cgst),
        sgst: money.toNumber(sgst),
        igst: money.toNumber(igst),
        totalInvoiceValue: money.toNumber(total),
      });
    } else if (!sameState && money.toNumber(total) > 250000) {
      // B2C Large: inter-state > ₹2.5L
      const state = inv.partyState || "Unknown";
      const existing = b2cLargeMap.get(state) || { state, taxable: "0.00", igst: "0.00" };
      existing.taxable = money.add(existing.taxable, taxable);
      existing.igst = money.add(existing.igst, igst);
      b2cLargeMap.set(state, existing);
    } else {
      // B2C Small
      for (const li of lineItems) {
        const rate = parseFloat(li.taxPercent);
        const existing = b2cSmallMap.get(rate) || { taxRate: rate, taxable: "0.00", cgst: "0.00", sgst: "0.00", igst: "0.00" };
        const itemTax = money.add(li.taxAmount, "0");
        const [lCgst, lSgst, lIgst] = lineTaxHeads(itemTax, !!sameState);
        existing.taxable = money.add(existing.taxable, money.sub(li.totalAmount, itemTax));
        existing.cgst = money.add(existing.cgst, lCgst);
        existing.sgst = money.add(existing.sgst, lSgst);
        existing.igst = money.add(existing.igst, lIgst);
        b2cSmallMap.set(rate, existing);
      }
    }

    // Table 12 (HSN summary): the item's HSN, the unit the quantity is in, and the GST rate.
    for (const [lineIdx, li] of lineItems.entries()) {
      const realHsn = li.itemId ? (itemHsnLookup.get(li.itemId) || "") : "";
      if (!realHsn) {
        hsnMissing.push({ invoiceNumber: inv.invoiceNumber, line: (li.sortOrder ?? lineIdx) + 1, itemName: li.itemName, itemId: li.itemId ?? null });
      }
      // "0000" stands in for a missing HSN so the totals still tie; see `hsnMissing`
      const itemHsn = realHsn || "0000";
      // The quantity is in the unit the line was billed in (the base unit when none was chosen).
      const uqc = toUqc(li.selectedUnit ?? (li.itemId ? itemUnitLookup.get(li.itemId) : null));
      const taxRate = parseFloat(li.taxPercent);
      const key = hsnRowKey(itemHsn, uqc, taxRate);
      const existing = hsnSummaryMap.get(key) || {
        // HSN summary description is a human-readable label for the HSN
        // group — use itemName (required snapshot), not the optional notes
        // column.
        hsn: itemHsn, description: li.itemName, uqc, taxRate, quantityMilli: 0n,
        taxable: "0.00", totalValue: "0.00", cgst: "0.00", sgst: "0.00", igst: "0.00",
      };
      const itemTax = money.add(li.taxAmount, "0");
      const [lCgst, lSgst, lIgst] = lineTaxHeads(itemTax, !!sameState);
      existing.quantityMilli += quantityToMilli(li.quantity);
      existing.taxable = money.add(existing.taxable, money.sub(li.totalAmount, itemTax));
      existing.totalValue = money.add(existing.totalValue, li.totalAmount);
      existing.cgst = money.add(existing.cgst, lCgst);
      existing.sgst = money.add(existing.sgst, lSgst);
      existing.igst = money.add(existing.igst, lIgst);
      hsnSummaryMap.set(key, existing);
    }
  }

  // Credit and debit notes of the period. GSTR-1 reports OUTWARD supplies, so only SALE-side
  // documents belong here, and the side is decided by `classifyLedgerDocument` (the rule the
  // ledger uses): a credit note or sales return created from a PURCHASE invoice has
  // type = "purchase", reverses that purchase and reduces input credit (GSTR-3B Table 4), so it
  // is not an outward credit note. A purchase-side debit note / purchase return is a document we
  // issue to a supplier, likewise not an outward supply.
  const noteConditions = [
    eq(invoices.type, "sale"),
    inArray(invoices.documentType, ["credit_note", "sales_return", "debit_note"]),
    sql`${invoices.status} != 'cancelled'`,
    isNull(invoices.deletedAt),
    ...buildBusinessDateFilter(invoices, { from: startDate, before: endBefore }),
  ];
  const rawNotes = await db.select({
    id: invoices.id,
    documentType: invoices.documentType,
    type: invoices.type,
    invoiceNumber: invoices.invoiceNumber,
    invoiceDate: invoices.invoiceDate,
    totalAmount: invoices.totalAmount,
    subtotal: invoices.subtotal,
    taxAmount: invoices.taxAmount,
    referenceDocumentId: invoices.referenceDocumentId,
    partyName: parties.name,
    partyGstin: parties.gstin,
    partyState: parties.state,
    partyStateCode: parties.stateCode,
  }).from(invoices)
    .innerJoin(parties, eq(parties.id, invoices.partyId))
    .where(and(eq(invoices.businessId, businessId), ...noteConditions))
    .orderBy(invoices.invoiceDate);

  const rawCreditNotes = rawNotes.filter((n) => {
    const cls = classifyLedgerDocument(n.documentType, n.type);
    return cls?.side === "sale" && cls.kind === "reversal";
  });
  const rawDebitNotes = rawNotes.filter((n) => {
    const cls = classifyLedgerDocument(n.documentType, n.type);
    return cls?.side === "sale" && cls.kind === "addition";
  });

  // Resolve original invoice numbers for credit/debit notes that reference an invoice
  const noteRefIds = [
    ...rawCreditNotes.map((n) => n.referenceDocumentId),
    ...rawDebitNotes.map((n) => n.referenceDocumentId),
  ].filter((id): id is string => id !== null && id !== undefined);

  const refInvoiceNumbers = noteRefIds.length > 0
    ? await db.select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber })
        .from(invoices)
        .where(inArray(invoices.id, noteRefIds))
    : [];
  const refInvoiceMap = new Map(refInvoiceNumbers.map((r) => [r.id, r.invoiceNumber]));

  // Per-line CGST / SGST sums of the notes (the e-invoice rule, see gst-split.ts), selected by the
  // report's own business / period conditions (an id list would not survive a large month).
  const noteLineSplits = rawNotes.length > 0
    ? await loadLineGstSplits(db, businessId, noteConditions)
    : new Map();

  const toNote = (n: (typeof rawCreditNotes)[number]): GSTR1Note => {
    const tax = money.add(n.taxAmount, "0");
    const sameState = isSameState(n.partyState, n.partyStateCode);
    const [cgst, sgst] = sameState ? documentGstSplit(tax, noteLineSplits.get(n.id)) : ["0.00", "0.00"];
    return {
      invoiceNumber: n.invoiceNumber,
      originalInvoiceNumber: n.referenceDocumentId ? refInvoiceMap.get(n.referenceDocumentId) : undefined,
      invoiceDate: n.invoiceDate.toISOString(),
      partyName: n.partyName,
      partyGstin: n.partyGstin || "",
      totalAmount: n.totalAmount,
      taxableAmount: n.subtotal,
      taxAmount: n.taxAmount,
      cgst: money.toNumber(cgst),
      sgst: money.toNumber(sgst),
      igst: sameState ? 0 : money.toNumber(tax),
    };
  };
  const creditNotes: GSTR1Note[] = rawCreditNotes.map(toNote);
  const debitNotes: GSTR1Note[] = rawDebitNotes.map(toNote);

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  return {
    period: `${monthNames[month - 1]} ${year}`,
    businessGstin: biz?.gstin || "",
    businessName: biz?.name || "",
    b2b,
    b2cLarge: Array.from(b2cLargeMap.values()).map((e) => ({
      state: e.state,
      taxableValue: money.toNumber(e.taxable),
      cgst: 0,
      sgst: 0,
      igst: money.toNumber(e.igst),
    })),
    b2cSmall: Array.from(b2cSmallMap.values()).map((e) => ({
      taxRate: e.taxRate,
      taxableValue: money.toNumber(e.taxable),
      cgst: money.toNumber(e.cgst),
      sgst: money.toNumber(e.sgst),
      igst: money.toNumber(e.igst),
    })),
    hsn: Array.from(hsnSummaryMap.values())
      .sort((a, b) => a.hsn.localeCompare(b.hsn) || a.taxRate - b.taxRate || a.uqc.localeCompare(b.uqc))
      .map((e) => ({
      hsn: e.hsn,
      description: e.description,
      uqc: e.uqc,
      taxRate: e.taxRate,
      quantity: Number(e.quantityMilli) / 1000,
      taxableValue: money.toNumber(e.taxable),
      cgst: money.toNumber(e.cgst),
      sgst: money.toNumber(e.sgst),
      igst: money.toNumber(e.igst),
      totalValue: money.toNumber(e.totalValue),
    })),
    hsnMissing,
    creditNotes,
    debitNotes,
    totalTaxableValue: money.toNumber(totalTaxableValue),
    totalCgst: money.toNumber(totalCgst),
    totalSgst: money.toNumber(totalSgst),
    totalIgst: money.toNumber(totalIgst),
    totalTax: money.toNumber(money.sum([totalCgst, totalSgst, totalIgst])),
    totalInvoiceValue: money.toNumber(totalInvoiceValue),
    invoiceCount: saleInvoices.length,
  };
}

export async function generateGSTR3B(
  businessId: string,
  year: number,
  month: number,
  db: TenantDatabase,
  // Optional precomputed GSTR-1 for the same business/period (avoids recomputing it)
  precomputedGstr1?: GSTR1Report,
): Promise<GSTR3BReport> {
  const gstr1 = precomputedGstr1 ?? await generateGSTR1(businessId, year, month, db);

  // Get purchase invoices for ITC
  // The calendar month on the IST business calendar, half-open (see gst-period.ts).
  const { from: startDate, before: endBefore } = gstMonthWindow(year, month);

  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);

  // Purchase-side documents of the period. The documentType filter matters: without it
  // purchase returns and purchase-side debit notes were summed like invoices and ADDED to
  // the input credit. Which documents are purchase-side, and which of them reverse a
  // purchase, is decided by `classifyLedgerDocument`, the same rule the ledger uses: that
  // includes a credit note or sales return raised from a PURCHASE invoice (type = "purchase"),
  // which takes input credit back like a purchase return. Only invoices and these reversals
  // count; quotations, proformas and challans never reach ITC.
  const purchaseConditions = [
    inArray(invoices.documentType, ["invoice", "debit_note", "credit_note", "sales_return", "purchase_return"]),
    sql`${invoices.status} != 'cancelled'`,
    isNull(invoices.deletedAt),
    ...buildBusinessDateFilter(invoices, { from: startDate, before: endBefore }),
  ];
  const purchaseDocs = await db.select({
    id: invoices.id,
    documentType: invoices.documentType,
    type: invoices.type,
    taxAmount: invoices.taxAmount,
    subtotal: invoices.subtotal,
    partyState: parties.state,
    partyStateCode: parties.stateCode,
    isReverseCharge: invoices.isReverseCharge,
  }).from(invoices)
    .innerJoin(parties, eq(parties.id, invoices.partyId))
    .where(and(eq(invoices.businessId, businessId), ...purchaseConditions));

  let itcIgst = "0.00", itcCgst = "0.00", itcSgst = "0.00";

  // RCM accumulators: Table 3.1(d) — inward supplies liable to reverse charge
  let rcmTaxableValue = "0.00", rcmCgst = "0.00", rcmSgst = "0.00", rcmIgst = "0.00";

  // Per-line CGST / SGST sums of the purchase-side documents (the e-invoice rule, see gst-split.ts).
  const purchaseLineSplits = purchaseDocs.length > 0
    ? await loadLineGstSplits(db, businessId, purchaseConditions)
    : new Map();

  for (const inv of purchaseDocs) {
    const cls = classifyLedgerDocument(inv.documentType, inv.type);
    if (cls?.side !== "purchase") continue; // a sale-side document that shares the documentType
    // A purchase return / purchase-side debit note takes input credit back; an invoice adds it.
    const apply = (acc: string, amount: string) =>
      cls.kind === "reversal" ? money.sub(acc, amount) : money.add(acc, amount);

    const tax = money.add(inv.taxAmount, "0");
    const sameState = isIntraStateSupply(biz, { state: inv.partyState, stateCode: inv.partyStateCode });
    const [cgst, sgst] = sameState ? documentGstSplit(tax, purchaseLineSplits.get(inv.id)) : ["0.00", "0.00"];
    const igst = sameState ? "0.00" : tax;

    if (inv.isReverseCharge) {
      // RCM purchases: tracked in 3.1(d) AND generate ITC for the buyer
      rcmTaxableValue = apply(rcmTaxableValue, inv.subtotal);
      rcmCgst = apply(rcmCgst, cgst);
      rcmSgst = apply(rcmSgst, sgst);
      rcmIgst = apply(rcmIgst, igst);
    }
    // Normal and RCM purchases alike carry their GST as input credit
    itcCgst = apply(itcCgst, cgst);
    itcSgst = apply(itcSgst, sgst);
    itcIgst = apply(itcIgst, igst);
  }

  // Output tax (Table 3.1(a)) is NET of the period's credit notes and sales
  // returns and includes its sale-side debit notes, exactly as the ledger's
  // Output GST accounts do (credit notes debit them, debit notes credit them).
  // GSTR-1 lists the invoices gross and the notes separately; 3B reports the net.
  const sumNotes = (notes: GSTR1Note[], pick: (n: GSTR1Note) => string | number) =>
    money.sum(notes.map(pick));
  const netOfNotes = (invoicesTotal: string | number, pick: (n: GSTR1Note) => string | number) =>
    money.add(
      money.sub(invoicesTotal, sumNotes(gstr1.creditNotes, pick)),
      sumNotes(gstr1.debitNotes, pick),
    );
  const outTaxable = netOfNotes(gstr1.totalTaxableValue, (n) => n.taxableAmount);
  const outCgst = netOfNotes(gstr1.totalCgst, (n) => n.cgst);
  const outSgst = netOfNotes(gstr1.totalSgst, (n) => n.sgst);
  const outIgst = netOfNotes(gstr1.totalIgst, (n) => n.igst);

  // Net tax payable = output tax - ITC
  // A negative value indicates ITC credit remaining (e.g. when purchase tax
  // exceeds sales tax for a component). This is correct per GST rules —
  // the excess credit carries forward. Do NOT clamp to zero.
  const netIgst = money.sub(outIgst, itcIgst);
  const netCgst = money.sub(outCgst, itcCgst);
  const netSgst = money.sub(outSgst, itcSgst);

  return {
    period: gstr1.period,
    businessGstin: gstr1.businessGstin,
    businessName: gstr1.businessName,
    outwardSupplies: {
      taxable: {
        taxableValue: money.toNumber(outTaxable),
        igst: money.toNumber(outIgst),
        cgst: money.toNumber(outCgst),
        sgst: money.toNumber(outSgst),
      },
      zeroRated: { taxableValue: 0, igst: 0, cgst: 0, sgst: 0 },
      exempt: { taxableValue: 0, igst: 0, cgst: 0, sgst: 0 },
    },
    rcmSupplies: {
      taxableValue: rcmTaxableValue,
      cgst: rcmCgst,
      sgst: rcmSgst,
      igst: rcmIgst,
    },
    interStateUnregistered: gstr1.b2cLarge.map((e) => ({
      state: e.state, taxableValue: e.taxableValue, igst: e.igst,
    })),
    itc: {
      igst: money.toNumber(itcIgst),
      cgst: money.toNumber(itcCgst),
      sgst: money.toNumber(itcSgst),
      total: money.toNumber(money.sum([itcIgst, itcCgst, itcSgst])),
    },
    taxPayable: {
      igst: money.toNumber(outIgst),
      cgst: money.toNumber(outCgst),
      sgst: money.toNumber(outSgst),
    },
    netTax: {
      igst: money.toNumber(netIgst),
      cgst: money.toNumber(netCgst),
      sgst: money.toNumber(netSgst),
      total: money.toNumber(money.sum([netIgst, netCgst, netSgst])),
    },
  };
}

// ── Portal JSON Export ─────────────────────────────────────────

// GST state code lookup by state name (case-insensitive)
const GST_STATE_CODE_MAP: Record<string, string> = {
  "jammu and kashmir": "01", "himachal pradesh": "02", "punjab": "03",
  "chandigarh": "04", "uttarakhand": "05", "haryana": "06", "delhi": "07",
  "rajasthan": "08", "uttar pradesh": "09", "bihar": "10", "sikkim": "11",
  "arunachal pradesh": "12", "nagaland": "13", "manipur": "14",
  "mizoram": "15", "tripura": "16", "meghalaya": "17", "assam": "18",
  "west bengal": "19", "jharkhand": "20", "odisha": "21",
  "chhattisgarh": "22", "madhya pradesh": "23", "gujarat": "24",
  "dadra and nagar haveli and daman and diu": "26", "maharashtra": "27",
  "andhra pradesh": "28", "karnataka": "29", "goa": "30", "lakshadweep": "31",
  "kerala": "32", "tamil nadu": "33", "puducherry": "34",
  "andaman and nicobar islands": "35", "telangana": "36",
  "andhra pradesh (new)": "37", "ladakh": "38",
};

function stateNameToCode(state: string): string {
  return GST_STATE_CODE_MAP[state.toLowerCase()] ?? "99";
}

// UQC (Unit Quantity Code) mapping — GST portal codes
const UQC_MAP: Record<string, string> = {
  // Hisaabo's own unit keys (the `units` list in @hisaabo/shared). The GST UQC list has no
  // code for inches, jars or pouches, so those are "OTH" (others).
  "g": "GMS", "l": "LTR", "m": "MTR", "cm": "CMS", "ft": "FTS", "in": "OTH",
  "pair": "PRS", "pkt": "PAC", "bun": "BUN", "pouch": "OTH", "jar": "OTH",
  "btl": "BTL", "pet": "NOS", "person": "NOS", "other": "OTH",
  "pcs": "NOS", "nos": "NOS", "piece": "NOS", "pieces": "NOS",
  "unit": "NOS", "units": "NOS", "number": "NOS",
  "kg": "KGS", "kgs": "KGS", "kilogram": "KGS", "kilograms": "KGS",
  "gm": "GMS", "gms": "GMS", "gram": "GMS", "grams": "GMS",
  "ltr": "LTR", "lts": "LTR", "litre": "LTR", "litres": "LTR", "liter": "LTR",
  "mtr": "MTR", "meter": "MTR", "meters": "MTR", "metre": "MTR",
  "sqm": "SQM", "sqmtr": "SQM",
  "sqf": "SQF", "sqft": "SQF",
  "cbm": "CBM",
  "doz": "DOZ", "dozen": "DOZ",
  "box": "BOX", "boxes": "BOX",
  "bag": "BAG", "bags": "BAG",
  "set": "SET", "sets": "SET",
  "pk": "PAC", "pac": "PAC", "pack": "PAC", "packs": "PAC",
  "rol": "ROL", "roll": "ROL", "rolls": "ROL",
  "tub": "TUB", "tube": "TUB",
  "ton": "TON", "tonne": "TON", "tonnes": "TON",
  "mlt": "MLT", "ml": "MLT", "millilitre": "MLT", "milliliter": "MLT",
};

export function toUqc(unit?: string | null): string {
  if (!unit) return "NOS";
  return UQC_MAP[unit.toLowerCase()] ?? "NOS";
}

/** Convert ISO date string "YYYY-MM-DDTXX:XX:XX..." to portal "DD-MM-YYYY" */
function isoToPortalDate(isoDate: string): string {
  const datePart = isoDate.split("T")[0];
  const [year, month, day] = datePart.split("-");
  return `${day}-${month}-${year}`;
}

/**
 * Transforms a GSTR1Report into the JSON schema required by the GST portal's
 * offline tool. The returned object can be serialised to JSON and uploaded
 * directly to the portal.
 *
 * @param report        - Internal GSTR1Report from generateGSTR1()
 * @param gstin         - Business GSTIN
 * @param _financialYear - e.g. "2025-26" (reserved for future portal schema versions)
 * @param taxPeriod     - Filing period in MMYYYY format, e.g. "082025"
 */
export function gstr1ToPortalJson(
  report: GSTR1Report,
  gstin: string,
  _financialYear: string,
  taxPeriod: string,
): Record<string, unknown> {
  // B2B: group invoices by recipient GSTIN
  const b2bMap = new Map<string, { ctin: string; inv: Array<Record<string, unknown>> }>();

  for (const inv of report.b2b) {
    const ctin = inv.partyGstin;
    const existing = b2bMap.get(ctin) ?? { ctin, inv: [] };
    existing.inv.push({
      inum: inv.invoiceNumber,
      idt: isoToPortalDate(inv.invoiceDate),
      val: inv.totalInvoiceValue,
      pos: ctin.substring(0, 2),
      rchrg: "N",
      inv_typ: "R",
      itms: [
        {
          num: 1,
          itm_det: {
            txval: inv.taxableValue,
            rt: 0,
            iamt: inv.igst,
            camt: inv.cgst,
            samt: inv.sgst,
            csamt: 0,
          },
        },
      ],
    });
    b2bMap.set(ctin, existing);
  }

  // B2CL: group by state code
  const b2clMap = new Map<string, { pos: string; inv: Array<Record<string, unknown>> }>();

  for (const entry of report.b2cLarge) {
    const pos = stateNameToCode(entry.state);
    const existing = b2clMap.get(pos) ?? { pos, inv: [] };
    existing.inv.push({
      txval: entry.taxableValue,
      iamt: entry.igst,
      csamt: 0,
    });
    b2clMap.set(pos, existing);
  }

  // B2CS: determine INTRA vs INTER from presence of CGST
  const b2cs = report.b2cSmall.map((entry) => ({
    sply_ty: entry.cgst > 0 ? "INTRA" : "INTER",
    pos: gstin.substring(0, 2),
    typ: "OE",
    txval: entry.taxableValue,
    rt: entry.taxRate,
    camt: entry.cgst,
    samt: entry.sgst,
    iamt: entry.igst,
    csamt: 0,
  }));

  // CDNR: group credit and debit notes by recipient GSTIN
  const cdnrMap = new Map<string, { ctin: string; nt: Array<Record<string, unknown>> }>();

  const pushNote = (note: GSTR1Report["creditNotes"][0], ntty: "C" | "D") => {
    const ctin = note.partyGstin;
    const existing = cdnrMap.get(ctin) ?? { ctin, nt: [] };
    existing.nt.push({
      ntty,
      nt_num: note.invoiceNumber,
      nt_dt: isoToPortalDate(note.invoiceDate),
      val: parseFloat(note.totalAmount),
      pos: ctin.substring(0, 2),
      rchrg: "N",
      inv_typ: "R",
      itms: [
        {
          num: 1,
          itm_det: {
            txval: parseFloat(note.taxableAmount),
            rt: 0,
            iamt: 0,
            camt: 0,
            samt: 0,
            csamt: 0,
          },
        },
      ],
    });
    cdnrMap.set(ctin, existing);
  };

  for (const cn of report.creditNotes) pushNote(cn, "C");
  for (const dn of report.debitNotes) pushNote(dn, "D");

  // HSN summary (Table 12): one row per HSN + UQC + GST rate (`rt`).
  const hsnData = report.hsn.map((entry, idx) => ({
    num: idx + 1,
    hsn_sc: entry.hsn,
    desc: entry.description,
    uqc: entry.uqc,
    qty: entry.quantity,
    rt: entry.taxRate,
    txval: entry.taxableValue,
    iamt: entry.igst,
    camt: entry.cgst,
    samt: entry.sgst,
    // TODO(0.11.0): cess is not modelled on sales lines yet, so it is always 0 here and in the
    // CSV; once lines carry a cess rate and amount, sum it per row.
    csamt: 0,
  }));

  return {
    gstin,
    fp: taxPeriod,
    b2b: Array.from(b2bMap.values()),
    b2cl: Array.from(b2clMap.values()),
    b2cs,
    cdnr: Array.from(cdnrMap.values()),
    hsn: { data: hsnData },
  };
}

// ── CSV Export ──────────────────────────────────────────────────

export function gstr1ToCSV(report: GSTR1Report): string {
  const lines: string[] = [];

  lines.push("GSTR-1 Report");
  lines.push(`Period,${report.period}`);
  lines.push(`GSTIN,${csvCell(report.businessGstin)}`);
  lines.push(`Business,${csvCell(report.businessName)}`);
  lines.push("");

  // B2B Section
  lines.push("B2B - Outward Supplies to Registered Persons");
  lines.push("Party GSTIN,Party Name,Invoice No,Invoice Date,Type,Taxable Value,CGST,SGST,IGST,Total Value");
  for (const row of report.b2b) {
    lines.push(csvRow([
      row.partyGstin, row.partyName, row.invoiceNumber,
      new Date(row.invoiceDate).toLocaleDateString("en-IN", { timeZone: BUSINESS_TIME_ZONE }),
      row.invoiceType, row.taxableValue.toFixed(2),
      row.cgst.toFixed(2), row.sgst.toFixed(2), row.igst.toFixed(2),
      row.totalInvoiceValue.toFixed(2),
    ]));
  }
  lines.push("");

  // B2C Small
  lines.push("B2CS - Outward Supplies to Unregistered Persons (Small)");
  lines.push("Tax Rate %,Taxable Value,CGST,SGST,IGST");
  for (const row of report.b2cSmall) {
    lines.push(csvRow([
      row.taxRate, row.taxableValue.toFixed(2),
      row.cgst.toFixed(2), row.sgst.toFixed(2), row.igst.toFixed(2),
    ]));
  }
  lines.push("");

  // HSN summary (Table 12): one row per HSN + UQC + GST rate
  lines.push("HSN - Summary of Outward Supplies (Table 12)");
  if (report.hsnMissing.length > 0) {
    // The JSON export is refused for these; the CSV carries them, flagged, so nothing is hidden.
    lines.push(csvRow([`WARNING: ${report.hsnMissing.length} line(s) have no HSN code and are filed under 0000, which is not a real HSN code. Fix them before filing`]));
    for (const m of report.hsnMissing) {
      lines.push(csvRow(["NO HSN", m.invoiceNumber, `line ${m.line}`, m.itemName, m.itemId ? "item has no HSN: add it on the item" : "typed in without an item"]));
    }
  }
  lines.push("HSN,Description,UQC,Quantity,Tax Rate %,Taxable Value,CGST,SGST,IGST,Cess,Total Value,Flag");
  for (const row of report.hsn) {
    lines.push(csvRow([
      row.hsn, row.description, row.uqc, row.quantity, row.taxRate,
      row.taxableValue.toFixed(2),
      row.cgst.toFixed(2), row.sgst.toFixed(2), row.igst.toFixed(2),
      // TODO(0.11.0): cess is not modelled on sales lines yet; always 0 until it is.
      "0.00",
      row.totalValue.toFixed(2),
      row.hsn === "0000" ? "NO HSN" : "",
    ]));
  }
  lines.push("");

  // Summary
  lines.push("Summary");
  lines.push(`Total Invoices,${report.invoiceCount}`);
  lines.push(`Total Taxable Value,${report.totalTaxableValue.toFixed(2)}`);
  lines.push(`Total CGST,${report.totalCgst.toFixed(2)}`);
  lines.push(`Total SGST,${report.totalSgst.toFixed(2)}`);
  lines.push(`Total IGST,${report.totalIgst.toFixed(2)}`);
  lines.push(`Total Tax,${report.totalTax.toFixed(2)}`);
  lines.push(`Total Invoice Value,${report.totalInvoiceValue.toFixed(2)}`);

  return lines.join("\n");
}

// ── JSON export guard ───────────────────────────────────────────

/** Raised when a GSTR-1 JSON export would carry lines with no HSN code. */
export class Gstr1ExportBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Gstr1ExportBlockedError";
  }
}

/**
 * Refuse to build the GSTR-1 portal JSON while any sale line has no HSN code: Table 12 would carry
 * "0000", which is not a real code, and the filing would be wrong or rejected. The message lists
 * what to fix: items with no HSN (with the invoices that sold them) and lines typed in without an
 * item. The on-screen report and the CSV are not blocked; they show the lines, flagged.
 */
export function assertGstr1JsonExportable(report: GSTR1Report): void {
  if (report.hsnMissing.length === 0) return;
  const MAX_SHOWN = 10;
  const byItem = new Map<string, { name: string; where: string[] }>();
  const typedIn: string[] = [];
  for (const m of report.hsnMissing) {
    const where = `${m.invoiceNumber} line ${m.line}`;
    if (!m.itemId) {
      typedIn.push(`${where} ('${m.itemName}')`);
      continue;
    }
    const entry = byItem.get(m.itemId) ?? { name: m.itemName, where: [] };
    entry.where.push(where);
    byItem.set(m.itemId, entry);
  }
  const parts: string[] = [];
  const items = [...byItem.values()];
  if (items.length > 0) {
    const shown = items.slice(0, MAX_SHOWN).map((e) => `'${e.name}' (${e.where.join(", ")})`);
    const more = items.length > MAX_SHOWN ? `, and ${items.length - MAX_SHOWN} more` : "";
    parts.push(`add the HSN on these items: ${shown.join("; ")}${more}`);
  }
  if (typedIn.length > 0) {
    const shown = typedIn.slice(0, MAX_SHOWN).join(", ");
    const more = typedIn.length > MAX_SHOWN ? `, and ${typedIn.length - MAX_SHOWN} more` : "";
    parts.push(`these lines were typed in without an item and cannot carry an HSN: ${shown}${more}; bill a catalogue item with an HSN instead`);
  }
  throw new Gstr1ExportBlockedError(
    `Cannot export GSTR-1 JSON for ${report.period}: ${report.hsnMissing.length} line(s) have no HSN code, and Table 12 cannot be filed with a made-up one. To fix: ${parts.join(". Also ")}. The on-screen report and the CSV still show these lines under HSN 0000, flagged.`,
  );
}
