import { eq, and, ilike, sql, desc } from "drizzle-orm";
import { z } from "zod";
import { items, invoiceItems, invoices, parties } from "@hisaabo/db";
import { createItemSchema, updateItemSchema, paginationSchema, itemTypes, money } from "@hisaabo/shared";
import { router, viewerProcedure, memberProcedure, adminProcedure } from "../trpc.js";
import { TRPCError } from "@trpc/server";

export const itemRouter = router({
  list: viewerProcedure
    .input(z.object({
      search: z.string().nullish(),
      lowStock: z.boolean().nullish(),
      itemType: z.enum(itemTypes).nullish(),
      category: z.string().nullish(),
      ...paginationSchema.shape,
    }))
    .query(async ({ input, ctx }) => {
      const conditions = [eq(items.businessId, ctx.businessId)];
      if (input.search) {
        conditions.push(ilike(items.name, `%${input.search}%`));
      }
      if (input.lowStock) {
        conditions.push(
          sql`${items.lowStockAlert} IS NOT NULL AND ${items.stockQuantity}::numeric <= ${items.lowStockAlert}::numeric`
        );
      }
      if (input.itemType) {
        conditions.push(eq(items.itemType, input.itemType));
      }
      if (input.category) {
        conditions.push(eq(items.category, input.category));
      }

      const offset = (input.page - 1) * input.limit;

      const [data, [{ count }]] = await Promise.all([
        ctx.db.select().from(items)
          .where(and(...conditions))
          .orderBy(desc(items.updatedAt))
          .limit(input.limit)
          .offset(offset),
        ctx.db.select({ count: sql<number>`count(*)::int` }).from(items)
          .where(and(...conditions)),
      ]);

      return { data, total: count, page: input.page, limit: input.limit };
    }),

  getById: viewerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const [item] = await ctx.db.select().from(items)
        .where(and(eq(items.id, input.id), eq(items.businessId, ctx.businessId)))
        .limit(1);
      return item ?? null;
    }),

  create: memberProcedure.input(createItemSchema).mutation(async ({ input, ctx }) => {
    const [item] = await ctx.db.insert(items).values({
      ...input,
      businessId: ctx.businessId,
    }).returning();
    return item;
  }),

  // Switch the base unit of an item — converts stock, moves old base to variants
  switchBaseUnit: memberProcedure
    .input(z.object({
      id: z.string().uuid(),
      newUnit: z.string().min(1),
      conversionFactor: z.number().positive(), // how many NEW units = 1 OLD unit
    }))
    .mutation(async ({ input, ctx }) => {
      return ctx.db.transaction(async (tx) => {
        const [item] = await tx.select().from(items)
          .where(and(eq(items.id, input.id), eq(items.businessId, ctx.businessId)))
          .for("update")
          .limit(1);

        if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });

        const oldUnit = item.unit;
        const oldSalePrice = item.salePrice;
        const oldPurchasePrice = item.purchasePrice;
        const oldStock = money.toNumber(item.stockQuantity || "0");
        const factor = input.conversionFactor;

        // Convert stock: if 1 old unit = factor new units, then stock * factor = new stock
        const newStock = (oldStock * factor).toFixed(3);

        // Convert prices: if 1 old unit = factor new units, price per new unit = old price / factor
        const newSalePrice = oldSalePrice ? (parseFloat(oldSalePrice) / factor).toFixed(2) : null;
        const newPurchasePrice = oldPurchasePrice ? (parseFloat(oldPurchasePrice) / factor).toFixed(2) : null;

        // Move old base unit to variants (with reverse conversion factor)
        const existingVariants = (item.unitVariants as any[] || []);
        // Remove the new unit from variants if it was already there
        const filteredVariants = existingVariants.filter(
          (v: any) => v.unit.toLowerCase() !== input.newUnit.toLowerCase()
        );
        // Add old base unit as a variant
        const oldBaseAsVariant = {
          unit: oldUnit,
          conversionFactor: 1 / factor, // 1 old unit = 1/factor of the new base
          salePrice: oldSalePrice || "0",
          purchasePrice: oldPurchasePrice || undefined,
        };

        const updatedVariants = [oldBaseAsVariant, ...filteredVariants];

        // Update the item
        const [updated] = await tx.update(items).set({
          unit: input.newUnit as any,
          salePrice: newSalePrice,
          purchasePrice: newPurchasePrice,
          stockQuantity: newStock,
          unitVariants: updatedVariants,
          updatedAt: new Date(),
        }).where(eq(items.id, input.id)).returning();

        // Update conversionFactor on all existing invoice line items for this item
        // Old line items were in the old unit. Now base is new unit.
        // If a line item had conversionFactor=1 (was in old base), it should now be 1/factor
        // If it had a custom factor, multiply by 1/factor
        await tx.execute(sql`
          UPDATE invoice_items SET
            conversion_factor = COALESCE(conversion_factor, 1) * ${(1 / factor).toFixed(6)}
          WHERE item_id = ${input.id}
            AND (selected_unit IS NULL OR selected_unit = ${oldUnit})
            AND invoice_id IN (SELECT id FROM invoices WHERE business_id = ${ctx.businessId})
        `);

        return updated;
      });
    }),

  update: memberProcedure
    .input(z.object({ id: z.string().uuid(), data: updateItemSchema }))
    .mutation(async ({ input, ctx }) => {
      const [item] = await ctx.db.update(items)
        .set({ ...input.data, updatedAt: new Date() })
        .where(and(eq(items.id, input.id), eq(items.businessId, ctx.businessId)))
        .returning();
      return item;
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.db.delete(items)
        .where(and(eq(items.id, input.id), eq(items.businessId, ctx.businessId)));
      return { success: true };
    }),

  // Aggregate sales/purchase stats for an item — computed server-side so the 50-row
  // priceHistory limit does not cause undercounting.
  salesStats: viewerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const [row] = await ctx.db.select({
        totalSaleAmount: sql<string>`COALESCE(SUM(CASE WHEN ${invoices.type} = 'sale' THEN ${invoiceItems.totalAmount}::numeric ELSE 0 END), 0)::text`,
        totalSaleQty: sql<string>`COALESCE(SUM(CASE WHEN ${invoices.type} = 'sale' THEN ${invoiceItems.quantity}::numeric ELSE 0 END), 0)::text`,
        totalPurchaseAmount: sql<string>`COALESCE(SUM(CASE WHEN ${invoices.type} = 'purchase' THEN ${invoiceItems.totalAmount}::numeric ELSE 0 END), 0)::text`,
        totalPurchaseQty: sql<string>`COALESCE(SUM(CASE WHEN ${invoices.type} = 'purchase' THEN ${invoiceItems.quantity}::numeric ELSE 0 END), 0)::text`,
        saleInvoiceCount: sql<number>`COUNT(DISTINCT CASE WHEN ${invoices.type} = 'sale' THEN ${invoices.id} END)::int`,
      })
        .from(invoiceItems)
        .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
        .where(
          and(
            eq(invoiceItems.itemId, input.id),
            eq(invoices.businessId, ctx.businessId),
            eq(invoices.documentType, "invoice"),
            sql`${invoices.status} NOT IN ('draft', 'cancelled')`,
          )
        );

      const totalSaleQty = parseFloat(row.totalSaleQty);
      const totalSaleAmount = parseFloat(row.totalSaleAmount);
      const avgSalePrice = totalSaleQty > 0 ? totalSaleAmount / totalSaleQty : 0;

      return {
        totalSaleAmount: row.totalSaleAmount,
        totalSaleQty: row.totalSaleQty,
        avgSalePrice: avgSalePrice.toFixed(2),
        totalPurchaseAmount: row.totalPurchaseAmount,
        totalPurchaseQty: row.totalPurchaseQty,
        saleInvoiceCount: row.saleInvoiceCount,
      };
    }),

  // Price history: every price this item was sold/purchased at, derived from invoice line items
  priceHistory: viewerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const rows = await ctx.db.select({
        invoiceDate: invoices.invoiceDate,
        invoiceNumber: invoices.invoiceNumber,
        invoiceType: invoices.type,
        unitPrice: invoiceItems.unitPrice,
        quantity: invoiceItems.quantity,
        taxPercent: invoiceItems.taxPercent,
        totalAmount: invoiceItems.totalAmount,
        partyName: parties.name,
        selectedUnit: invoiceItems.selectedUnit,
        conversionFactor: invoiceItems.conversionFactor,
      })
        .from(invoiceItems)
        .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
        .innerJoin(parties, eq(parties.id, invoices.partyId))
        .where(
          and(
            eq(invoiceItems.itemId, input.id),
            eq(invoices.businessId, ctx.businessId),
            eq(invoices.documentType, "invoice"),
          )
        )
        .orderBy(desc(invoices.invoiceDate))
        .limit(50);

      return rows;
    }),

  // Stock movements: every invoice that changed this item's stock (qty sold/purchased)
  stockMovements: viewerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const rows = await ctx.db.select({
        invoiceDate: invoices.invoiceDate,
        invoiceNumber: invoices.invoiceNumber,
        invoiceType: invoices.type,
        documentType: invoices.documentType,
        quantity: invoiceItems.quantity,
        partyName: parties.name,
        invoiceId: invoices.id,
        selectedUnit: invoiceItems.selectedUnit,
        conversionFactor: invoiceItems.conversionFactor,
      })
        .from(invoiceItems)
        .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
        .innerJoin(parties, eq(parties.id, invoices.partyId))
        .where(
          and(
            eq(invoiceItems.itemId, input.id),
            eq(invoices.businessId, ctx.businessId),
            sql`${invoices.status} NOT IN ('draft', 'cancelled')`,
          )
        )
        .orderBy(desc(invoices.invoiceDate))
        .limit(50);

      // Annotate each row with direction: sale/delivery_challan = out, purchase/return = in
      return rows.map((r) => {
        const isOutflow = r.invoiceType === "sale" || r.documentType === "delivery_challan";
        return {
          ...r,
          direction: isOutflow ? "out" as const : "in" as const,
        };
      });
    }),

  // Invoices containing this item
  relatedInvoices: viewerProcedure
    .input(z.object({ id: z.string().uuid(), ...paginationSchema.shape }))
    .query(async ({ input, ctx }) => {
      const offset = (input.page - 1) * input.limit;

      const [data, [{ count }]] = await Promise.all([
        ctx.db.selectDistinctOn([invoices.id], {
          id: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          invoiceDate: invoices.invoiceDate,
          type: invoices.type,
          documentType: invoices.documentType,
          status: invoices.status,
          totalAmount: invoices.totalAmount,
          partyName: parties.name,
        })
          .from(invoiceItems)
          .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
          .innerJoin(parties, eq(parties.id, invoices.partyId))
          .where(
            and(
              eq(invoiceItems.itemId, input.id),
              eq(invoices.businessId, ctx.businessId),
            )
          )
          .orderBy(invoices.id, desc(invoices.invoiceDate))
          .limit(input.limit)
          .offset(offset),
        ctx.db.select({ count: sql<number>`count(DISTINCT ${invoices.id})::int` })
          .from(invoiceItems)
          .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
          .where(
            and(
              eq(invoiceItems.itemId, input.id),
              eq(invoices.businessId, ctx.businessId),
            )
          ),
      ]);

      return { data, total: count, page: input.page, limit: input.limit };
    }),

  // Top buyers/suppliers for this item
  topBuyers: viewerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const rows = await ctx.db.select({
        partyId: invoices.partyId,
        partyName: parties.name,
        partyType: parties.type,
        totalQuantity: sql<string>`SUM(${invoiceItems.quantity}::numeric)::text`,
        totalAmount: sql<string>`SUM(${invoiceItems.totalAmount}::numeric)::text`,
        invoiceCount: sql<number>`COUNT(DISTINCT ${invoices.id})::int`,
      })
        .from(invoiceItems)
        .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
        .innerJoin(parties, eq(parties.id, invoices.partyId))
        .where(
          and(
            eq(invoiceItems.itemId, input.id),
            eq(invoices.businessId, ctx.businessId),
            eq(invoices.documentType, "invoice"),
            sql`${invoices.status} != 'cancelled'`,
          )
        )
        .groupBy(invoices.partyId, parties.name, parties.type)
        .orderBy(sql`SUM(${invoiceItems.totalAmount}::numeric) DESC`)
        .limit(5);

      return rows;
    }),

  // Suggest potential merge candidates — items with similar name prefixes
  suggestMerges: viewerProcedure.query(async ({ ctx }) => {
    // Get all items for the business
    const allItems = await ctx.db.select({
      id: items.id,
      name: items.name,
      unit: items.unit,
      salePrice: items.salePrice,
      stockQuantity: items.stockQuantity,
    }).from(items)
      .where(eq(items.businessId, ctx.businessId))
      .orderBy(items.name);

    // Group items by name prefix (strip trailing numbers, weights, fractions)
    // e.g., "Okra", "Okra 0.25", "Okra 0.5" → prefix "Okra"
    // e.g., "Cluster Beans 0.25", "Cluster Beans 0.5" → prefix "Cluster Beans"
    const groups: Record<string, typeof allItems> = {};

    for (const item of allItems) {
      // Extract base name: remove trailing numbers like "0.25", "0.5", "0.5kg"
      const baseName = item.name
        .replace(/\s+\d+(\.\d+)?\s*(kg|g|ml|l|pcs|gms|kgs)?\s*$/i, "")
        .trim();

      if (!groups[baseName]) groups[baseName] = [];
      groups[baseName].push(item);
    }

    // Return groups that have more than 1 item (potential merges)
    const suggestions: Array<{
      baseName: string;
      items: typeof allItems;
      suggestedConversions: Array<{
        sourceId: string;
        sourceName: string;
        targetId: string;
        targetName: string;
        suggestedFactor: number | null;
      }>;
    }> = [];

    for (const [baseName, group] of Object.entries(groups)) {
      if (group.length <= 1) continue;

      // Find the "base" item (shortest name, or the one without a number suffix)
      const baseItem = group.reduce((a, b) => a.name.length <= b.name.length ? a : b);

      const conversions = group
        .filter(item => item.id !== baseItem.id)
        .map(item => {
          // Try to extract a conversion factor from the name difference
          // e.g., "Okra 0.25" → factor 0.25, "Okra 0.5" → factor 0.5
          const suffix = item.name.replace(baseName, "").trim();
          const numMatch = suffix.match(/^(\d+\.?\d*)$/);
          const suggestedFactor = numMatch ? parseFloat(numMatch[1]) : null;

          return {
            sourceId: item.id,
            sourceName: item.name,
            targetId: baseItem.id,
            targetName: baseItem.name,
            suggestedFactor,
          };
        });

      suggestions.push({ baseName, items: group, suggestedConversions: conversions });
    }

    return suggestions;
  }),

  merge: adminProcedure
    .input(z.object({
      sourceId: z.string().uuid(),
      targetId: z.string().uuid(),
      stockConversionFactor: z.number().positive().default(1),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.sourceId === input.targetId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot merge an item into itself" });
      }

      return ctx.db.transaction(async (tx) => {
        const [source] = await tx.select().from(items)
          .where(and(eq(items.id, input.sourceId), eq(items.businessId, ctx.businessId))).limit(1);
        const [target] = await tx.select().from(items)
          .where(and(eq(items.id, input.targetId), eq(items.businessId, ctx.businessId))).limit(1);

        if (!source || !target) throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });

        // Re-link all invoice line items from source to target
        if (input.stockConversionFactor !== 1) {
          await tx.execute(sql`
            UPDATE invoice_items SET
              item_id = ${input.targetId},
              conversion_factor = COALESCE(conversion_factor, 1) * ${input.stockConversionFactor}
            WHERE item_id = ${input.sourceId}
          `);
        } else {
          await tx.update(invoiceItems)
            .set({ itemId: input.targetId })
            .where(eq(invoiceItems.itemId, input.sourceId));
        }

        // Merge stock (convert source stock to target units)
        const sourceStock = money.toNumber(source.stockQuantity || "0");
        const convertedStock = sourceStock * input.stockConversionFactor;
        const mergedStock = money.add(target.stockQuantity || "0", convertedStock.toFixed(3));

        // Fill missing fields on target from source
        const updates: Record<string, unknown> = {
          stockQuantity: mergedStock,
          updatedAt: new Date(),
        };
        if (!target.hsn && source.hsn) updates.hsn = source.hsn;
        if (!target.sku && source.sku) updates.sku = source.sku;
        if (!target.category && source.category) updates.category = source.category;
        if (!target.description && source.description) updates.description = source.description;
        if (!target.purchasePrice && source.purchasePrice) updates.purchasePrice = source.purchasePrice;
        if (!target.lowStockAlert && source.lowStockAlert) updates.lowStockAlert = source.lowStockAlert;

        // Merge unit variants (combine both sets, dedup by unit name)
        const targetVariants = (target.unitVariants as Array<{ unit: string }> || []);
        const sourceVariants = (source.unitVariants as Array<{ unit: string }> || []);
        const existingUnits = new Set(targetVariants.map((v) => v.unit.toLowerCase()));
        const newVariants = sourceVariants.filter((v) => !existingUnits.has(v.unit.toLowerCase()));
        if (newVariants.length > 0) {
          updates.unitVariants = [...targetVariants, ...newVariants];
        }

        await tx.update(items).set(updates).where(eq(items.id, input.targetId));

        // Delete the source item
        await tx.delete(items).where(eq(items.id, input.sourceId));

        return { success: true, mergedInto: input.targetId };
      });
    }),

  lowStockCount: viewerProcedure.query(async ({ ctx }) => {
    const [result] = await ctx.db.select({
      count: sql<number>`count(*)::int`,
    }).from(items)
      .where(and(
        eq(items.businessId, ctx.businessId),
        sql`${items.lowStockAlert} IS NOT NULL AND ${items.stockQuantity}::numeric <= ${items.lowStockAlert}::numeric`
      ));
    return result.count;
  }),
});
