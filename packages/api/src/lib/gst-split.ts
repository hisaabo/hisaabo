/**
 * gst-split.ts — the intra-state CGST / SGST split of a whole document, in one
 * place.
 *
 * The rule is the e-invoice (IRP) one, because the IRP-signed e-invoice is what
 * the government holds: split EACH LINE's tax with `money.splitHalf` (CGST =
 * round-half-up(tax / 2), SGST = the remainder) and add the lines up
 * (`splitGstByLine` in @hisaabo/shared). The ledger, the ITC ledger, GSTR-1 /
 * 3B / 9, the invoice PDF and the e-way bill all go through it, so one invoice
 * never reports two different CGST / SGST figures.
 *
 * Two ways to get at a document's line taxes:
 *   - in memory (`splitDocumentGst` in @hisaabo/shared) when the lines are already loaded
 *   - one grouped query (`loadLineGstSplits`) when only documents are loaded
 *     (the derived ledger, GSTR-3B purchases): it sums the per-line split in
 *     SQL, so a report over years of invoices fetches one small row per invoice
 *     instead of every line.
 * Both fall back to splitting the document's tax as one amount when the line
 * taxes do not add up to it (a document without line items, a legacy import).
 */

import { and, eq, sql, type SQL } from "drizzle-orm";
import { invoiceItems, invoices } from "@hisaabo/db";
import { money } from "@hisaabo/shared";

/** What the lines of one document add up to, in integer paise. */
export interface LineGstSplit {
  /** Sum of the line taxes. */
  taxPaise: number;
  /** Sum over the lines of ceil(line tax / 2): the document's CGST. */
  cgstPaise: number;
}

/** [CGST, SGST] of a document from the grouped line sums, falling back to one split of `taxAmount`. */
export function documentGstSplit(taxAmount: string, line?: LineGstSplit | null): [string, string] {
  const tax = money.add(taxAmount, "0");
  if (line && line.taxPaise === Math.round(money.toNumber(tax) * 100)) {
    const cgst = money.add(line.cgstPaise / 100, "0");
    return [cgst, money.sub(tax, cgst)];
  }
  return money.splitHalf(tax);
}

/**
 * The per-document line sums of every invoice-table row matching `where`
 * (conditions on `invoices`, e.g. the date filter, or `inArray(invoices.id, ids)`),
 * scoped to the business. Documents without line items are simply absent.
 */
export async function loadLineGstSplits(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  businessId: string,
  where: SQL[],
): Promise<Map<string, LineGstSplit>> {
  const rows: Array<{ invoiceId: string; taxPaise: string; cgstPaise: string }> = await db
    .select({
      invoiceId: invoiceItems.invoiceId,
      taxPaise: sql<string>`COALESCE(SUM(ROUND(${invoiceItems.taxAmount}::numeric * 100)), 0)::text`,
      cgstPaise: sql<string>`COALESCE(SUM(CEIL(ROUND(${invoiceItems.taxAmount}::numeric * 100) / 2)), 0)::text`,
    })
    .from(invoiceItems)
    .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
    .where(and(eq(invoices.businessId, businessId), ...where))
    .groupBy(invoiceItems.invoiceId);
  return new Map(
    rows.map((r) => [r.invoiceId, { taxPaise: Number(r.taxPaise), cgstPaise: Number(r.cgstPaise) }]),
  );
}
