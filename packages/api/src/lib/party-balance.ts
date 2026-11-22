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
 * ONE sign convention everywhere, the one the product documents (MCP, WebMCP,
 * docs): a balance is SIGNED, debit minus credit. POSITIVE = they owe you
 * (receivable), NEGATIVE = you owe them (payable), for customers and suppliers
 * alike. The opening balance is used exactly as stored (positive: they owe you,
 * negative: you owe them). So a supplier you owe 14,000 shows -14000.00 on the
 * party page, the party list and in the ledger statements.
 *
 * `party.getById` / `party.list` `balance` = opening + `invoiceBalanceSql` summed
 * over the party's documents (what is still unpaid on them). The statements add
 * the payments themselves as ledger rows instead, so the two agree whenever every
 * payment is allocated to an invoice.
 */

import { sql, type SQL } from "drizzle-orm";
import { invoices } from "@hisaabo/db";
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
 * SQL: what one `invoices` row adds to the party's SIGNED balance: the unpaid
 * part (total - amount paid), positive when the document lands on the debit side
 * (`invoiceIsLedgerDebitSql`), negative when it lands on the credit side, and 0
 * for documents that never post. Sum it over a party's non-cancelled,
 * non-deleted rows and add the opening balance, exactly as stored.
 */
export function invoiceBalanceSql(): SQL<string> {
  return sql<string>`CASE
    WHEN ${invoices.documentType} NOT IN ${POSTING_TYPES_SQL} THEN 0
    WHEN ${invoiceIsLedgerDebitSql()}
      THEN (${invoices.totalAmount}::numeric - ${invoices.amountPaid}::numeric)
    ELSE -(${invoices.totalAmount}::numeric - ${invoices.amountPaid}::numeric)
  END`;
}
