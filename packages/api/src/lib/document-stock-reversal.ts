import { eq } from "drizzle-orm";
import { invoiceItems } from "@hisaabo/db";
import type { TenantDatabase } from "../trpc.js";
import { applyStockDeltas } from "./stock-adjust.js";

type DocTx = Parameters<Parameters<TenantDatabase["transaction"]>[0]>[0];

export type StockEffect = "none" | "decrement" | "increment";

/**
 * What creating each non-invoice document type does to item stock. The single
 * source for the document routers (routers/document.ts) and for cancelling a
 * document from outside its own router (e-invoice IRN cancel), so both reverse
 * the same effect.
 */
export const DOCUMENT_STOCK_EFFECT: Record<string, StockEffect> = {
  quotation: "none",
  credit_note: "none", // financial adjustment only: no stock change
  debit_note: "none",
  delivery_challan: "decrement",
  proforma: "none",
  sales_return: "increment", // returned items come back into stock
  purchase_return: "decrement", // sending items back reduces stock
};

/**
 * Undo the stock effect a stock-affecting document (delivery challan, sales
 * return, purchase return) applied at creation. Shared by delete and cancel so
 * both reverse exactly the same effect (variants, stored alt-unit conversion
 * factor, opposite sign). Must run inside the caller's row-locked transaction,
 * and only once per document: callers skip it when the document is already
 * cancelled.
 */
export async function reverseDocumentStockEffect(
  tx: DocTx,
  businessId: string,
  invoiceId: string,
  stockEffect: StockEffect,
): Promise<void> {
  if (stockEffect === "none") return;

  const lineItems = await tx
    .select()
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, invoiceId));

  // Reverse stock per line item (batched, NUMERIC arithmetic in SQL)
  await applyStockDeltas(
    tx,
    lineItems.map((li) => ({ ...li, sign: stockEffect === "decrement" ? 1 : -1 })),
    { businessId },
  );
}
