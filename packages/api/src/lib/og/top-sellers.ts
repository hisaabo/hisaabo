import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { invoices, invoiceItems, items, itemImages } from "@hisaabo/db";
import type { OgSeller } from "./types.js";

type Db = any; // tenant db handle — typed as the shared Drizzle instance at call sites

/** How many products the OG card features. */
export const OG_SELLER_LIMIT = 4;

/** Sales window for "top sellers" — last 30 days. */
const SALES_WINDOW_DAYS = 30;

/**
 * Merge sales-ranked sellers with catalog fallback, deduped, capped at `limit`.
 * Pure so the cold-start / sparse-sales behaviour is unit-testable: ranked
 * items come first (preserving their order), then fallback items fill any
 * remaining slots without repeating an item already chosen.
 */
export function mergeWithFallback(
  ranked: OgSeller[],
  fallback: OgSeller[],
  limit: number = OG_SELLER_LIMIT,
): OgSeller[] {
  const out: OgSeller[] = [];
  const seen = new Set<string>();
  for (const s of [...ranked, ...fallback]) {
    if (seen.has(s.itemId)) continue;
    seen.add(s.itemId);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

/** Attach the primary image (storageKey/mime/version) to each seller, in place. */
function applyPrimaryImages(
  sellers: OgSeller[],
  imageRows: Array<{
    itemId: string;
    storageKey: string;
    mimeType: string;
    isPrimary: boolean;
    sortOrder: number;
    updatedAt: Date | null;
  }>,
): void {
  // First isPrimary wins; else lowest sortOrder. Rows arrive ordered by
  // (isPrimary desc, sortOrder asc) from the query.
  const byItem = new Map<string, (typeof imageRows)[number]>();
  for (const row of imageRows) {
    if (!byItem.has(row.itemId)) byItem.set(row.itemId, row);
  }
  for (const s of sellers) {
    const img = byItem.get(s.itemId);
    if (img) {
      s.imageStorageKey = img.storageKey;
      s.imageMimeType = img.mimeType;
      s.imageVersion = img.updatedAt?.getTime() ?? 0;
    }
  }
}

/**
 * Select the store's top sellers for the OG card.
 *
 * Ranking: quantity sold over the last 30 days, joining
 * invoice_items → invoices for the business. Only store-enabled, non-deleted
 * items are eligible (we have to be able to show them). When sales are sparse
 * — a brand-new store, say — we fall back to catalog order so the card is
 * never empty.
 */
export async function selectTopSellers(
  db: Db,
  businessId: string,
  limit: number = OG_SELLER_LIMIT,
): Promise<OgSeller[]> {
  // 1. Sales rank over the window. Group by item, sum quantity.
  const rankedRows: Array<{ itemId: string }> = await db
    .select({ itemId: invoiceItems.itemId })
    .from(invoiceItems)
    .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
    .where(
      and(
        eq(invoices.businessId, businessId),
        isNull(invoices.deletedAt),
        sql`${invoiceItems.itemId} IS NOT NULL`,
        sql`${invoices.invoiceDate} >= now() - ${`${SALES_WINDOW_DAYS} days`}::interval`,
      ),
    )
    .groupBy(invoiceItems.itemId)
    .orderBy(desc(sql`sum(${invoiceItems.quantity})`))
    .limit(limit * 3); // over-fetch; some may be disabled/deleted

  const rankedIds = rankedRows.map((r) => r.itemId).filter(Boolean) as string[];

  // 2. Resolve ranked ids to store-visible items, preserving rank order.
  const baseSelect = {
    itemId: items.id,
    name: items.name,
    price: sql<string | null>`COALESCE(${items.storePrice}, ${items.salePrice})`,
  };
  const storeItemFilter = and(
    eq(items.businessId, businessId),
    eq(items.storeEnabled, true),
    isNull(items.deletedAt),
  );

  let rankedSellers: OgSeller[] = [];
  if (rankedIds.length > 0) {
    const rows: Array<{ itemId: string; name: string; price: string | null }> = await db
      .select(baseSelect)
      .from(items)
      .where(and(storeItemFilter, inArray(items.id, rankedIds)));
    const byId = new Map(rows.map((r) => [r.itemId, r]));
    rankedSellers = rankedIds
      .map((id) => byId.get(id))
      .filter((r): r is { itemId: string; name: string; price: string | null } => Boolean(r))
      .map((r) => ({ ...r, imageStorageKey: null, imageMimeType: null, imageVersion: 0 }));
  }

  // 3. Catalog fallback (by store sort order) to fill remaining slots.
  let fallbackSellers: OgSeller[] = [];
  if (rankedSellers.length < limit) {
    const rows: Array<{ itemId: string; name: string; price: string | null }> = await db
      .select(baseSelect)
      .from(items)
      .where(storeItemFilter)
      .orderBy(items.storeSortOrder, items.name)
      .limit(limit * 2);
    fallbackSellers = rows.map((r) => ({
      ...r,
      imageStorageKey: null,
      imageMimeType: null,
      imageVersion: 0,
    }));
  }

  const sellers = mergeWithFallback(rankedSellers, fallbackSellers, limit);
  if (sellers.length === 0) return sellers;

  // 4. Attach primary images for the chosen sellers.
  const chosenIds = sellers.map((s) => s.itemId);
  const imageRows = await db
    .select({
      itemId: itemImages.itemId,
      storageKey: itemImages.storageKey,
      mimeType: itemImages.mimeType,
      isPrimary: itemImages.isPrimary,
      sortOrder: itemImages.sortOrder,
      updatedAt: itemImages.updatedAt,
    })
    .from(itemImages)
    .where(and(inArray(itemImages.itemId, chosenIds), isNull(itemImages.deletedAt)))
    .orderBy(desc(itemImages.isPrimary), itemImages.sortOrder);

  applyPrimaryImages(sellers, imageRows);
  return sellers;
}
