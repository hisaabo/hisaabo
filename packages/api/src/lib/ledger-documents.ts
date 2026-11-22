/**
 * ledger-documents.ts — how ONE invoice-table document (invoice, credit note,
 * sales return, debit note, purchase return) turns into balanced journal lines.
 *
 * Pure functions, no database: derive-ledger.ts loads the rows and the chart of
 * accounts and calls `buildDocumentLines`. Keeping the posting rules here makes
 * them unit-testable and gives every report one definition of "which documents
 * reduce what a party owes" (`classifyLedgerDocument`, also used by the GSTR-3B
 * generator and the party balance).
 *
 * Posting rules (Dr = debit, Cr = credit):
 *
 *   Sale invoice / sale debit note
 *     Dr 1100 Receivable (total)
 *       Cr 4000 Sales (subtotal), Cr 2100/2101 or 2102 Output GST (tax)
 *       Dr 5020 Discount Allowed   (invoice-level discount)
 *       Cr 4020 Other Charges      (additional charges)
 *       Cr/Dr 5030 Round Off       (+ / -)
 *   Credit note / sales return: the sale invoice with every line reversed, the
 *     sales leg going to 4010 Sales Returns.
 *   Purchase invoice
 *     Dr 5000 Purchases (subtotal), Dr 1510/1511 or 1512 Input GST (tax)
 *       Cr 2000 Payable (total)
 *       Cr 4200 Discount Received  (invoice-level discount)
 *       Dr 5100 Direct Expenses    (additional charges, e.g. freight inward)
 *       Dr/Cr 5030 Round Off       (+ / -)
 *   Purchase return / purchase-side debit note: the purchase invoice with every
 *     line reversed, the purchases leg going to 5010 Purchase Returns.
 *
 * Why the adjustment lines exist: `total_amount` is
 *   subtotal + tax - invoice discount + additional charges + round-off,
 * so a receivable/payable posted at the total only balances against
 * subtotal + tax when those three are zero.
 */

import { money } from "@hisaabo/shared";
import {
  DISCOUNT_ALLOWED_CODE,
  OTHER_CHARGES_CODE,
  ROUND_OFF_CODE,
} from "./coa-seed.js";
import type { DerivedEntryLine } from "./derive-ledger.js";

// ── Chart-of-accounts helpers ───────────────────────────────────

export interface LedgerAccount {
  id: string;
  code: string;
  name: string;
}

export type CoaMap = Map<string, LedgerAccount>;

/** Look up an account by code; throws if missing (indicates seed data problem). */
export function getAccount(coa: CoaMap, code: string): LedgerAccount {
  const acct = coa.get(code);
  if (!acct) {
    throw new Error(`Chart of Accounts is missing required account code "${code}". Run the CoA seed first.`);
  }
  return acct;
}

/**
 * Account for an invoice-level adjustment (round-off, discount, charges).
 *
 * Prefer the SYSTEM account at `code`. When it is missing, inactive, or the
 * code was taken by a user-created account (so it may be of any type), fall
 * back to a long-standing seeded account of the right type instead of throwing:
 * the books must stay readable, and these are P&L lines, so the totals do not
 * change, only which row they sit on.
 */
function adjustmentAccount(
  coa: CoaMap,
  systemCodes: ReadonlySet<string>,
  code: string,
  fallbackCode: string,
): LedgerAccount {
  const preferred = coa.get(code);
  if (preferred && systemCodes.has(code)) return preferred;
  return getAccount(coa, fallbackCode);
}

export function debitLine(account: LedgerAccount, amount: string): DerivedEntryLine {
  return {
    accountId: account.id,
    accountCode: account.code,
    accountName: account.name,
    debit: amount,
    credit: "0.00",
  };
}

export function creditLine(account: LedgerAccount, amount: string): DerivedEntryLine {
  return {
    accountId: account.id,
    accountCode: account.code,
    accountName: account.name,
    debit: "0.00",
    credit: amount,
  };
}

// ── Document classification ─────────────────────────────────────

export type LedgerSide = "sale" | "purchase";

/**
 * - `invoice`   the original sale / purchase invoice
 * - `addition`  a sale-side debit note: more is owed to us, posted like a sale
 * - `reversal`  credit note, sales return, purchase return, purchase-side debit
 *               note: undoes part of a sale or purchase
 */
export type LedgerDocumentKind = "invoice" | "addition" | "reversal";

export interface LedgerDocumentClass {
  side: LedgerSide;
  kind: LedgerDocumentKind;
}

/**
 * The single answer to "how does this document move the books", used by the
 * ledger, the GSTR-1 / GSTR-3B / GSTR-9 generators and the party balances.
 * `null` for quotations, proformas, delivery challans and anything else that
 * never posts.
 *
 * The side is decided by the document's `type` (the type of the invoice it
 * adjusts), not by its name: the apps create a credit note or a sales return
 * from a PURCHASE invoice with `type = "purchase"`, and such a document
 * reverses the purchase (Dr Payable / Cr Purchase Returns / Cr Input GST), not
 * a sale.
 *
 *   invoice                                       -> `invoice`, side by type
 *   credit_note, sales_return, purchase_return    -> `reversal`, side by type
 *   debit_note, type sale                         -> sale `addition`: the buyer owes us more
 *   debit_note, type purchase                     -> purchase `reversal`: we debit the
 *       supplier, so we owe less and our input credit falls, like a purchase return
 */
export function classifyLedgerDocument(documentType: string, type: string): LedgerDocumentClass | null {
  const side: LedgerSide = type === "purchase" ? "purchase" : "sale";
  switch (documentType) {
    case "invoice":
      return { side, kind: "invoice" };
    case "credit_note":
    case "sales_return":
    case "purchase_return":
      return { side, kind: "reversal" };
    case "debit_note":
      return side === "purchase" ? { side, kind: "reversal" } : { side, kind: "addition" };
    default:
      return null;
  }
}

/** Human label used in journal narrations. */
export function ledgerDocumentLabel(documentType: string, type: string): string {
  switch (documentType) {
    case "credit_note": return "Credit Note";
    case "sales_return": return "Sales Return";
    case "debit_note": return "Debit Note";
    case "purchase_return": return "Purchase Return";
    default: return type === "purchase" ? "Purchase Invoice" : "Sale Invoice";
  }
}

// ── Invoice-level adjustments ───────────────────────────────────

export interface DocumentAdjustments {
  /** Invoice-level discount, never negative. */
  discount: string;
  /** Additional charges (freight, packing, ...), never negative. */
  charges: string;
  /** Round-off, signed: positive raised the total, negative lowered it. */
  roundOff: string;
}

export interface AdjustableDocument {
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  discountAmount?: string | null;
  additionalCharges?: string | null;
  roundOff?: string | null;
}

/**
 * Split what lies between `subtotal + tax` and `total` into discount, charges
 * and round-off.
 *
 * The stored columns are used when they EXPLAIN the difference
 * (`charges + roundOff - discount === total - subtotal - tax`), which is always
 * true for documents the app computed with `calcInvoiceTotals`. Rows where the
 * columns disagree with the stored total (older imports, legacy
 * `additionalCharges` that never reached the total, a `round_off` stored on a
 * document whose total excludes it) are not guessed at: the whole difference is
 * posted as round-off, so the entry always balances and net profit stays right.
 */
export function splitDocumentAdjustments(doc: AdjustableDocument): DocumentAdjustments {
  const residual = money.sub(money.sub(doc.totalAmount, doc.subtotal), doc.taxAmount);
  const discount = money.add(doc.discountAmount ?? "0", "0");
  const charges = money.add(doc.additionalCharges ?? "0", "0");
  const roundOff = money.add(doc.roundOff ?? "0", "0");

  const explained = money.sub(money.add(charges, roundOff), discount);
  const columnsAreSane = money.compare(discount, "0") >= 0 && money.compare(charges, "0") >= 0;
  if (columnsAreSane && money.compare(explained, residual) === 0) {
    return { discount, charges, roundOff };
  }
  return { discount: "0.00", charges: "0.00", roundOff: residual };
}

// ── Posting ─────────────────────────────────────────────────────

export interface LedgerDocument extends AdjustableDocument {
  documentType: string;
  type: string;
}

export interface PostingContext {
  coa: CoaMap;
  /** Codes of the business's active SYSTEM accounts. */
  systemCodes: ReadonlySet<string>;
  /** Intra-state supply: GST posts as CGST + SGST, otherwise IGST. */
  sameState: boolean;
}

/**
 * The balanced journal lines for one document, or `null` when the document type
 * never posts. Throws only when a long-standing seeded account (1100, 2000,
 * 4000, ...) is missing, like the rest of the ledger.
 */
export function buildDocumentLines(doc: LedgerDocument, cx: PostingContext): DerivedEntryLine[] | null {
  const cls = classifyLedgerDocument(doc.documentType, doc.type);
  if (!cls) return null;

  const { coa, systemCodes, sameState } = cx;
  const isSale = cls.side === "sale";
  const reversal = cls.kind === "reversal";
  const lines: DerivedEntryLine[] = [];

  /** Post `amount` on `account`; `normal` is the side it takes on the ORIGINAL document, flipped for a reversal. */
  const post = (account: LedgerAccount, amount: string, normal: "dr" | "cr") => {
    const side = reversal ? (normal === "dr" ? "cr" : "dr") : normal;
    lines.push(side === "dr" ? debitLine(account, amount) : creditLine(account, amount));
  };

  const tax = money.isPositive(doc.taxAmount) ? doc.taxAmount : null;
  const taxLines = (accounts: [string, string, string], normal: "dr" | "cr") => {
    if (!tax) return;
    if (sameState) {
      const [cgst, sgst] = money.splitHalf(tax);
      post(getAccount(coa, accounts[0]), cgst, normal);
      post(getAccount(coa, accounts[1]), sgst, normal);
    } else {
      post(getAccount(coa, accounts[2]), tax, normal);
    }
  };

  if (isSale) {
    // Original: Dr Receivable / Cr Sales + Output GST. A reversal posts Dr Sales Returns instead of Cr Sales.
    post(getAccount(coa, "1100"), doc.totalAmount, "dr");
    post(getAccount(coa, reversal ? "4010" : "4000"), doc.subtotal, "cr");
    taxLines(["2100", "2101", "2102"], "cr");
  } else {
    // Original: Dr Purchases + Input GST / Cr Payable. A reversal posts Cr Purchase Returns instead of Dr Purchases.
    post(getAccount(coa, reversal ? "5010" : "5000"), doc.subtotal, "dr");
    taxLines(["1510", "1511", "1512"], "dr");
    post(getAccount(coa, "2000"), doc.totalAmount, "cr");
  }

  const adj = splitDocumentAdjustments(doc);

  if (money.isPositive(adj.discount)) {
    // Sale: a discount we gave is an expense (Dr). Purchase: a discount we got is income (Cr).
    const account = isSale
      ? adjustmentAccount(coa, systemCodes, DISCOUNT_ALLOWED_CODE, "5990")
      : adjustmentAccount(coa, systemCodes, "4200", "4100");
    post(account, adj.discount, isSale ? "dr" : "cr");
  }

  if (money.isPositive(adj.charges)) {
    // Sale: charges we bill are income (Cr). Purchase: charges the supplier bills are a direct cost (Dr).
    const account = isSale
      ? adjustmentAccount(coa, systemCodes, OTHER_CHARGES_CODE, "4100")
      : adjustmentAccount(coa, systemCodes, "5100", "5990");
    post(account, adj.charges, isSale ? "cr" : "dr");
  }

  if (!money.isZero(adj.roundOff)) {
    // A positive round-off raises the total: on a sale that is extra income (Cr), on a purchase extra cost (Dr).
    const roundOffAccount = adjustmentAccount(coa, systemCodes, ROUND_OFF_CODE, "5990");
    const positive = money.isPositive(adj.roundOff);
    const magnitude = positive ? adj.roundOff : money.sub("0", adj.roundOff);
    const normal = isSale ? "cr" : "dr";
    post(roundOffAccount, magnitude, positive ? normal : normal === "cr" ? "dr" : "cr");
  }

  return lines;
}
