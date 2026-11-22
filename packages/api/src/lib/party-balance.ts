/**
 * party-balance.ts — the document-type rules behind every party balance and
 * party ledger, so `party.getById`, `party.list`, `party.ledger`,
 * `party.ledgerReport` (+ CSV), `reports.partyStatement` and the ledger PDF
 * cannot disagree about which documents count or which way they move a balance.
 *
 * Two conventions, both deliberate and both pinned by the golden suite:
 *
 *  1. "Outstanding" (`party.getById` / `party.list` `balance`): the amount the
 *     party owes (customer) or we owe (supplier), POSITIVE in its natural
 *     direction. Opening balance + the unpaid part of every posting document.
 *     Sale and purchase invoices and sale-side debit notes ADD to it; credit
 *     notes, sales returns, purchase returns and purchase-side debit notes
 *     REDUCE it. Quotations, proformas and delivery challans never count.
 *
 *  2. "Ledger statement" (`party.ledger`, `party.ledgerReport`,
 *     `reports.partyStatement`, the PDF): debit-minus-credit running balance, the
 *     way the books see the party. A customer who owes us is positive, a
 *     supplier we owe is NEGATIVE (`documentLedgerSide` says which side a
 *     document lands on).
 *
 * Which documents move the books is the same set the ledger posts
 * (derive-ledger.ts): invoice, credit_note, sales_return, purchase_return,
 * debit_note.
 */

import { sql, type SQL } from "drizzle-orm";
import { invoices } from "@hisaabo/db";

/** Document types that move a party's balance; everything else never posts. */
export const BALANCE_DOCUMENT_TYPES = [
  "invoice",
  "credit_note",
  "sales_return",
  "purchase_return",
  "debit_note",
] as const;

/** Document types that always take from the balance. */
const REDUCTION_DOCUMENT_TYPES = ["credit_note", "sales_return", "purchase_return"] as const;

/**
 * True when the document REDUCES what the party owes (or is owed): credit notes,
 * sales returns and purchase returns, plus a PURCHASE-side debit note (we debit
 * the supplier, so we owe them less). A sale-side debit note adds to the
 * receivable like an invoice.
 */
export function isBalanceReduction(documentType: string, type: string): boolean {
  return (
    (REDUCTION_DOCUMENT_TYPES as readonly string[]).includes(documentType) ||
    (documentType === "debit_note" && type === "purchase")
  );
}

/**
 * Which side of the party's ledger a document lands on, or `null` when it
 * never posts. Sale invoice / sale debit note: debit. Purchase invoice: credit.
 * Credit note / sales return: credit. Purchase return / purchase debit note: debit.
 */
export function documentLedgerSide(documentType: string, type: string): "debit" | "credit" | null {
  if (!(BALANCE_DOCUMENT_TYPES as readonly string[]).includes(documentType)) return null;
  const sale = type === "sale";
  const reduces = isBalanceReduction(documentType, type);
  return (sale && !reduces) || (!sale && reduces) ? "debit" : "credit";
}

/**
 * SQL: what one `invoices` row adds to (+) or takes from (-) the party's
 * outstanding balance: the unpaid part (total - amount paid), signed by
 * `isBalanceReduction`, and 0 for documents that never post. Sum it over a
 * party's non-cancelled, non-deleted rows and add the opening balance.
 */
export function invoiceBalanceSql(): SQL<string> {
  return sql<string>`CASE
    WHEN ${invoices.documentType} NOT IN ('invoice', 'credit_note', 'sales_return', 'purchase_return', 'debit_note')
      THEN 0
    WHEN ${invoices.documentType} IN ('credit_note', 'sales_return', 'purchase_return')
      OR (${invoices.documentType} = 'debit_note' AND ${invoices.type} = 'purchase')
      THEN -(${invoices.totalAmount}::numeric - ${invoices.amountPaid}::numeric)
    ELSE (${invoices.totalAmount}::numeric - ${invoices.amountPaid}::numeric)
  END`;
}
