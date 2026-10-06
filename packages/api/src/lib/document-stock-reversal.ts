import { eq, and, sql } from "drizzle-orm";
import { invoiceItems, items, itemVariants } from "@hisaabo/db";
import type { TenantDatabase } from "../trpc.js";

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

  // Reverse stock per line item using PostgreSQL NUMERIC arithmetic
  for (const li of lineItems) {
    if (li.variantId) {
      await tx.update(itemVariants).set({
        stockQuantity: stockEffect === "decrement"
          ? sql`${itemVariants.stockQuantity}::numeric + ${li.quantity}::numeric`
          : sql`${itemVariants.stockQuantity}::numeric - ${li.quantity}::numeric`,
        updatedAt: new Date(),
      }).where(and(
        eq(itemVariants.id, li.variantId),
        sql`EXISTS (SELECT 1 FROM items WHERE items.id = item_variants.item_id AND items.business_id = ${businessId})`
      ));
    } else if (li.itemId) {
      const cf = li.conversionFactor ?? "1";
      await tx.update(items).set({
        stockQuantity: stockEffect === "decrement"
          ? sql`${items.stockQuantity}::numeric + (${li.quantity}::numeric * ${cf}::numeric)`
          : sql`${items.stockQuantity}::numeric - (${li.quantity}::numeric * ${cf}::numeric)`,
        updatedAt: new Date(),
      }).where(and(eq(items.id, li.itemId), eq(items.businessId, businessId)));
    }
  }
}
