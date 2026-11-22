/**
 * derive-ledger.ts — Virtual double-entry journal engine.
 *
 * WHY THIS FILE EXISTS:
 * Hisaabo stores invoices, payments and expenses as operational records.
 * The accounting layer needs to present these as balanced double-entry journal
 * entries mapped against the Chart of Accounts, WITHOUT storing duplicate rows.
 *
 * This module is the single source of truth for that mapping. Reports (trial
 * balance, P&L, balance sheet) query `deriveLedger()` at runtime and aggregate
 * the returned DerivedEntry array — they never maintain their own shadow tables.
 *
 * MAPPING RULES (see spec):
 *   Sale Invoice     → Dr 1100 Receivable  / Cr 4000 Sales (subtotal)
 *                    → Dr 1100 Receivable  / Cr 2100/2101 Output CGST+SGST (intra-state)
 *                    → Dr 1100 Receivable  / Cr 2102 Output IGST (inter-state)
 *   Purchase Invoice → Dr 5000 Purchases   / Cr 2000 Payable (subtotal)
 *                    → Dr 1510/1511 Input CGST+SGST / Cr 2000 Payable (intra-state)
 *                    → Dr 1512 Input IGST  / Cr 2000 Payable (inter-state)
 *   Payment Received → Dr 1000/1010 Cash/Bank / Cr 1100 Receivable
 *   Payment Received with customer TDS → Dr 1000/1010 Cash/Bank (net cash)
 *                       + Dr 1600 TDS Receivable (tax withheld) / Cr 1100 Receivable (cash + TDS)
 *   Payment Made     → Dr 2000 Payable / Cr 1000/1010 Cash/Bank
 *   Expense          → Dr 5xxx (by category) / Cr 1000/1010 Cash/Bank
 *   Credit Note / Sales Return  → Dr 4010 Sales Returns + Dr Output GST / Cr 1100 Receivable
 *   Debit Note (sale-side)      → Dr 1100 Receivable / Cr 4000 Sales + Cr Output GST
 *   Debit Note / Purchase Return → Dr 2000 Payable / Cr 5010 Purchase Returns + Cr Input GST
 *
 * Invoice-level discount, additional charges and round-off are posted to their
 * own accounts so every document balances at its stored total. The per-document
 * rules (and the account each adjustment uses) live in ledger-documents.ts.
 */

import { eq, and, isNull } from "drizzle-orm";
import {
  invoices,
  payments,
  expenses,
  parties,
  businesses,
  chartOfAccounts,
  journalEntries,
  journalEntryLines,
} from "@hisaabo/db";
import { buildBusinessDateFilter } from "./business-date.js";
import { paymentSettlement, paymentTdsSql } from "./payment-settlement.js";
import { loadLineGstSplits } from "./gst-split.js";
import { logger } from "./logger.js";
import {
  buildDocumentLines,
  creditLine,
  debitLine,
  getAccount,
  ledgerDocumentLabel,
  type CoaMap,
} from "./ledger-documents.js";

// ── Public types ────────────────────────────────────────────────

export interface DerivedEntryLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  /** Money string "0.00" when this line is on the credit side */
  debit: string;
  /** Money string "0.00" when this line is on the debit side */
  credit: string;
}

export interface DerivedEntry {
  date: Date;
  narration: string;
  sourceType: "invoice" | "payment" | "expense" | "journal" | "bank_transfer";
  sourceId: string;
  /** Invoice number, payment number, etc. */
  sourceNumber: string;
  lines: DerivedEntryLine[];
}

// ── Internal helpers ────────────────────────────────────────────

/**
 * A document whose stored total is more than a round-off away from what its columns explain is
 * parked in the Suspense account. Say so once per document per process (reports re-derive the
 * ledger on every call), with the document id so it can be found and fixed.
 */
const warnedSuspense = new Set<string>();
function warnUnexplainedDifference(doc: { id?: string; invoiceNumber?: string }, amount: string): void {
  const key = doc.id ?? doc.invoiceNumber ?? amount;
  if (warnedSuspense.has(key)) return;
  if (warnedSuspense.size >= 5000) warnedSuspense.clear();
  warnedSuspense.add(key);
  logger.warn(
    { documentId: doc.id, invoiceNumber: doc.invoiceNumber, unexplained: amount },
    "ledger: document total differs from its parts by more than a round-off; posted to Suspense / Unreconciled (2900)",
  );
}

/** Determine whether two state codes represent the same state. */
function isSameState(
  bizStateCode: string | null | undefined,
  partyStateCode: string | null | undefined,
  bizState: string | null | undefined,
  partyState: string | null | undefined,
): boolean {
  if (bizStateCode && partyStateCode) {
    return bizStateCode === partyStateCode;
  }
  if (bizState && partyState) {
    return bizState.toLowerCase() === partyState.toLowerCase();
  }
  // Cannot determine — treat as intra-state (conservative, avoids wrong IGST split)
  return true;
}

// ── Category → CoA code mapping ─────────────────────────────────

/**
 * Map an expense category string to a CoA code.
 * First checks if the CoA has an account whose name matches the category
 * (case-insensitive), then falls back to specific keyword matches,
 * and finally defaults to "5990" (Miscellaneous Expenses).
 */
function expenseCategoryToCode(category: string, coa: CoaMap): string {
  const needle = category.toLowerCase().trim();

  // Direct name match against CoA (handles custom accounts like "Tea & Snacks")
  for (const [code, acct] of coa.entries()) {
    if (acct.name.toLowerCase() === needle) return code;
  }

  // Keyword mapping for common Indian SMB categories
  if (needle.includes("rent")) return "5300";
  if (needle.includes("salary") || needle.includes("wage")) return "5200";
  if (needle.includes("electricity") || needle.includes("utility") || needle.includes("utilities")) return "5400";
  if (needle.includes("communication") || needle.includes("phone") || needle.includes("internet")) return "5500";
  if (needle.includes("travel") || needle.includes("conveyance") || needle.includes("transport")) return "5600";
  if (needle.includes("office")) return "5700";
  if (needle.includes("repair") || needle.includes("maintenance")) return "5800";
  if (needle.includes("depreciation")) return "5900";
  if (needle.includes("bank charge") || needle.includes("bank fee")) return "5950";
  if (needle.includes("gateway") || needle.includes("payment gateway")) return "5960";
  if (needle.includes("bad debt")) return "5970";
  if (needle.includes("professional") || needle.includes("legal") || needle.includes("audit")) return "5980";
  if (needle.includes("purchase")) return "5000";
  if (needle.includes("direct")) return "5100";

  // Fallback: Miscellaneous Expenses
  return "5990";
}

// ── Main export ─────────────────────────────────────────────────

/**
 * Derives virtual double-entry journal entries from existing operational
 * transactions (invoices, payments, expenses) within the given date range.
 *
 * Returns an array of DerivedEntry objects, each representing one balanced
 * journal entry. The entries are NOT stored — they are computed at call time.
 *
 * @param db      Drizzle tenant DB instance
 * @param businessId  UUID of the business
 * @param fromDate    Inclusive start of the date range
 * @param toDate      Inclusive end of the date range
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function deriveLedger(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  businessId: string,
  fromDate: Date,
  toDate: Date,
): Promise<DerivedEntry[]> {
  // ── 1. Fetch business state info for GST split ──────────────────
  const [biz] = await db
    .select({
      stateCode: businesses.stateCode,
      state: businesses.state,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  // ── 2. Load the Chart of Accounts for this business ────────────
  const coaRows: Array<{ id: string; code: string; name: string; isSystem: boolean }> = await db
    .select({
      id: chartOfAccounts.id,
      code: chartOfAccounts.code,
      name: chartOfAccounts.name,
      isSystem: chartOfAccounts.isSystem,
    })
    .from(chartOfAccounts)
    .where(
      and(
        eq(chartOfAccounts.businessId, businessId),
        eq(chartOfAccounts.isActive, true),
      ),
    );

  const coa: CoaMap = new Map(coaRows.map((r) => [r.code, r]));
  const systemCodes = new Set(coaRows.filter((r) => r.isSystem).map((r) => r.code));

  const entries: DerivedEntry[] = [];

  // ── 3. Invoices ─────────────────────────────────────────────────
  const properInvRows: Array<{
    id: string;
    invoiceNumber: string;
    invoiceDate: Date;
    type: string;
    documentType: string;
    subtotal: string;
    taxAmount: string;
    totalAmount: string;
    discountAmount: string;
    additionalCharges: string;
    roundOff: string;
    partyState: string | null;
    partyStateCode: string | null;
    status: string;
  }> = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      invoiceDate: invoices.invoiceDate,
      type: invoices.type,
      documentType: invoices.documentType,
      status: invoices.status,
      subtotal: invoices.subtotal,
      taxAmount: invoices.taxAmount,
      totalAmount: invoices.totalAmount,
      discountAmount: invoices.discountAmount,
      additionalCharges: invoices.additionalCharges,
      roundOff: invoices.roundOff,
      partyState: parties.state,
      partyStateCode: parties.stateCode,
    })
    .from(invoices)
    .innerJoin(parties, eq(parties.id, invoices.partyId))
    .where(
      and(
        eq(invoices.businessId, businessId),
        isNull(invoices.deletedAt),
        ...buildBusinessDateFilter(invoices, { from: fromDate, to: toDate }),
      ),
    );

  // Exclude cancelled invoices in JS (avoids sql`` template in shared code)
  const activeInvRows = properInvRows.filter((r) => r.status !== "cancelled");

  // Per-line CGST / SGST sums for the intra-state split (the e-invoice rule), one row per invoice.
  const lineGstSplits = await loadLineGstSplits(db, businessId, [
    isNull(invoices.deletedAt),
    ...buildBusinessDateFilter(invoices, { from: fromDate, to: toDate }),
  ]);

  for (const inv of activeInvRows) {
    const lines = buildDocumentLines({ ...inv, lineGstSplit: lineGstSplits.get(inv.id) }, {
      coa,
      systemCodes,
      sameState: isSameState(biz?.stateCode, inv.partyStateCode, biz?.state, inv.partyState),
      onSuspense: warnUnexplainedDifference,
    });
    // Quotations, proformas, delivery challans etc. are non-financial — skip
    if (!lines) continue;

    entries.push({
      date: inv.invoiceDate,
      narration: `${ledgerDocumentLabel(inv.documentType, inv.type)} ${inv.invoiceNumber}`,
      sourceType: "invoice",
      sourceId: inv.id,
      sourceNumber: inv.invoiceNumber,
      lines,
    });
  }

  // ── 4. Payments ─────────────────────────────────────────────────
  const paymentRows: Array<{
    id: string;
    paymentNumber: string | null;
    paymentDate: Date;
    amount: string;
    mode: string;
    partyType: string;
    tdsAmount: string;
  }> = await db
    .select({
      id: payments.id,
      paymentNumber: payments.paymentNumber,
      paymentDate: payments.paymentDate,
      amount: payments.amount,
      mode: payments.mode,
      partyType: parties.type,
      tdsAmount: paymentTdsSql(),
    })
    .from(payments)
    .innerJoin(parties, eq(parties.id, payments.partyId))
    .where(
      and(
        eq(payments.businessId, businessId),
        isNull(payments.deletedAt),
        ...buildBusinessDateFilter(payments, { from: fromDate, to: toDate }),
      ),
    );

  for (const pmt of paymentRows) {
    const lines: DerivedEntryLine[] = [];
    const amount = pmt.amount;

    // Determine cash vs bank account based on mode
    const cashOrBankCode = pmt.mode === "cash" ? "1000" : "1010";
    const cashOrBank = getAccount(coa, cashOrBankCode);
    const receivable = getAccount(coa, "1100");
    const payable = getAccount(coa, "2000");
    const pmtNum = pmt.paymentNumber ?? pmt.id.slice(0, 8);

    if (pmt.partyType === "customer") {
      // Payment received: Dr Cash/Bank + TDS receivable / Cr Receivable.
      // Account 1600 is required only for a receipt that actually carries TDS,
      // so a business whose chart lacks it still derives every other entry.
      const settlement = paymentSettlement(amount, pmt.tdsAmount);
      lines.push(debitLine(cashOrBank, amount));
      if (settlement.hasTds) {
        // Never post withheld TDS into a user-created account that happens to
        // use code 1600: it must be the system "TDS Receivable" account.
        if (!systemCodes.has("1600")) {
          throw new Error(
            'Withheld TDS must post to the system "TDS Receivable" account (1600), which is missing, inactive, or taken by a user-created account.',
          );
        }
        lines.push(debitLine(getAccount(coa, "1600"), settlement.tds));
      }
      lines.push(creditLine(receivable, settlement.hasTds ? settlement.settled : amount));

      entries.push({
        date: pmt.paymentDate,
        narration: `Payment Received ${pmtNum}`,
        sourceType: "payment",
        sourceId: pmt.id,
        sourceNumber: pmtNum,
        lines,
      });
    } else {
      // Payment made to supplier: Dr Payable / Cr Cash/Bank
      lines.push(debitLine(payable, amount));
      lines.push(creditLine(cashOrBank, amount));

      entries.push({
        date: pmt.paymentDate,
        narration: `Payment Made ${pmtNum}`,
        sourceType: "payment",
        sourceId: pmt.id,
        sourceNumber: pmtNum,
        lines,
      });
    }
  }

  // ── 5. Expenses ─────────────────────────────────────────────────
  const expenseRows: Array<{
    id: string;
    category: string;
    description: string | null;
    amount: string;
    mode: string;
    expenseDate: Date;
  }> = await db
    .select({
      id: expenses.id,
      category: expenses.category,
      description: expenses.description,
      amount: expenses.amount,
      mode: expenses.mode,
      expenseDate: expenses.expenseDate,
    })
    .from(expenses)
    .where(
      and(
        eq(expenses.businessId, businessId),
        isNull(expenses.deletedAt),
        ...buildBusinessDateFilter(expenses, { from: fromDate, to: toDate }),
      ),
    );

  for (const exp of expenseRows) {
    const lines: DerivedEntryLine[] = [];
    const amount = exp.amount;

    // Determine expense account by category
    const expCode = expenseCategoryToCode(exp.category, coa);
    const expAccount = getAccount(coa, expCode);

    // Determine cash vs bank
    const cashOrBankCode = exp.mode === "cash" ? "1000" : "1010";
    const cashOrBank = getAccount(coa, cashOrBankCode);

    // Debit expense account, Credit Cash/Bank
    lines.push(debitLine(expAccount, amount));
    lines.push(creditLine(cashOrBank, amount));

    const narration = exp.description
      ? `${exp.category} — ${exp.description}`
      : exp.category;

    entries.push({
      date: exp.expenseDate,
      narration,
      sourceType: "expense",
      sourceId: exp.id,
      sourceNumber: exp.id.slice(0, 8),
      lines,
    });
  }

  // Sort chronologically
  entries.sort((a, b) => a.date.getTime() - b.date.getTime());

  return entries;
}

// ── Full ledger (operational + journal entries) ─────────────────

/**
 * Returns the union of derived operational entries (invoices, payments,
 * expenses) and persisted manual/system journal entries for the given
 * date range.  This is the function reports should call when they need
 * the complete picture including manual journals.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function deriveFullLedger(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  businessId: string,
  fromDate: Date,
  toDate: Date,
): Promise<DerivedEntry[]> {
  // 1. Get operational entries via the existing deriveLedger
  const entries = await deriveLedger(db, businessId, fromDate, toDate);

  // 2. Query persisted journal entry lines (including voided entries and
  //    their reversals — the pair naturally nets to zero in reports).
  const jeRows: Array<{
    journalEntryId: string;
    entryNumber: string;
    entryDate: Date;
    narration: string | null;
    accountId: string;
    debit: string;
    credit: string;
    accountCode: string;
    accountName: string;
  }> = await db
    .select({
      journalEntryId: journalEntries.id,
      entryNumber: journalEntries.entryNumber,
      entryDate: journalEntries.entryDate,
      narration: journalEntries.narration,
      accountId: journalEntryLines.accountId,
      debit: journalEntryLines.debit,
      credit: journalEntryLines.credit,
      accountCode: chartOfAccounts.code,
      accountName: chartOfAccounts.name,
    })
    .from(journalEntryLines)
    .innerJoin(
      journalEntries,
      eq(journalEntries.id, journalEntryLines.journalEntryId),
    )
    .innerJoin(
      chartOfAccounts,
      eq(chartOfAccounts.id, journalEntryLines.accountId),
    )
    .where(
      and(
        eq(journalEntries.businessId, businessId),
        ...buildBusinessDateFilter(journalEntries, { from: fromDate, to: toDate }),
      ),
    );

  // 3. Group rows by journal_entry_id → DerivedEntry[]
  const jeMap = new Map<string, DerivedEntry>();

  for (const row of jeRows) {
    let entry = jeMap.get(row.journalEntryId);
    if (!entry) {
      entry = {
        date: row.entryDate,
        narration: row.narration ?? `Journal ${row.entryNumber}`,
        sourceType: "journal",
        sourceId: row.journalEntryId,
        sourceNumber: row.entryNumber,
        lines: [],
      };
      jeMap.set(row.journalEntryId, entry);
    }

    entry.lines.push({
      accountId: row.accountId,
      accountCode: row.accountCode,
      accountName: row.accountName,
      debit: parseFloat(row.debit).toFixed(2),
      credit: parseFloat(row.credit).toFixed(2),
    });
  }

  // 4. Merge and sort chronologically
  const all = entries.concat([...jeMap.values()]);
  all.sort((a, b) => a.date.getTime() - b.date.getTime());

  return all;
}
