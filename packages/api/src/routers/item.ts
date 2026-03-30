import { eq, and, ilike, sql, desc } from "drizzle-orm";
import { z } from "zod";
import { items, itemVariants, invoiceItems, invoices, parties, stockAdjustments } from "@hisaabo/db";
import { createItemSchema, updateItemSchema, paginationSchema, itemTypes, itemModes, itemVariantSchema, money } from "@hisaabo/shared";
import { router, viewerProcedure, memberProcedure, adminProcedure } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { requireCan } from "../lib/permissions.js";

export const itemRouter = router({
  list: viewerProcedure
    .input(z.object({
      search: z.string().nullish(),
      lowStock: z.boolean().nullish(),
      itemType: z.enum(itemTypes).nullish(),
      itemMode: z.enum(itemModes).nullish(),
      category: z.string().nullish(),
      ...paginationSchema.shape,
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Item");
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
      if (input.itemMode) {
        conditions.push(eq(items.itemMode, input.itemMode));
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

      // For variant items, attach variant count and aggregate stock
      const variantItemIds = data.filter((i) => i.itemMode === "variants").map((i) => i.id);
      let variantSummaries: Record<string, { count: number; totalStock: string }> = {};
      if (variantItemIds.length > 0) {
        const rows = await ctx.db.select({
          itemId: itemVariants.itemId,
          count: sql<number>`count(*)::int`,
          totalStock: sql<string>`COALESCE(SUM(${itemVariants.stockQuantity}::numeric), 0)::text`,
        }).from(itemVariants)
          .where(sql`${itemVariants.itemId} IN (${sql.join(variantItemIds.map(id => sql`${id}`), sql`, `)})`)
          .groupBy(itemVariants.itemId);
        for (const r of rows) {
          variantSummaries[r.itemId] = { count: r.count, totalStock: r.totalStock };
        }
      }

      const enriched = data.map((item) => ({
        ...item,
        variantCount: variantSummaries[item.id]?.count ?? null,
        variantTotalStock: variantSummaries[item.id]?.totalStock ?? null,
      }));

      return { data: enriched, total: count, page: input.page, limit: input.limit };
    }),

  getById: viewerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Item");
      const [item] = await ctx.db.select().from(items)
        .where(and(eq(items.id, input.id), eq(items.businessId, ctx.businessId)))
        .limit(1);
      if (!item) return null;

      if (item.itemMode === "variants") {
        const variants = await ctx.db.select().from(itemVariants)
          .where(eq(itemVariants.itemId, item.id))
          .orderBy(itemVariants.createdAt);
        return { ...item, variants };
      }

      return { ...item, variants: [] as typeof itemVariants.$inferSelect[] };
    }),

  create: memberProcedure.input(createItemSchema).mutation(async ({ input, ctx }) => {
    requireCan(ctx.ability, "create", "Item");
    const { variants: initialVariants, ...itemData } = input;

    return ctx.db.transaction(async (tx) => {
      const [item] = await tx.insert(items).values({
        ...itemData,
        businessId: ctx.businessId,
      }).returning();

      // Create initial variants if provided
      if (input.itemMode === "variants" && initialVariants && initialVariants.length > 0) {
        await tx.insert(itemVariants).values(
          initialVariants.map((v) => ({
            itemId: item.id,
            attributeValues: v.attributeValues,
            sku: v.sku || null,
            salePrice: v.salePrice || null,
            purchasePrice: v.purchasePrice || null,
            stockQuantity: v.stockQuantity || "0",
            lowStockAlert: v.lowStockAlert || null,
          }))
        );
      }

      if (input.itemMode === "variants") {
        const variants = await tx.select().from(itemVariants)
          .where(eq(itemVariants.itemId, item.id));
        return { ...item, variants };
      }

      return { ...item, variants: [] as typeof itemVariants.$inferSelect[] };
    });
  }),

  // Switch the base unit of an item — converts stock, moves old base to variants
  switchBaseUnit: memberProcedure
    .input(z.object({
      id: z.string().uuid(),
      newUnit: z.string().min(1),
      conversionFactor: z.number().positive(), // how many NEW units = 1 OLD unit
    }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Item");
      return ctx.db.transaction(async (tx) => {
        const [item] = await tx.select().from(items)
          .where(and(eq(items.id, input.id), eq(items.businessId, ctx.businessId)))
          .for("update")
          .limit(1);

        if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });
        if (item.itemMode === "variants") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot switch base unit on a variant item. Variants have independent stock and no conversion factor." });
        }

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
      requireCan(ctx.ability, "update", "Item");
      const [item] = await ctx.db.update(items)
        .set({ ...input.data, updatedAt: new Date() })
        .where(and(eq(items.id, input.id), eq(items.businessId, ctx.businessId)))
        .returning();
      return item;
    }),

  renameUnit: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      oldUnit: z.string().min(1),
      newUnit: z.string().min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Item");
      const [item] = await ctx.db.select()
        .from(items)
        .where(and(eq(items.id, input.id), eq(items.businessId, ctx.businessId)));
      if (!item) throw new Error("Item not found");

      const isBase = item.unit === input.oldUnit;
      const updates: Record<string, unknown> = { updatedAt: new Date() };

      if (isBase) {
        // Renaming the base unit
        updates.unit = input.newUnit;
        // Also update unitVariants if they reference the old unit name in display
      } else {
        // Renaming an alt unit — update unitVariants array
        const variants = (item.unitVariants as Array<{ unit: string; conversionFactor: number; salePrice: string }>) || [];
        updates.unitVariants = variants.map((v) =>
          v.unit === input.oldUnit ? { ...v, unit: input.newUnit } : v
        );
      }

      // Update the item
      await ctx.db.update(items)
        .set(updates)
        .where(and(eq(items.id, input.id), eq(items.businessId, ctx.businessId)));

      // Cascade: update selectedUnit on all invoice line items for this item
      await ctx.db.update(invoiceItems)
        .set({ selectedUnit: input.newUnit })
        .where(and(
          eq(invoiceItems.itemId, input.id),
          eq(invoiceItems.selectedUnit, input.oldUnit),
        ));

      return { success: true, renamedFrom: input.oldUnit, renamedTo: input.newUnit };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "delete", "Item");
      await ctx.db.delete(items)
        .where(and(eq(items.id, input.id), eq(items.businessId, ctx.businessId)));
      return { success: true };
    }),

  // Aggregate sales/purchase stats for an item — computed server-side so the 50-row
  // priceHistory limit does not cause undercounting.
  salesStats: viewerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Item");
      const [row] = await ctx.db.select({
        totalSaleAmount: sql<string>`COALESCE(SUM(CASE WHEN ${invoices.type} = 'sale' THEN ${invoiceItems.totalAmount}::numeric ELSE 0 END), 0)::text`,
        totalSaleQty: sql<string>`COALESCE(SUM(CASE WHEN ${invoices.type} = 'sale' THEN ${invoiceItems.quantity}::numeric * COALESCE(${invoiceItems.conversionFactor}::numeric, 1) ELSE 0 END), 0)::text`,
        // Gross avg: list price per base unit (unitPrice before any discount or tax)
        avgGrossPrice: sql<string>`COALESCE(
          ROUND(
            SUM(CASE WHEN ${invoices.type} = 'sale' THEN ${invoiceItems.unitPrice}::numeric * ${invoiceItems.quantity}::numeric ELSE 0 END)
            / NULLIF(SUM(CASE WHEN ${invoices.type} = 'sale' THEN ${invoiceItems.quantity}::numeric * COALESCE(${invoiceItems.conversionFactor}::numeric, 1) ELSE 0 END), 0),
          2), 0)::text`,
        // Net avg: realized price per base unit (totalAmount minus tax, i.e. after discount, before tax)
        avgNetPrice: sql<string>`COALESCE(
          ROUND(
            SUM(CASE WHEN ${invoices.type} = 'sale' THEN (${invoiceItems.totalAmount}::numeric - ${invoiceItems.taxAmount}::numeric) ELSE 0 END)
            / NULLIF(SUM(CASE WHEN ${invoices.type} = 'sale' THEN ${invoiceItems.quantity}::numeric * COALESCE(${invoiceItems.conversionFactor}::numeric, 1) ELSE 0 END), 0),
          2), 0)::text`,
        totalPurchaseAmount: sql<string>`COALESCE(SUM(CASE WHEN ${invoices.type} = 'purchase' THEN ${invoiceItems.totalAmount}::numeric ELSE 0 END), 0)::text`,
        totalPurchaseQty: sql<string>`COALESCE(SUM(CASE WHEN ${invoices.type} = 'purchase' THEN ${invoiceItems.quantity}::numeric * COALESCE(${invoiceItems.conversionFactor}::numeric, 1) ELSE 0 END), 0)::text`,
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

      return {
        totalSaleAmount: row.totalSaleAmount,
        totalSaleQty: row.totalSaleQty,
        avgGrossPrice: totalSaleQty > 0 ? row.avgGrossPrice : "0",
        avgNetPrice: totalSaleQty > 0 ? row.avgNetPrice : "0",
        totalPurchaseAmount: row.totalPurchaseAmount,
        totalPurchaseQty: row.totalPurchaseQty,
        saleInvoiceCount: row.saleInvoiceCount,
      };
    }),

  // Price history: every price this item was sold/purchased at, derived from invoice line items
  priceHistory: viewerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Item");
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
      requireCan(ctx.ability, "read", "Item");
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
      requireCan(ctx.ability, "read", "Item");
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
      requireCan(ctx.ability, "read", "Item");
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

  // ── Variant CRUD ──────────────────────────────────────────────

  listVariants: viewerProcedure
    .input(z.object({ itemId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Item");
      // Verify item belongs to business
      const [item] = await ctx.db.select({ id: items.id }).from(items)
        .where(and(eq(items.id, input.itemId), eq(items.businessId, ctx.businessId)))
        .limit(1);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });

      return ctx.db.select().from(itemVariants)
        .where(eq(itemVariants.itemId, input.itemId))
        .orderBy(itemVariants.createdAt);
    }),

  createVariant: memberProcedure
    .input(z.object({ itemId: z.string().uuid(), variant: itemVariantSchema }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Item");
      const [item] = await ctx.db.select().from(items)
        .where(and(eq(items.id, input.itemId), eq(items.businessId, ctx.businessId)))
        .limit(1);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });
      if (item.itemMode !== "variants") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Item is not in variants mode" });
      }

      const [variant] = await ctx.db.insert(itemVariants).values({
        itemId: input.itemId,
        attributeValues: input.variant.attributeValues,
        sku: input.variant.sku || null,
        salePrice: input.variant.salePrice || null,
        purchasePrice: input.variant.purchasePrice || null,
        stockQuantity: input.variant.stockQuantity || "0",
        lowStockAlert: input.variant.lowStockAlert || null,
      }).returning();
      return variant;
    }),

  updateVariant: memberProcedure
    .input(z.object({
      variantId: z.string().uuid(),
      data: itemVariantSchema.partial(),
    }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Item");
      // Verify variant belongs to an item in this business
      const [existing] = await ctx.db.select({
        variantId: itemVariants.id,
        itemId: itemVariants.itemId,
        businessId: items.businessId,
      }).from(itemVariants)
        .innerJoin(items, eq(items.id, itemVariants.itemId))
        .where(and(eq(itemVariants.id, input.variantId), eq(items.businessId, ctx.businessId)))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Variant not found" });

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.data.attributeValues !== undefined) updates.attributeValues = input.data.attributeValues;
      if (input.data.sku !== undefined) updates.sku = input.data.sku || null;
      if (input.data.salePrice !== undefined) updates.salePrice = input.data.salePrice || null;
      if (input.data.purchasePrice !== undefined) updates.purchasePrice = input.data.purchasePrice || null;
      if (input.data.stockQuantity !== undefined) updates.stockQuantity = input.data.stockQuantity;
      if (input.data.lowStockAlert !== undefined) updates.lowStockAlert = input.data.lowStockAlert || null;

      const [variant] = await ctx.db.update(itemVariants)
        .set(updates)
        .where(eq(itemVariants.id, input.variantId))
        .returning();
      return variant;
    }),

  deleteVariant: adminProcedure
    .input(z.object({ variantId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "delete", "Item");
      const [existing] = await ctx.db.select({
        variantId: itemVariants.id,
        businessId: items.businessId,
      }).from(itemVariants)
        .innerJoin(items, eq(items.id, itemVariants.itemId))
        .where(and(eq(itemVariants.id, input.variantId), eq(items.businessId, ctx.businessId)))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Variant not found" });

      await ctx.db.delete(itemVariants).where(eq(itemVariants.id, input.variantId));
      return { success: true };
    }),

  bulkCreateVariants: memberProcedure
    .input(z.object({
      itemId: z.string().uuid(),
      variants: z.array(itemVariantSchema).min(1).max(100),
    }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Item");
      const [item] = await ctx.db.select().from(items)
        .where(and(eq(items.id, input.itemId), eq(items.businessId, ctx.businessId)))
        .limit(1);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });
      if (item.itemMode !== "variants") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Item is not in variants mode" });
      }

      const created = await ctx.db.insert(itemVariants).values(
        input.variants.map((v) => ({
          itemId: input.itemId,
          attributeValues: v.attributeValues,
          sku: v.sku || null,
          salePrice: v.salePrice || null,
          purchasePrice: v.purchasePrice || null,
          stockQuantity: v.stockQuantity || "0",
          lowStockAlert: v.lowStockAlert || null,
        }))
      ).returning();
      return created;
    }),

  // Suggest potential merge candidates — items with similar name prefixes
  suggestMerges: viewerProcedure.query(async ({ ctx }) => {
    requireCan(ctx.ability, "read", "Item");
    // Get all items for the business (exclude variant items — they're already organized)
    const allItems = await ctx.db.select({
      id: items.id,
      name: items.name,
      unit: items.unit,
      salePrice: items.salePrice,
      stockQuantity: items.stockQuantity,
    }).from(items)
      .where(and(eq(items.businessId, ctx.businessId), sql`${items.itemMode} != 'variants'`))
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
      requireCan(ctx.ability, "delete", "Item");
      if (input.sourceId === input.targetId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot merge an item into itself" });
      }

      return ctx.db.transaction(async (tx) => {
        const [source] = await tx.select().from(items)
          .where(and(eq(items.id, input.sourceId), eq(items.businessId, ctx.businessId))).limit(1);
        const [target] = await tx.select().from(items)
          .where(and(eq(items.id, input.targetId), eq(items.businessId, ctx.businessId))).limit(1);

        if (!source || !target) throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });
        if (source.itemMode === "variants" || target.itemMode === "variants") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot merge variant items. Manage variants individually instead." });
        }

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

  // ── Stock Adjustments ────────────────────────────────────────

  adjustStock: memberProcedure
    .input(z.object({
      itemId: z.string().uuid(),
      variantId: z.string().uuid().nullish(),
      quantity: z.string().regex(/^-?\d+(\.\d{1,3})?$/).refine((v) => parseFloat(v) !== 0, { message: "Quantity cannot be zero" }),
      reason: z.string().max(500).optional(),
      adjustmentDate: z.string().datetime().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Item");

      return ctx.db.transaction(async (tx) => {
        // Resolve current stock
        let previousStock: string;

        if (input.variantId) {
          const [variant] = await tx.select({ stockQuantity: itemVariants.stockQuantity })
            .from(itemVariants)
            .innerJoin(items, eq(items.id, itemVariants.itemId))
            .where(and(eq(itemVariants.id, input.variantId), eq(items.businessId, ctx.businessId)))
            .for("update")
            .limit(1);
          if (!variant) throw new TRPCError({ code: "NOT_FOUND", message: "Variant not found" });
          previousStock = variant.stockQuantity;
        } else {
          const [item] = await tx.select({ stockQuantity: items.stockQuantity })
            .from(items)
            .where(and(eq(items.id, input.itemId), eq(items.businessId, ctx.businessId)))
            .for("update")
            .limit(1);
          if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });
          previousStock = item.stockQuantity;
        }

        const adj = parseFloat(input.quantity);
        const prev = parseFloat(previousStock);
        const newStock = (prev + adj).toFixed(3);

        // Apply stock change
        if (input.variantId) {
          await tx.update(itemVariants).set({
            stockQuantity: newStock,
            updatedAt: new Date(),
          }).where(eq(itemVariants.id, input.variantId));
        } else {
          await tx.update(items).set({
            stockQuantity: newStock,
            updatedAt: new Date(),
          }).where(eq(items.id, input.itemId));
        }

        // Record the adjustment
        const [adjustment] = await tx.insert(stockAdjustments).values({
          businessId: ctx.businessId,
          itemId: input.itemId,
          variantId: input.variantId || null,
          quantity: input.quantity,
          previousStock,
          newStock,
          reason: input.reason || null,
          adjustmentDate: input.adjustmentDate ? new Date(input.adjustmentDate) : new Date(),
          createdByUserId: ctx.user!.id,
          createdByName: ctx.user!.name,
        }).returning();

        return adjustment;
      });
    }),

  stockAdjustmentHistory: viewerProcedure
    .input(z.object({
      itemId: z.string().uuid(),
      variantId: z.string().uuid().nullish(),
      ...paginationSchema.shape,
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Item");
      const conditions = [
        eq(stockAdjustments.businessId, ctx.businessId),
        eq(stockAdjustments.itemId, input.itemId),
      ];
      if (input.variantId) {
        conditions.push(eq(stockAdjustments.variantId, input.variantId));
      }

      const offset = (input.page - 1) * input.limit;
      const [data, [{ count }]] = await Promise.all([
        ctx.db.select().from(stockAdjustments)
          .where(and(...conditions))
          .orderBy(desc(stockAdjustments.adjustmentDate))
          .limit(input.limit)
          .offset(offset),
        ctx.db.select({ count: sql<number>`count(*)::int` }).from(stockAdjustments)
          .where(and(...conditions)),
      ]);

      return { data, total: count, page: input.page, limit: input.limit };
    }),

  lowStockCount: viewerProcedure.query(async ({ ctx }) => {
    requireCan(ctx.ability, "read", "Item");
    const [[itemResult], [variantResult]] = await Promise.all([
      ctx.db.select({
        count: sql<number>`count(*)::int`,
      }).from(items)
        .where(and(
          eq(items.businessId, ctx.businessId),
          sql`${items.itemMode} != 'variants'`, // variant items track stock on variants, not parent
          sql`${items.lowStockAlert} IS NOT NULL AND ${items.stockQuantity}::numeric <= ${items.lowStockAlert}::numeric`
        )),
      ctx.db.select({
        count: sql<number>`count(*)::int`,
      }).from(itemVariants)
        .innerJoin(items, eq(items.id, itemVariants.itemId))
        .where(and(
          eq(items.businessId, ctx.businessId),
          sql`${itemVariants.lowStockAlert} IS NOT NULL AND ${itemVariants.stockQuantity}::numeric <= ${itemVariants.lowStockAlert}::numeric`
        )),
    ]);
    return itemResult.count + variantResult.count;
  }),
});
