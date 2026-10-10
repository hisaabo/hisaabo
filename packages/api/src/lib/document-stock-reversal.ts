import { eq } from "drizzle-orm";
import { invoiceItems } from "@hisaabo/db";
import type { TenantDatabase } from "../trpc.js";
import { applyStockDeltas } from "./stock-adjust.js";

type DocTx = Parameters<Parameters<TenantDatabase["transaction"]>[0]>[0];

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
  stockEffect: "none" | "decrement" | "increment",
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
