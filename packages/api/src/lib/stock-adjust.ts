import { and, eq, sql, type SQL } from "drizzle-orm";
import { items, itemVariants } from "@hisaabo/db";
import type { TenantDatabase } from "../trpc.js";

type StockTx = Parameters<Parameters<TenantDatabase["transaction"]>[0]>[0];

export interface StockLine {
  itemId?: string | null;
  variantId?: string | null;
  /** NUMERIC string, as stored on the line item. */
  quantity: string;
  /** Alt-unit conversion factor; applies to item lines only (variants are never converted). */
  conversionFactor?: string | null;
  /** +1 adds `quantity` to stock, -1 removes it. */
  sign: 1 | -1;
}

/**
 * Apply stock deltas for a set of line items with at most one UPDATE per table.
 *
 * A line with a variantId adjusts that variant only (by `quantity`); otherwise a
 * line with an itemId adjusts the item by `quantity * conversionFactor`; lines
 * with neither are ignored. Deltas for the same item/variant are summed in SQL
 * NUMERIC (never JS floats) and rows are updated in id order so concurrent
 * transactions lock in a consistent order. When `businessId` is given, rows are
 * scoped to that business. Empty input issues no query.
 */
export async function applyStockDeltas(
  tx: StockTx,
  lines: readonly StockLine[],
  opts: { businessId?: string } = {},
): Promise<void> {
  const itemRows = new Map<string, SQL[]>();
  const variantRows = new Map<string, SQL[]>();
  for (const li of lines) {
    if (li.variantId) {
      const rows = variantRows.get(li.variantId) ?? [];
      rows.push(sql`(${li.variantId}::uuid, ${li.quantity}::numeric * ${li.sign}::numeric)`);
      variantRows.set(li.variantId, rows);
    } else if (li.itemId) {
      const cf = li.conversionFactor || "1";
      const rows = itemRows.get(li.itemId) ?? [];
      rows.push(sql`(${li.itemId}::uuid, ${li.quantity}::numeric * ${cf}::numeric * ${li.sign}::numeric)`);
      itemRows.set(li.itemId, rows);
    }
  }

  const deltas = (rows: Map<string, SQL[]>) => sql`(
    SELECT d.id, SUM(d.delta) AS delta
    FROM (VALUES ${sql.join([...rows.keys()].sort().flatMap((id) => rows.get(id)!), sql`, `)}) AS d(id, delta)
    GROUP BY d.id
    ORDER BY d.id
  ) AS v`;

  if (itemRows.size > 0) {
    await tx.update(items).set({
      stockQuantity: sql`${items.stockQuantity}::numeric + v.delta`,
      updatedAt: new Date(),
    }).from(deltas(itemRows)).where(and(
      sql`${items.id} = v.id`,
      opts.businessId ? eq(items.businessId, opts.businessId) : undefined,
    ));
  }

  if (variantRows.size > 0) {
    await tx.update(itemVariants).set({
      stockQuantity: sql`${itemVariants.stockQuantity}::numeric + v.delta`,
      updatedAt: new Date(),
    }).from(deltas(variantRows)).where(and(
      sql`${itemVariants.id} = v.id`,
      opts.businessId
        ? sql`EXISTS (SELECT 1 FROM items WHERE items.id = ${itemVariants.itemId} AND items.business_id = ${opts.businessId})`
        : undefined,
    ));
  }
}
