import { eq, and, ilike, sql, desc, isNull } from "drizzle-orm";
import { z } from "zod";
import { items, itemVariants, invoiceItems, invoices, parties, stockAdjustments } from "@hisaabo/db";
import { createItemSchema, updateItemSchema, paginationSchema, itemTypes, itemModes, itemVariantSchema, money } from "@hisaabo/shared";
import { router, viewerProcedure, memberProcedure, adminProcedure } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { requireCan } from "../lib/permissions.js";
import { logAudit } from "../lib/audit.js";
import { escapeLike } from "../lib/escape-like.js";

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
      // Active catalog read — exclude soft-deleted items. Matches the
      // `items_active_idx` partial index when the planner picks it up.
      const conditions = [eq(items.businessId, ctx.businessId), isNull(items.deletedAt)];
      if (input.search) {
        conditions.push(ilike(items.name, `%${escapeLike(input.search)}%`));
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
          .where(and(
            sql`${itemVariants.itemId} IN (${sql.join(variantItemIds.map(id => sql`${id}`), sql`, `)})`,
            // Active variant aggregation — soft-deleted variants must not
            // inflate the visible count/stock on the parent item card.
            isNull(itemVariants.deletedAt),
          ))
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
      // Active lookup — soft-deleted items should not appear in the item
      // detail page. If a caller needs to render a historical invoice line
      // that joins to items, it goes through `invoice.getById`, which keeps
      // the join without this filter.
      const [item] = await ctx.db.select().from(items)
        .where(and(
          eq(items.id, input.id),
          eq(items.businessId, ctx.businessId),
          isNull(items.deletedAt),
        ))
        .limit(1);
      if (!item) return null;

      if (item.itemMode === "variants") {
        const variants = await ctx.db.select().from(itemVariants)
          .where(and(eq(itemVariants.itemId, item.id), isNull(itemVariants.deletedAt)))
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
        // Freshly created variants only — no historical data possible here,
        // but keep the filter for consistency with the active-read contract.
        const variants = await tx.select().from(itemVariants)
          .where(and(eq(itemVariants.itemId, item.id), isNull(itemVariants.deletedAt)));

        logAudit(ctx.db, {
          businessId: ctx.businessId,
          userId: ctx.user.id,
          action: "item.create",
          entityType: "item",
          entityId: item.id,
          metadata: { name: item.name },
          ipAddress: ctx.ipAddress,
        });

        return { ...item, variants };
      }

      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user.id,
        action: "item.create",
        entityType: "item",
        entityId: item.id,
        metadata: { name: item.name },
        ipAddress: ctx.ipAddress,
      });

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
      const result = await ctx.db.transaction(async (tx) => {
        // Active mutation — a soft-deleted item must not be reachable via
        // a stale client action. If the client believes it can switch the
        // base unit, the item should still be visible on its side.
        const [item] = await tx.select().from(items)
          .where(and(
            eq(items.id, input.id),
            eq(items.businessId, ctx.businessId),
            isNull(items.deletedAt),
          ))
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

      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user.id,
        action: "item.switchBaseUnit",
        entityType: "item",
        entityId: input.id,
        metadata: { itemId: input.id, name: result.name, newUnit: input.newUnit, conversionFactor: input.conversionFactor },
        ipAddress: ctx.ipAddress,
      });

      return result;
    }),

  update: memberProcedure
    .input(z.object({ id: z.string().uuid(), data: updateItemSchema }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Item");
      // Active-mutation contract: a soft-deleted item cannot be edited via
      // the public API. Re-activation would require an explicit restore
      // endpoint, which is deferred per FIXES.md.
      const [item] = await ctx.db.update(items)
        .set({ ...input.data, updatedAt: new Date() })
        .where(and(
          eq(items.id, input.id),
          eq(items.businessId, ctx.businessId),
          isNull(items.deletedAt),
        ))
        .returning();

      if (!item) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });
      }

      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user.id,
        action: "item.update",
        entityType: "item",
        entityId: item.id,
        metadata: { name: item.name },
        ipAddress: ctx.ipAddress,
      });

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
      const result = await ctx.db.transaction(async (tx) => {
        // Active mutation — see `update`.
        const [item] = await tx.select()
          .from(items)
          .where(and(
            eq(items.id, input.id),
            eq(items.businessId, ctx.businessId),
            isNull(items.deletedAt),
          ));
        if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });

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

        // Update the item and cascade to invoice line items atomically so a
        // crash between the two writes never leaves them in an inconsistent state.
        // The `isNull` predicate catches a rare race where the item is
        // soft-deleted between the SELECT above and this UPDATE.
        await tx.update(items)
          .set(updates)
          .where(and(
            eq(items.id, input.id),
            eq(items.businessId, ctx.businessId),
            isNull(items.deletedAt),
          ));

        // Cascade: update selectedUnit on all invoice line items for this item
        await tx.update(invoiceItems)
          .set({ selectedUnit: input.newUnit })
          .where(and(
            eq(invoiceItems.itemId, input.id),
            eq(invoiceItems.selectedUnit, input.oldUnit),
          ));

        return { success: true, renamedFrom: input.oldUnit, renamedTo: input.newUnit };
      });

      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user.id,
        action: "item.renameUnit",
        entityType: "item",
        entityId: input.id,
        metadata: { itemId: input.id, oldUnit: input.oldUnit, newUnit: input.newUnit },
        ipAddress: ctx.ipAddress,
      });

      return result;
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "delete", "Item");

      // Soft delete — historical invoice line items carry `item_id` /
      // `variant_id` FKs (ON DELETE SET NULL) and would lose their join on
      // a physical delete, which would destroy the audit trail on every
      // legacy invoice that referenced the item. See FIXES.md Stage 5.
      //
      // The `isNull(deletedAt)` clause in the WHERE makes the mutation
      // idempotent: calling delete twice on the same id simply updates 0
      // rows the second time instead of throwing a 500. We preserve the
      // NOT_FOUND response for truly-missing ids by looking up the item
      // (still scoped by deletedAt IS NULL) BEFORE the update, so a caller
      // that sends a bogus id still gets a clear error.
      const result = await ctx.db.transaction(async (tx) => {
        const [existing] = await tx.select({ id: items.id, deletedAt: items.deletedAt })
          .from(items)
          .where(and(eq(items.id, input.id), eq(items.businessId, ctx.businessId)))
          .limit(1);

        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });
        }

        // Already soft-deleted — treat as success (idempotent).
        if (existing.deletedAt !== null) {
          return { alreadyDeleted: true };
        }

        const now = new Date();

        // Stamp the parent item and cascade the same timestamp onto every
        // active variant. This matches what a physical delete used to do
        // (ON DELETE CASCADE on item_variants.item_id) while keeping the
        // rows around for historical joins.
        await tx.update(items)
          .set({ deletedAt: now, updatedAt: now })
          .where(and(
            eq(items.id, input.id),
            eq(items.businessId, ctx.businessId),
            isNull(items.deletedAt),
          ));

        await tx.update(itemVariants)
          .set({ deletedAt: now, updatedAt: now })
          .where(and(
            eq(itemVariants.itemId, input.id),
            isNull(itemVariants.deletedAt),
          ));

        return { alreadyDeleted: false };
      });

      // Audit log only on the first delete. A no-op idempotent delete
      // shouldn't re-log the action every time a client retries.
      if (!result.alreadyDeleted) {
        logAudit(ctx.db, {
          businessId: ctx.businessId,
          userId: ctx.user.id,
          action: "item.delete",
          entityType: "item",
          entityId: input.id,
          metadata: { itemId: input.id },
          ipAddress: ctx.ipAddress,
        });
      }

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
        invoiceId: invoices.id,
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
            sql`${invoices.documentType} NOT IN ('credit_note', 'quotation', 'proforma', 'debit_note')`,
          )
        )
        .orderBy(desc(invoices.invoiceDate))
        .limit(50);

      // Annotate direction: returns reverse the normal flow
      // sale → out, purchase → in, but sales_return/purchase_return flip it
      return rows.map((r) => {
        const isReturn = ["sales_return", "purchase_return"].includes(r.documentType);
        const baseSaleOutflow = r.invoiceType === "sale" || r.documentType === "delivery_challan";
        const isOutflow = isReturn ? !baseSaleOutflow : baseSaleOutflow;
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
      // Active read — soft-deleted parent item is treated as "not found".
      const [item] = await ctx.db.select({ id: items.id }).from(items)
        .where(and(
          eq(items.id, input.itemId),
          eq(items.businessId, ctx.businessId),
          isNull(items.deletedAt),
        ))
        .limit(1);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });

      return ctx.db.select().from(itemVariants)
        .where(and(eq(itemVariants.itemId, input.itemId), isNull(itemVariants.deletedAt)))
        .orderBy(itemVariants.createdAt);
    }),

  createVariant: memberProcedure
    .input(z.object({ itemId: z.string().uuid(), variant: itemVariantSchema }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Item");
      // Cannot add a variant to a soft-deleted parent item.
      const [item] = await ctx.db.select().from(items)
        .where(and(
          eq(items.id, input.itemId),
          eq(items.businessId, ctx.businessId),
          isNull(items.deletedAt),
        ))
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

      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user.id,
        action: "item.createVariant",
        entityType: "itemVariant",
        entityId: variant.id,
        metadata: { itemId: input.itemId, variantName: JSON.stringify(input.variant.attributeValues) },
        ipAddress: ctx.ipAddress,
      });

      return variant;
    }),

  updateVariant: memberProcedure
    .input(z.object({
      variantId: z.string().uuid(),
      data: itemVariantSchema.partial(),
    }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Item");
      // Verify variant belongs to an active item in this business. Both
      // sides (item + variant) must be non-deleted to allow edits.
      const [existing] = await ctx.db.select({
        variantId: itemVariants.id,
        itemId: itemVariants.itemId,
        businessId: items.businessId,
      }).from(itemVariants)
        .innerJoin(items, eq(items.id, itemVariants.itemId))
        .where(and(
          eq(itemVariants.id, input.variantId),
          eq(items.businessId, ctx.businessId),
          isNull(items.deletedAt),
          isNull(itemVariants.deletedAt),
        ))
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
        .where(and(eq(itemVariants.id, input.variantId), isNull(itemVariants.deletedAt)))
        .returning();

      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user.id,
        action: "item.updateVariant",
        entityType: "itemVariant",
        entityId: input.variantId,
        metadata: { variantId: input.variantId },
        ipAddress: ctx.ipAddress,
      });

      return variant;
    }),

  deleteVariant: adminProcedure
    .input(z.object({ variantId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "delete", "Item");

      // Soft delete with the same idempotent semantics as `delete`: look up
      // the variant (regardless of soft-delete state) so an unknown id still
      // 404s, but a second delete on an already-deleted variant is a no-op.
      const result = await ctx.db.transaction(async (tx) => {
        const [existing] = await tx.select({
          variantId: itemVariants.id,
          deletedAt: itemVariants.deletedAt,
          businessId: items.businessId,
        }).from(itemVariants)
          .innerJoin(items, eq(items.id, itemVariants.itemId))
          .where(and(
            eq(itemVariants.id, input.variantId),
            eq(items.businessId, ctx.businessId),
          ))
          .limit(1);

        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Variant not found" });
        }

        if (existing.deletedAt !== null) {
          return { alreadyDeleted: true };
        }

        const now = new Date();
        await tx.update(itemVariants)
          .set({ deletedAt: now, updatedAt: now })
          .where(and(
            eq(itemVariants.id, input.variantId),
            isNull(itemVariants.deletedAt),
          ));

        return { alreadyDeleted: false };
      });

      if (!result.alreadyDeleted) {
        logAudit(ctx.db, {
          businessId: ctx.businessId,
          userId: ctx.user.id,
          action: "item.deleteVariant",
          entityType: "itemVariant",
          entityId: input.variantId,
          metadata: { variantId: input.variantId },
          ipAddress: ctx.ipAddress,
        });
      }

      return { success: true };
    }),

  bulkCreateVariants: memberProcedure
    .input(z.object({
      itemId: z.string().uuid(),
      variants: z.array(itemVariantSchema).min(1).max(100),
    }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Item");
      // Cannot bulk-create variants on a soft-deleted parent item.
      const [item] = await ctx.db.select().from(items)
        .where(and(
          eq(items.id, input.itemId),
          eq(items.businessId, ctx.businessId),
          isNull(items.deletedAt),
        ))
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
    // Get all active items for the business (exclude variant items —
    // they're already organized — and soft-deleted rows).
    const allItems = await ctx.db.select({
      id: items.id,
      name: items.name,
      unit: items.unit,
      salePrice: items.salePrice,
      stockQuantity: items.stockQuantity,
    }).from(items)
      .where(and(
        eq(items.businessId, ctx.businessId),
        sql`${items.itemMode} != 'variants'`,
        isNull(items.deletedAt),
      ))
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
        // Both sides must be active — merging into or from a soft-deleted
        // item is nonsensical (the user shouldn't even be able to see them
        // in the merge picker).
        const [source] = await tx.select().from(items)
          .where(and(
            eq(items.id, input.sourceId),
            eq(items.businessId, ctx.businessId),
            isNull(items.deletedAt),
          )).limit(1);
        const [target] = await tx.select().from(items)
          .where(and(
            eq(items.id, input.targetId),
            eq(items.businessId, ctx.businessId),
            isNull(items.deletedAt),
          )).limit(1);

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

        // Soft-delete the source item. Any invoice line item that was
        // re-linked above now points at the target; anything that wasn't
        // (e.g. cancelled drafts that were out of the re-link query's
        // predicate) still resolves its item_id to the source row, which
        // keeps the historical join intact after the merge.
        const now = new Date();
        await tx.update(items)
          .set({ deletedAt: now, updatedAt: now })
          .where(and(eq(items.id, input.sourceId), isNull(items.deletedAt)));

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
          // Active read — can't adjust stock on a deleted variant.
          const [variant] = await tx.select({ stockQuantity: itemVariants.stockQuantity })
            .from(itemVariants)
            .innerJoin(items, eq(items.id, itemVariants.itemId))
            .where(and(
              eq(itemVariants.id, input.variantId),
              eq(items.businessId, ctx.businessId),
              isNull(items.deletedAt),
              isNull(itemVariants.deletedAt),
            ))
            .for("update")
            .limit(1);
          if (!variant) throw new TRPCError({ code: "NOT_FOUND", message: "Variant not found" });
          previousStock = variant.stockQuantity;
        } else {
          // Active read — can't adjust stock on a deleted item.
          const [item] = await tx.select({ stockQuantity: items.stockQuantity })
            .from(items)
            .where(and(
              eq(items.id, input.itemId),
              eq(items.businessId, ctx.businessId),
              isNull(items.deletedAt),
            ))
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
    // Active low-stock alerts — never raise an alert for a soft-deleted
    // item / variant. That would surface a notification for something the
    // user already chose to hide from their catalog.
    const [[itemResult], [variantResult]] = await Promise.all([
      ctx.db.select({
        count: sql<number>`count(*)::int`,
      }).from(items)
        .where(and(
          eq(items.businessId, ctx.businessId),
          sql`${items.itemMode} != 'variants'`, // variant items track stock on variants, not parent
          sql`${items.lowStockAlert} IS NOT NULL AND ${items.stockQuantity}::numeric <= ${items.lowStockAlert}::numeric`,
          isNull(items.deletedAt),
        )),
      ctx.db.select({
        count: sql<number>`count(*)::int`,
      }).from(itemVariants)
        .innerJoin(items, eq(items.id, itemVariants.itemId))
        .where(and(
          eq(items.businessId, ctx.businessId),
          sql`${itemVariants.lowStockAlert} IS NOT NULL AND ${itemVariants.stockQuantity}::numeric <= ${itemVariants.lowStockAlert}::numeric`,
          isNull(items.deletedAt),
          isNull(itemVariants.deletedAt),
        )),
    ]);
    return itemResult.count + variantResult.count;
  }),
});
