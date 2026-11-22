import { isRunningLow, variantsRunningLow } from "./store-stock.js";

/**
 * Turns the catalog's database rows into the public item shape of
 * `GET /store/:slug/catalog.json`. This is the one place that decides what a
 * customer may see of an item, so it lives apart from server.ts (which starts
 * listening on import and cannot be loaded by tests).
 *
 * NEVER expose: purchasePrice, exact stock quantities, alert levels, hsn, sku
 * or internal business fields. Quantities and alert levels come in only to
 * derive the booleans `inStock`, `lowStock` and `runningLow`, and are dropped.
 */

export interface CatalogRow {
  id: string;
  itemMode: string;
  price: string | null;
  inStock: boolean;
  /** Internal: dropped from the output. */
  stockQty: string;
  /** Internal: dropped from the output. */
  lowStockAlert: string | null;
  /** Internal: dropped from the output. */
  itemType: "product" | "service";
  unitVariants: Array<{ unit: string; conversionFactor: number; salePrice: string; purchasePrice?: string }> | null;
  variantAttributes: string[] | null;
}

export interface CatalogVariantRow {
  id: string;
  itemId: string;
  attributeValues: Record<string, string>;
  salePrice: string | null;
  storePrice: string | null;
  /** Internal: dropped from the output. */
  stockQuantity: string;
  /** Internal: dropped from the output. */
  lowStockAlert: string | null;
}

export interface CatalogImage {
  id: string;
  variantId: string | null;
  isPrimary: boolean;
  sortOrder: number;
  alt: string | null;
  url: string;
}

export interface CatalogContext {
  /** The store accepts orders for items with no stock on hand. */
  allowNegativeStock: boolean;
  variantsByItem: ReadonlyMap<string, CatalogVariantRow[]>;
  imagesByItem: ReadonlyMap<string, CatalogImage[]>;
}

export function toPublicCatalogItems<R extends CatalogRow>(rows: R[], ctx: CatalogContext) {
  const allowNeg = ctx.allowNegativeStock;
  return rows
    .filter((item) => {
      // Variant items must have at least one store-enabled variant to appear
      if (item.itemMode === "variants") {
        const variants = ctx.variantsByItem.get(item.id);
        return variants && variants.length > 0;
      }
      return true;
    })
    .map(({ stockQty, lowStockAlert, itemType, unitVariants: rawUnitVariants, variantAttributes: rawVarAttrs, ...rest }) => {
      const images = ctx.imagesByItem.get(rest.id) ?? [];
      const primary = images.find((im) => im.isPrimary) ?? images[0];
      const base = {
        ...rest,
        inStock: rest.inStock || allowNeg,
        // "None on hand, orders accepted" (kept as is: integrators read it as "orderable"). NOT "running low".
        lowStock: allowNeg && !rest.inStock,
        // Tracked stock on hand at or below the owner's alert level. Additive: clients that do not know it ignore it.
        runningLow: isRunningLow({ stockQuantity: stockQty, lowStockAlert, itemType }),
        images,
        // Convenience thumbnail for the catalog grid + share/OG fallback.
        primaryImageUrl: primary?.url ?? null,
      };

      if (rest.itemMode === "alt_units" && rawUnitVariants) {
        // Expose unit variants with store-safe prices only
        return {
          ...base,
          unitVariants: rawUnitVariants.map((uv) => ({
            unit: uv.unit,
            conversionFactor: uv.conversionFactor,
            price: uv.salePrice,
          })),
        };
      }

      if (rest.itemMode === "variants") {
        const variants = ctx.variantsByItem.get(rest.id) || [];
        const variantData = variants.map((v) => ({
          id: v.id,
          attributes: v.attributeValues,
          price: v.storePrice ?? v.salePrice ?? "0",
          inStock: parseFloat(v.stockQuantity) > 0 || allowNeg,
          runningLow: isRunningLow({ stockQuantity: v.stockQuantity, lowStockAlert: v.lowStockAlert, itemType }),
        }));
        // Price = lowest variant price (for display/sorting)
        const prices = variantData.map((v) => parseFloat(v.price));
        const lowestPrice = prices.length > 0 ? Math.min(...prices).toFixed(2) : base.price;
        // inStock = true if ANY variant is in stock
        const anyInStock = variantData.some((v) => v.inStock);

        return {
          ...base,
          price: lowestPrice,
          inStock: anyInStock,
          lowStock: allowNeg && !anyInStock,
          // Stock lives on the variants: low only when everything still buyable is low.
          runningLow: variantsRunningLow(variantData),
          variantAttributes: rawVarAttrs || [],
          variants: variantData,
        };
      }

      return base;
    });
}
