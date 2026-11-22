/**
 * Stock signals of the public store catalog (`GET /store/:slug/catalog.json`).
 *
 * `lowStock` (server.ts) is NOT "running low": it is `allowNegativeStock &&
 * !inStock`, i.e. "none on hand, but this store takes orders anyway". A store
 * that holds no inventory therefore reports it on every item. It is kept as it
 * is for compatibility (cart links and integrators read it as "orderable").
 *
 * `runningLow` is the signal a "Low stock" badge needs. It is true only when
 * the item (or variant) tracks stock, some is on hand, and it is at or below
 * the owner's own alert level:
 *
 *   itemType is "product"  AND  stockQuantity > 0  AND  lowStockAlert is set
 *   AND  stockQuantity <= lowStockAlert
 *
 * Never true for an out-of-stock item (that is "sold out", or "orderable with
 * none on hand"), for a service, or for an item with no alert level. The
 * alert level and the quantity themselves are never sent.
 *
 * Pure and free of the database so the rule can be tested directly; server.ts
 * (which starts listening on import) calls it.
 */

export interface StockRow {
  /** numeric(15,3) as a decimal string, e.g. "12.500". */
  stockQuantity: string;
  /** numeric(15,3) as a decimal string, or null when the owner set no alert level. */
  lowStockAlert: string | null;
  /** Services do not track stock. A variant is judged with its parent's type. */
  itemType: "product" | "service";
}

export function isRunningLow(row: StockRow): boolean {
  if (row.itemType !== "product") return false;
  if (row.lowStockAlert === null || row.lowStockAlert === "") return false;
  const quantity = parseFloat(row.stockQuantity);
  const alert = parseFloat(row.lowStockAlert);
  if (!Number.isFinite(quantity) || !Number.isFinite(alert)) return false;
  return quantity > 0 && quantity <= alert;
}

/**
 * Item-level `runningLow` for an item sold in variants. Stock lives on the
 * variants, so the item is running low only when everything still available
 * is: at least one variant can be bought, and every one that can be is running
 * low. One low variant among plentiful ones is not a low item, and a variant
 * that is merely orderable (none on hand) is not low at all.
 */
export function variantsRunningLow(variants: ReadonlyArray<{ inStock: boolean; runningLow: boolean }>): boolean {
  const available = variants.filter((v) => v.inStock);
  return available.length > 0 && available.every((v) => v.runningLow);
}
