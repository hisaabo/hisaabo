/**
 * party-balance.ts — the document-type rules behind every party balance and
 * party ledger, so `party.getById`, `party.list`, `party.ledger`,
 * `party.ledgerReport` (+ CSV), `reports.partyStatement` and the ledger PDF
 * cannot disagree about which documents count or which way they move a balance.
 *
 * Which documents move the books, and on which side, is decided by
 * `classifyLedgerDocument` (ledger-documents.ts), the rule the derived ledger and
 * the GST returns use: invoice, credit_note, sales_return, purchase_return and
 * debit_note post; the side is the document's `type`, so a credit note raised
 * from a purchase invoice reverses the purchase. Quotations, proformas and
 * delivery challans never count.
 *
 * Two conventions, both pinned by the golden suite:
 *
 *  1. "Outstanding" (`party.getById` / `party.list` `balance`): opening balance +
 *     the unpaid part of every posting document. Invoices and sale-side debit
 *     notes ADD to it; credit notes, sales returns, purchase returns and
 *     purchase-side debit notes REDUCE it.
 *
 *  2. "Ledger statement" (`party.ledger`, `party.ledgerReport`,
 *     `reports.partyStatement`, the PDF): debit-minus-credit running balance, the
 *     way the books see the party. `documentLedgerSide` says which side a
 *     document lands on.
 */

import { sql, type SQL } from "drizzle-orm";
import { invoices } from "@hisaabo/db";
import { money } from "@hisaabo/shared";
import { classifyLedgerDocument } from "./ledger-documents.js";

/** Document types that move a party's balance; everything else never posts. */
export const BALANCE_DOCUMENT_TYPES = [
  "invoice",
  "credit_note",
  "sales_return",
  "purchase_return",
  "debit_note",
] as const;

/**
 * True when the document REDUCES what the party owes (or is owed): credit notes,
 * sales returns, purchase returns and purchase-side debit notes (we debit the
 * supplier, so we owe them less). Invoices and sale-side debit notes add.
 */
export function isBalanceReduction(documentType: string, type: string): boolean {
  return classifyLedgerDocument(documentType, type)?.kind === "reversal";
}

/**
 * Which side of the party's ledger a document lands on, or `null` when it
 * never posts. Sale invoice / sale debit note: debit. Purchase invoice: credit.
 * Sale-side reversals (credit note, sales return): credit. Purchase-side
 * reversals (purchase return, purchase debit note, and a credit note or sales
 * return raised from a purchase invoice): debit.
 */
export function documentLedgerSide(documentType: string, type: string): "debit" | "credit" | null {
  const cls = classifyLedgerDocument(documentType, type);
  if (!cls) return null;
  const forwardIsDebit = cls.side === "sale";
  return (cls.kind === "reversal" ? !forwardIsDebit : forwardIsDebit) ? "debit" : "credit";
}

/**
 * The opening balance as the debit-minus-credit statements start it. The stored
 * value is "what they owe us" for a customer and "what we owe them" for a
 * supplier, both positive, so a supplier's opening is a CREDIT: negative.
 */
export function signedOpeningBalance(partyType: string, openingBalance: string): string {
  const opening = money.add(openingBalance, "0");
  return partyType === "supplier" ? money.sub("0", opening) : opening;
}

const POSTING_TYPES_SQL = sql`('invoice', 'credit_note', 'sales_return', 'purchase_return', 'debit_note')`;

/**
 * SQL boolean: the document lands on the DEBIT side of the party's ledger
 * (`documentLedgerSide` === "debit"). A reversal debits when it reverses a
 * purchase; a sale invoice and a sale-side debit note debit.
 */
export function invoiceIsLedgerDebitSql(): SQL<boolean> {
  return sql<boolean>`(
    (${invoices.type} = 'sale' AND ${invoices.documentType} IN ('invoice', 'debit_note'))
    OR (${invoices.type} = 'purchase' AND ${invoices.documentType} IN ('credit_note', 'sales_return', 'purchase_return', 'debit_note'))
  )`;
}

/**
 * SQL: what one `invoices` row adds to (+) or takes from (-) the party's
 * outstanding balance: the unpaid part (total - amount paid), signed by whether
 * the document reduces what is owed, and 0 for documents that never post. Sum it
 * over a party's non-cancelled, non-deleted rows and add the opening balance.
 */
export function invoiceBalanceSql(): SQL<string> {
  return sql<string>`CASE
    WHEN ${invoices.documentType} NOT IN ${POSTING_TYPES_SQL} THEN 0
    WHEN ${invoices.documentType} IN ('credit_note', 'sales_return', 'purchase_return')
      OR (${invoices.documentType} = 'debit_note' AND ${invoices.type} = 'purchase')
      THEN -(${invoices.totalAmount}::numeric - ${invoices.amountPaid}::numeric)
    ELSE (${invoices.totalAmount}::numeric - ${invoices.amountPaid}::numeric)
  END`;
}
