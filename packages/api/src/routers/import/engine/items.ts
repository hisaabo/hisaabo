import { items } from "@hisaabo/db";
import { and, eq, isNull } from "drizzle-orm";
import type { TenantDatabase } from "../../../trpc.js";
import type { CanonicalItem } from "../types.js";

export async function runItemsImport(
  db: TenantDatabase,
  businessId: string,
  _userId: string,
  source: string,
  canonicalItems: CanonicalItem[],
): Promise<{ created: number; skipped: number; total: number; unmappedUnits: string[] }> {
  let created = 0;
  let skipped = 0;

  // Pre-fetch all ACTIVE item names for this business into a Set for O(1)
  // lookup. The duplicate check only considers live catalog entries — a
  // re-imported row whose name matches a soft-deleted item is treated as
  // a fresh create, which is what the user wanted when they pruned the
  // old row. (If they'd wanted to keep the old one, they wouldn't have
  // soft-deleted it.)
  const existingItemNames = new Set(
    (await db.select({ name: items.name })
      .from(items).where(and(eq(items.businessId, businessId), isNull(items.deletedAt))))
      .map(r => r.name.toLowerCase())
  );

  // Track items that fell through to "other" (useful diagnostic for the caller)
  const unmappedUnits = new Set<string>();
  const newItems: (typeof items.$inferInsert)[] = [];

  for (const item of canonicalItems) {
    if (existingItemNames.has(item.name.toLowerCase())) {
      skipped++;
      continue;
    }

    if (item.unit === "other") {
      unmappedUnits.add(item.unit);
    }

    newItems.push({
      businessId,
      name: item.name,
      itemType: item.itemType,
      salePrice: item.salePrice || null,
      purchasePrice: item.purchasePrice || null,
      taxPercent: item.taxPercent || "0",
      hsn: item.hsn || null,
      unit: item.unit,
      stockQuantity: "0", // always start at 0 — stock is built from imported invoices
      sku: item.sku || null,
      category: item.category || null,
      source,
    });
    existingItemNames.add(item.name.toLowerCase());
    created++;
  }

  if (newItems.length > 0) {
    await db.transaction(async (tx) => {
      for (let i = 0; i < newItems.length; i += 500) {
        await tx.insert(items).values(newItems.slice(i, i + 500));
      }
    });
  }

  return { created, skipped, total: canonicalItems.length, unmappedUnits: Array.from(unmappedUnits) };
}
