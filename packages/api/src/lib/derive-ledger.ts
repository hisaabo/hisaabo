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
 *   Payment Made     → Dr 2000 Payable / Cr 1000/1010 Cash/Bank
 *   Expense          → Dr 5xxx (by category) / Cr 1000/1010 Cash/Bank
 *   Credit Note / Sales Return  → Dr 4010 Sales Returns + Dr Output GST / Cr 1100 Receivable
 *   Debit Note (sale-side)      → Dr 1100 Receivable / Cr 4000 Sales + Cr Output GST
 *   Debit Note / Purchase Return → Dr 2000 Payable / Cr 5010 Purchase Returns + Cr Input GST
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
 * Split a tax amount into two equal halves using integer (paise) arithmetic
 * to avoid floating-point rounding errors on odd amounts (e.g. ₹1.01).
 * Returns the two halves as money strings that sum exactly to the input.
 */
function splitTax(amount: string): [string, string] {
  // Work in paise to avoid floating-point drift
  const totalPaise = Math.round(parseFloat(amount) * 100);
  const half = Math.floor(totalPaise / 2);
  const remainder = totalPaise - half; // handles odd paise (e.g. 101 → 50 + 51)
  return [
    (half / 100).toFixed(2),
    (remainder / 100).toFixed(2),
  ];
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

/** Build a DerivedEntryLine for the debit side. */
function debitLine(
  account: { id: string; code: string; name: string },
  amount: string,
): DerivedEntryLine {
  return {
    accountId: account.id,
    accountCode: account.code,
    accountName: account.name,
    debit: amount,
    credit: "0.00",
  };
}

/** Build a DerivedEntryLine for the credit side. */
function creditLine(
  account: { id: string; code: string; name: string },
  amount: string,
): DerivedEntryLine {
  return {
    accountId: account.id,
    accountCode: account.code,
    accountName: account.name,
    debit: "0.00",
    credit: amount,
  };
}

// ── CoA lookup helper ───────────────────────────────────────────

type CoaMap = Map<string, { id: string; code: string; name: string }>;

/** Look up an account by code; throws if missing (indicates seed data problem). */
function getAccount(coa: CoaMap, code: string): { id: string; code: string; name: string } {
  const acct = coa.get(code);
  if (!acct) {
    throw new Error(`Chart of Accounts is missing required account code "${code}". Run the CoA seed first.`);
  }
  return acct;
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
  const coaRows: Array<{ id: string; code: string; name: string }> = await db
    .select({
      id: chartOfAccounts.id,
      code: chartOfAccounts.code,
      name: chartOfAccounts.name,
    })
    .from(chartOfAccounts)
    .where(
      and(
        eq(chartOfAccounts.businessId, businessId),
        eq(chartOfAccounts.isActive, true),
      ),
    );

  const coa: CoaMap = new Map(coaRows.map((r) => [r.code, r]));

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

  for (const inv of activeInvRows) {
    const lines: DerivedEntryLine[] = [];

    const subtotal = inv.subtotal;
    const taxStr = inv.taxAmount;
    const sameState = isSameState(
      biz?.stateCode,
      inv.partyStateCode,
      biz?.state,
      inv.partyState,
    );

    if (inv.type === "sale" && inv.documentType === "invoice") {
      // ── Sale Invoice ────────────────────────────────────────────
      // Debit Receivable (1100), Credit Sales (4000) for subtotal
      const receivable = getAccount(coa, "1100");
      const sales = getAccount(coa, "4000");

      // Total debit on receivable = totalAmount (subtotal + tax)
      const totalAmt = inv.totalAmount;

      lines.push(debitLine(receivable, totalAmt));
      lines.push(creditLine(sales, subtotal));

      // Tax split
      if (parseFloat(taxStr) > 0) {
        if (sameState) {
          const [cgstAmt, sgstAmt] = splitTax(taxStr);
          const cgst = getAccount(coa, "2100");
          const sgst = getAccount(coa, "2101");
          lines.push(creditLine(cgst, cgstAmt));
          lines.push(creditLine(sgst, sgstAmt));
        } else {
          const igst = getAccount(coa, "2102");
          lines.push(creditLine(igst, taxStr));
        }
      }

      entries.push({
        date: inv.invoiceDate,
        narration: `Sale Invoice ${inv.invoiceNumber}`,
        sourceType: "invoice",
        sourceId: inv.id,
        sourceNumber: inv.invoiceNumber,
        lines,
      });
    } else if (inv.type === "purchase" && inv.documentType === "invoice") {
      // ── Purchase Invoice ────────────────────────────────────────
      // Debit Purchases (5000), Cr Payable (2000) for subtotal
      // Debit Input GST accounts, Cr Payable (2000) for tax
      const purchases = getAccount(coa, "5000");
      const payable = getAccount(coa, "2000");
      const totalAmt = inv.totalAmount;

      lines.push(debitLine(purchases, subtotal));

      if (parseFloat(taxStr) > 0) {
        if (sameState) {
          const [cgstAmt, sgstAmt] = splitTax(taxStr);
          const inputCgst = getAccount(coa, "1510");
          const inputSgst = getAccount(coa, "1511");
          lines.push(debitLine(inputCgst, cgstAmt));
          lines.push(debitLine(inputSgst, sgstAmt));
        } else {
          const inputIgst = getAccount(coa, "1512");
          lines.push(debitLine(inputIgst, taxStr));
        }
      }

      lines.push(creditLine(payable, totalAmt));

      entries.push({
        date: inv.invoiceDate,
        narration: `Purchase Invoice ${inv.invoiceNumber}`,
        sourceType: "invoice",
        sourceId: inv.id,
        sourceNumber: inv.invoiceNumber,
        lines,
      });
    } else if (inv.documentType === "credit_note" || inv.documentType === "sales_return") {
      // ── Credit Note / Sales Return (sale-side return) ────────────
      // Reverses original sale: Dr Sales Returns (subtotal) + Dr Output GST (tax), Cr Receivable (total)
      const salesReturns = getAccount(coa, "4010");
      const receivable = getAccount(coa, "1100");
      const taxStr = inv.taxAmount;

      lines.push(debitLine(salesReturns, inv.subtotal));
      // Reverse GST liability
      if (parseFloat(taxStr) > 0) {
        const sameState = isSameState(biz?.stateCode, inv.partyStateCode, biz?.state, inv.partyState);
        if (sameState) {
          const [cgstAmt, sgstAmt] = splitTax(taxStr);
          lines.push(debitLine(getAccount(coa, "2100"), cgstAmt));
          lines.push(debitLine(getAccount(coa, "2101"), sgstAmt));
        } else {
          lines.push(debitLine(getAccount(coa, "2102"), taxStr));
        }
      }
      lines.push(creditLine(receivable, inv.totalAmount));

      const cnLabel = inv.documentType === "sales_return" ? "Sales Return" : "Credit Note";
      entries.push({
        date: inv.invoiceDate,
        narration: `${cnLabel} ${inv.invoiceNumber}`,
        sourceType: "invoice",
        sourceId: inv.id,
        sourceNumber: inv.invoiceNumber,
        lines,
      });
    } else if (inv.documentType === "debit_note" && inv.type === "sale") {
      // ── Debit Note (sale-side) ───────────────────────────────────
      // Issued by seller to increase what the buyer owes (e.g. price correction upward).
      // Mirrors a sale invoice: Dr Receivable (total) / Cr Sales (subtotal) + Cr Output GST (tax)
      const receivable = getAccount(coa, "1100");
      const sales = getAccount(coa, "4000");
      const taxStr = inv.taxAmount;

      lines.push(debitLine(receivable, inv.totalAmount));
      lines.push(creditLine(sales, inv.subtotal));
      if (parseFloat(taxStr) > 0) {
        const sameState = isSameState(biz?.stateCode, inv.partyStateCode, biz?.state, inv.partyState);
        if (sameState) {
          const [cgstAmt, sgstAmt] = splitTax(taxStr);
          lines.push(creditLine(getAccount(coa, "2100"), cgstAmt));
          lines.push(creditLine(getAccount(coa, "2101"), sgstAmt));
        } else {
          lines.push(creditLine(getAccount(coa, "2102"), taxStr));
        }
      }

      entries.push({
        date: inv.invoiceDate,
        narration: `Debit Note ${inv.invoiceNumber}`,
        sourceType: "invoice",
        sourceId: inv.id,
        sourceNumber: inv.invoiceNumber,
        lines,
      });
    } else if (
      (inv.documentType === "debit_note" && inv.type === "purchase") ||
      inv.documentType === "purchase_return"
    ) {
      // ── Debit Note (purchase-side) / Purchase Return ─────────────
      // Reverses original purchase: Dr Payable (total), Cr Purchase Returns (subtotal) + Cr Input GST (tax)
      const payable = getAccount(coa, "2000");
      const purchaseReturns = getAccount(coa, "5010");
      const taxStr = inv.taxAmount;

      lines.push(debitLine(payable, inv.totalAmount));
      lines.push(creditLine(purchaseReturns, inv.subtotal));
      // Reverse input GST
      if (parseFloat(taxStr) > 0) {
        const sameState = isSameState(biz?.stateCode, inv.partyStateCode, biz?.state, inv.partyState);
        if (sameState) {
          const [cgstAmt, sgstAmt] = splitTax(taxStr);
          lines.push(creditLine(getAccount(coa, "1510"), cgstAmt));
          lines.push(creditLine(getAccount(coa, "1511"), sgstAmt));
        } else {
          lines.push(creditLine(getAccount(coa, "1512"), taxStr));
        }
      }

      const dnLabel = inv.documentType === "purchase_return" ? "Purchase Return" : "Debit Note";
      entries.push({
        date: inv.invoiceDate,
        narration: `${dnLabel} ${inv.invoiceNumber}`,
        sourceType: "invoice",
        sourceId: inv.id,
        sourceNumber: inv.invoiceNumber,
        lines,
      });
    }
    // Quotations, proformas, delivery challans etc. are non-financial — skip
  }

  // ── 4. Payments ─────────────────────────────────────────────────
  const paymentRows: Array<{
    id: string;
    paymentNumber: string | null;
    paymentDate: Date;
    amount: string;
    mode: string;
    partyType: string;
  }> = await db
    .select({
      id: payments.id,
      paymentNumber: payments.paymentNumber,
      paymentDate: payments.paymentDate,
      amount: payments.amount,
      mode: payments.mode,
      partyType: parties.type,
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
      // Payment received: Dr Cash/Bank / Cr Receivable
      lines.push(debitLine(cashOrBank, amount));
      lines.push(creditLine(receivable, amount));

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
