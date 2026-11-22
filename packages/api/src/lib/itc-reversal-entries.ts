/**
 * itc-reversal-entries.ts — keep the ITC ledger (`itc_ledger_entries`) in step with
 * purchase-side reversals.
 *
 * A purchase invoice writes an "available" ITC entry when it is created
 * (routers/invoice.ts). A purchase return, a purchase-side debit note, or a
 * credit note / sales return raised from a purchase invoice (type = "purchase",
 * see `classifyLedgerDocument`) takes input credit back, and GSTR-3B Table 4
 * already nets it. Without a matching ledger entry the ITC dashboard and the
 * available balance that `itc.recordUtilization` validates against stayed gross,
 * so a utilisation could exceed the credit the return actually leaves.
 *
 * So the same moment a purchase-side reversal is created it writes a NEGATIVE
 * "available" entry (CGST / SGST / IGST taken back, split with the one shared
 * rule) in the return period of the document date, linked to the reversal
 * document; cancelling or deleting the document removes it again. Sums over
 * "available" entries then give the netted credit, exactly like the return.
 * Composition-scheme businesses get no ITC entries at all, as on the invoice path.
 */

import { and, eq } from "drizzle-orm";
import { businesses, itcLedgerEntries, parties } from "@hisaabo/db";
import { money, splitDocumentGst } from "@hisaabo/shared";
import { classifyLedgerDocument } from "./ledger-documents.js";

// A Drizzle transaction (tenant DB).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

/** True when the document takes input credit back (a purchase-side reversal). */
export function isPurchaseReversal(documentType: string, type: string): boolean {
  const cls = classifyLedgerDocument(documentType, type);
  return cls?.side === "purchase" && cls.kind === "reversal";
}

/**
 * Write the negative ITC entry for a just-created purchase-side reversal.
 * No-op for any other document, for a document without GST, and for a
 * composition-scheme business.
 */
export async function recordPurchaseReversalItc(
  tx: Tx,
  p: {
    businessId: string;
    documentId: string;
    documentType: string;
    type: string;
    partyId: string;
    documentDate: Date;
    taxTotal: string;
    lineTaxes: string[];
  },
): Promise<void> {
  if (!isPurchaseReversal(p.documentType, p.type)) return;
  if (!money.isPositive(p.taxTotal)) return;

  const [biz] = await tx
    .select({ gstRegistrationType: businesses.gstRegistrationType, stateCode: businesses.stateCode })
    .from(businesses)
    .where(eq(businesses.id, p.businessId))
    .limit(1);
  if (biz?.gstRegistrationType === "composition") return;

  const [party] = await tx
    .select({ stateCode: parties.stateCode })
    .from(parties)
    .where(and(eq(parties.id, p.partyId), eq(parties.businessId, p.businessId)))
    .limit(1);
  const sameState = !!(biz?.stateCode && party?.stateCode && biz.stateCode === party.stateCode);

  let cgst = "0";
  let sgst = "0";
  let igst = "0";
  if (sameState) {
    const [c, s] = splitDocumentGst(p.taxTotal, p.lineTaxes);
    cgst = money.sub("0", c);
    sgst = money.sub("0", s);
  } else {
    igst = money.sub("0", p.taxTotal);
  }

  const d = p.documentDate;
  await tx.insert(itcLedgerEntries).values({
    businessId: p.businessId,
    invoiceId: p.documentId,
    returnPeriod: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
    status: "available",
    cgst,
    sgst,
    igst,
    cess: "0",
    isReverseCharge: false,
    notes: "Input credit taken back by a purchase return / purchase-side note",
  });
}

/** Remove the ITC entry of a purchase-side reversal that is being cancelled or deleted. */
export async function removePurchaseReversalItc(
  tx: Tx,
  businessId: string,
  doc: { id: string; documentType: string; type: string },
): Promise<void> {
  if (!isPurchaseReversal(doc.documentType, doc.type)) return;
  await tx
    .delete(itcLedgerEntries)
    .where(and(eq(itcLedgerEntries.businessId, businessId), eq(itcLedgerEntries.invoiceId, doc.id)));
}
