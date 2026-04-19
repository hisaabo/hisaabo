import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { items, itemVariants } from "@hisaabo/db";
import { router, viewerProcedure } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";
import { escapeLike } from "../lib/escape-like.js";

/**
 * Point-of-Sale tRPC router.
 *
 * Right now it exposes a single procedure — `pos.catalog` — that returns a
 * flat list of "sellable tiles" for the cashier's grid. One tile = one
 * billable SKU the cashier can tap to add to the cart.
 *
 *   simple item     → 1 tile (uses item.salePrice, item.stockQuantity, item.unit)
 *   alt_units item  → N tiles (one per unitVariants entry; each has its own
 *                     price and displays stock converted into its unit)
 *   variants item   → N tiles (one per itemVariants row; each has its own
 *                     SKU, price, and stock)
 *
 * We expand here on the server rather than making the UI deal with three
 * different card layouts. The server is closer to the data and can do the
 * conversion math once.
 */

// ── Shapes ────────────────────────────────────────────────────────

export interface POSCatalogTile {
  /** Stable unique key for React rendering and the cart's dedup match. */
  tileKey: string;
  /** The items.id row this tile bills against. */
  itemId: string;
  /** Only set for variant items; null for simple and alt_units. */
  variantId: string | null;
  /** Display name shown on the tile — may include unit or variant attrs. */
  displayName: string;
  /** Unit the cashier will bill in (e.g. "kg", "g", "pcs"). */
  unit: string;
  /** Unit price in this unit. String so TS doesn't introduce float drift. */
  unitPrice: string;
  /** Stock shown to the cashier, expressed in `unit`. */
  stockQuantity: string;
  /** Tax rate — pulled from items.taxPercent (all units of one item share it). */
  taxPercent: string;
  /**
   * Conversion factor the server needs to decrement base-unit stock.
   * "1" for simple items and variant rows; varies for alt_units.
   */
  conversionFactor: string;
  /** Item mode — UI may want to render a small badge for variants. */
  itemMode: "simple" | "alt_units" | "variants";
  /** Optional — shown as a subtitle; useful for barcode match hinting. */
  sku: string | null;
}

interface UnitVariantEntry {
  unit: string;
  conversionFactor: number;
  salePrice?: string | null;
}

// ── Router ────────────────────────────────────────────────────────

export const posRouter = router({
  /**
   * POS catalog — expanded tiles for the register grid.
   *
   * Scope: `viewerProcedure` (any authenticated member of the business).
   * Sellers must be able to ring up sales even if they can't edit the
   * item catalog. `requireCan(..., "read", "Item")` still applies.
   */
  catalog: viewerProcedure
    .input(
      z.object({
        search: z.string().nullish(),
        page: z.number().int().positive().default(1),
        limit: z.number().int().positive().max(200).default(60),
      }),
    )
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Item");

      // 1. Fetch matching items. POS is a product-sales surface — services
      //    are billable but don't belong in a tile grid (no stock, no scan).
      const conditions = [
        eq(items.businessId, ctx.businessId),
        isNull(items.deletedAt),
        eq(items.itemType, "product"),
      ];
      if (input.search) {
        const pat = `%${escapeLike(input.search)}%`;
        // Match on name or SKU — SKU doubles as a barcode fallback in v1.
        conditions.push(or(ilike(items.name, pat), ilike(items.sku, pat))!);
      }

      const offset = (input.page - 1) * input.limit;
      const rows = await ctx.db
        .select()
        .from(items)
        .where(and(...conditions))
        .orderBy(desc(items.updatedAt))
        .limit(input.limit)
        .offset(offset);

      // 2. For variant items, fetch individual variants in one batched query
      //    so the final fan-out doesn't issue N+1 queries.
      const variantItemIds = rows.filter((r) => r.itemMode === "variants").map((r) => r.id);
      const variantRows =
        variantItemIds.length > 0
          ? await ctx.db
              .select()
              .from(itemVariants)
              .where(
                and(
                  sql`${itemVariants.itemId} IN (${sql.join(
                    variantItemIds.map((id) => sql`${id}`),
                    sql`, `,
                  )})`,
                  isNull(itemVariants.deletedAt),
                ),
              )
          : [];
      const variantsByItem = new Map<string, typeof variantRows>();
      for (const v of variantRows) {
        const bucket = variantsByItem.get(v.itemId) ?? [];
        bucket.push(v);
        variantsByItem.set(v.itemId, bucket);
      }

      // 3. Fan out into tiles.
      const tiles: POSCatalogTile[] = [];
      for (const item of rows) {
        if (item.itemMode === "variants") {
          const list = variantsByItem.get(item.id) ?? [];
          for (const v of list) {
            const attrs = Object.values(v.attributeValues ?? {}).filter(Boolean).join(" / ");
            tiles.push({
              tileKey: `v:${v.id}`,
              itemId: item.id,
              variantId: v.id,
              displayName: attrs ? `${item.name} — ${attrs}` : item.name,
              unit: item.unit,
              unitPrice: v.salePrice ?? item.salePrice ?? "0",
              stockQuantity: v.stockQuantity ?? "0",
              taxPercent: item.taxPercent ?? "0",
              conversionFactor: "1",
              itemMode: "variants",
              sku: v.sku ?? item.sku,
            });
          }
        } else if (item.itemMode === "alt_units") {
          const altList = (item.unitVariants ?? []) as UnitVariantEntry[];
          if (altList.length === 0) {
            // Defensive: alt_units item with no configured units still gets
            // one tile with the base unit, otherwise the cashier sees nothing.
            tiles.push(simpleTile(item));
          } else {
            for (const alt of altList) {
              const factor = Number(alt.conversionFactor);
              const stockInUnit =
                factor > 0
                  ? (Number(item.stockQuantity ?? 0) / factor).toFixed(3)
                  : "0";
              tiles.push({
                tileKey: `u:${item.id}:${alt.unit}`,
                itemId: item.id,
                variantId: null,
                displayName: `${item.name} (${alt.unit})`,
                unit: alt.unit,
                unitPrice: alt.salePrice ?? item.salePrice ?? "0",
                stockQuantity: stockInUnit,
                taxPercent: item.taxPercent ?? "0",
                // Stringify explicitly — the DB column is numeric(10,4); the
                // server uses this string in UPDATE items SET stock = stock - qty*factor.
                conversionFactor: String(alt.conversionFactor),
                itemMode: "alt_units",
                sku: item.sku,
              });
            }
          }
        } else {
          tiles.push(simpleTile(item));
        }
      }

      return { tiles, page: input.page, limit: input.limit };
    }),
});

function simpleTile(item: typeof items.$inferSelect): POSCatalogTile {
  return {
    tileKey: `i:${item.id}`,
    itemId: item.id,
    variantId: null,
    displayName: item.name,
    unit: item.unit,
    unitPrice: item.salePrice ?? "0",
    stockQuantity: item.stockQuantity ?? "0",
    taxPercent: item.taxPercent ?? "0",
    conversionFactor: "1",
    itemMode: item.itemMode,
    sku: item.sku,
  };
}
