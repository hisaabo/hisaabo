import { eq, and, sql, desc, gte, lte, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { invoices, invoiceItems, items, itemVariants, businesses, parties } from "@hisaabo/db";
import { createInvoiceSchema, updateInvoiceStatusSchema, paginationSchema, documentTypes, invoiceChargeSchema, invoiceLineItemSchema, calcLineItem, calcInvoiceTotals, money } from "@hisaabo/shared";
import { router, viewerProcedure, memberProcedure, adminProcedure } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { requireCan } from "../lib/permissions.js";
import { logAudit } from "../lib/audit.js";

export const invoiceRouter = router({
  list: viewerProcedure
    .input(z.object({
      type: z.enum(["sale", "purchase"]).nullish(),
      status: z.enum(["draft", "unfulfilled", "sent", "paid", "partial", "overdue", "cancelled"]).nullish(),
      partyId: z.string().uuid().nullish(),
      documentType: z.enum(documentTypes).default("invoice"),
      fromDate: z.string().datetime().nullish(),
      toDate: z.string().datetime().nullish(),
      itemId: z.string().uuid().nullish(),
      search: z.string().nullish(),
      sortBy: z.enum(["date", "amount", "number"]).nullish(),
      sortDir: z.enum(["asc", "desc"]).nullish(),
      ...paginationSchema.shape,
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Invoice");
      const conditions = [
        eq(invoices.businessId, ctx.businessId),
        eq(invoices.documentType, input.documentType),
        isNull(invoices.deletedAt),
      ];
      if (input.type) conditions.push(eq(invoices.type, input.type));
      if (input.status) conditions.push(eq(invoices.status, input.status));
      if (input.partyId) conditions.push(eq(invoices.partyId, input.partyId));
      if (input.fromDate) conditions.push(gte(invoices.invoiceDate, new Date(input.fromDate)));
      if (input.toDate) conditions.push(lte(invoices.invoiceDate, new Date(input.toDate)));
      if (input.search) {
        const term = `%${input.search}%`;
        conditions.push(
          sql`(${invoices.invoiceNumber} ILIKE ${term} OR EXISTS (
            SELECT 1 FROM ${parties} WHERE ${parties.id} = ${invoices.partyId} AND ${parties.name} ILIKE ${term}
          ))`
        );
      }

      // itemId filter: find invoices that contain this item
      if (input.itemId) {
        const rows = await ctx.db
          .select({ invoiceId: invoiceItems.invoiceId })
          .from(invoiceItems)
          .where(eq(invoiceItems.itemId, input.itemId));
        const ids = rows.map((r) => r.invoiceId);
        if (ids.length === 0) {
          return { data: [], total: 0, page: input.page, limit: input.limit };
        }
        conditions.push(inArray(invoices.id, ids));
      }

      const offset = (input.page - 1) * input.limit;

      const [data, [{ count }]] = await Promise.all([
        ctx.db.select({
          id: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          type: invoices.type,
          status: invoices.status,
          documentType: invoices.documentType,
          invoiceDate: invoices.invoiceDate,
          dueDate: invoices.dueDate,
          totalAmount: invoices.totalAmount,
          amountPaid: invoices.amountPaid,
          partyName: parties.name,
          partyId: parties.id,
          createdByName: invoices.createdByName,
        }).from(invoices)
          .innerJoin(parties, eq(parties.id, invoices.partyId))
          .where(and(...conditions))
          .orderBy(
            input.sortBy === "amount"
              ? (input.sortDir === "asc" ? sql`${invoices.totalAmount}::numeric ASC` : sql`${invoices.totalAmount}::numeric DESC`)
              : input.sortBy === "number"
                ? (input.sortDir === "asc" ? invoices.invoiceNumber : desc(invoices.invoiceNumber))
                : (input.sortDir === "asc" ? invoices.invoiceDate : desc(invoices.invoiceDate))
          )
          .limit(input.limit)
          .offset(offset),
        ctx.db.select({ count: sql<number>`count(*)::int` }).from(invoices)
          .where(and(...conditions)),
      ]);

      return { data, total: count, page: input.page, limit: input.limit };
    }),

  getById: viewerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Invoice");
      const [invoice] = await ctx.db.select().from(invoices)
        .where(and(eq(invoices.id, input.id), eq(invoices.businessId, ctx.businessId)))
        .limit(1);

      if (!invoice) return null;

      const [lineItems, [party]] = await Promise.all([
        ctx.db.select().from(invoiceItems)
          .where(eq(invoiceItems.invoiceId, input.id))
          .orderBy(invoiceItems.sortOrder),
        ctx.db.select().from(parties)
          .where(eq(parties.id, invoice.partyId)).limit(1),
      ]);

      return { ...invoice, lineItems, party: party ?? null };
    }),

  create: memberProcedure.input(createInvoiceSchema).mutation(async ({ input, ctx }) => {
    requireCan(ctx.ability, "create", "Invoice");
    const ipAddress = ctx.req.headers.get("x-forwarded-for") || ctx.req.headers.get("cf-connecting-ip") || null;
    const invoice = await ctx.db.transaction(async (tx) => {
      // Get and increment invoice number atomically
      const [biz] = await tx.select({
        prefix: businesses.invoicePrefix,
        nextNum: businesses.nextInvoiceNumber,
      }).from(businesses)
        .where(eq(businesses.id, ctx.businessId))
        .for("update");

      const invoiceNumber = `${biz.prefix}-${String(biz.nextNum).padStart(5, "0")}`;

      await tx.update(businesses)
        .set({ nextInvoiceNumber: biz.nextNum + 1 })
        .where(eq(businesses.id, ctx.businessId));

      // Calculate line item totals using fixed-point arithmetic
      const processedItems = input.lineItems.map((li, idx) => {
        const calc = calcLineItem({
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          taxPercent: li.taxPercent || "0",
          discountPercent: li.discountPercent || "0",
        });
        return {
          itemId: li.itemId || null,
          description: li.description,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          taxPercent: li.taxPercent || "0",
          taxAmount: calc.taxAmount,
          discountPercent: li.discountPercent || "0",
          totalAmount: calc.total,
          sortOrder: idx,
          selectedUnit: li.selectedUnit || null,
          conversionFactor: li.variantId ? "1" : (li.conversionFactor || "1"),
          variantId: li.variantId || null,
        };
      });

      const charges = input.charges ?? [];
      const totals = calcInvoiceTotals({
        lineItems: input.lineItems.map((li) => ({
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          taxPercent: li.taxPercent || "0",
          discountPercent: li.discountPercent || "0",
        })),
        charges: charges.length > 0 ? charges : undefined,
        invoiceDiscount: input.invoiceDiscount || "0",
        invoiceDiscountType: input.invoiceDiscountType || "amount",
        roundOff: input.roundOff || "0",
      });
      const additionalCharges = charges.length > 0
        ? totals.chargesTotal
        : (input.additionalCharges || "0");
      const roundOff = input.roundOff || "0";

      const [invoice] = await tx.insert(invoices).values({
        businessId: ctx.businessId,
        partyId: input.partyId,
        type: input.type,
        documentType: "invoice",
        invoiceNumber,
        invoiceDate: input.invoiceDate ? new Date(input.invoiceDate) : new Date(),
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        subtotal: totals.subtotal,
        taxAmount: totals.taxTotal,
        discountAmount: totals.invoiceDiscountAmount,
        charges: charges.length > 0 ? charges : null,
        additionalCharges,
        roundOff,
        totalAmount: totals.total,
        notes: input.notes,
        termsAndConditions: input.termsAndConditions,
        referenceDocumentId: input.referenceDocumentId || null,
        createdByUserId: ctx.user!.id,
        createdByName: ctx.user!.name,
      }).returning();

      if (processedItems.length > 0) {
        await tx.insert(invoiceItems).values(
          processedItems.map((li) => ({ ...li, invoiceId: invoice.id }))
        );
      }

      // Update stock quantities for sale/purchase invoices
      // Separate tracking for items (with conversion factor) and variants (no conversion)
      const itemStockMap = new Map<string, number>();
      const variantStockMap = new Map<string, number>();
      for (const li of input.lineItems) {
        if (li.variantId) {
          // Variant: stock lives on the variant, no conversion factor
          const qty = parseFloat(li.quantity);
          variantStockMap.set(li.variantId, (variantStockMap.get(li.variantId) || 0) + qty);
        } else if (li.itemId) {
          // Simple/alt_units: stock lives on the item, apply conversion factor
          const qty = parseFloat(li.quantity) * parseFloat(li.conversionFactor || "1");
          itemStockMap.set(li.itemId, (itemStockMap.get(li.itemId) || 0) + qty);
        }
      }
      for (const [itemId, totalQty] of itemStockMap) {
        const qtyStr = totalQty.toFixed(3);
        await tx.update(items).set({
          stockQuantity: input.type === "sale"
            ? sql`${items.stockQuantity}::numeric - ${qtyStr}::numeric`
            : sql`${items.stockQuantity}::numeric + ${qtyStr}::numeric`,
          updatedAt: new Date(),
        }).where(eq(items.id, itemId));
      }
      for (const [variantId, totalQty] of variantStockMap) {
        const qtyStr = totalQty.toFixed(3);
        await tx.update(itemVariants).set({
          stockQuantity: input.type === "sale"
            ? sql`${itemVariants.stockQuantity}::numeric - ${qtyStr}::numeric`
            : sql`${itemVariants.stockQuantity}::numeric + ${qtyStr}::numeric`,
          updatedAt: new Date(),
        }).where(eq(itemVariants.id, variantId));
      }

      return invoice;
    });

    await logAudit(ctx.db, {
      businessId: ctx.businessId,
      userId: ctx.user!.id,
      action: "invoice.create",
      entityType: "invoice",
      entityId: invoice.id,
      metadata: { invoiceNumber: invoice.invoiceNumber, type: invoice.type, totalAmount: invoice.totalAmount },
      ipAddress,
    });

    return invoice;
  }),

  updateStatus: memberProcedure
    .input(z.object({ id: z.string().uuid(), ...updateInvoiceStatusSchema.shape }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Invoice");
      const [invoice] = await ctx.db.update(invoices)
        .set({ status: input.status, updatedAt: new Date() })
        .where(and(eq(invoices.id, input.id), eq(invoices.businessId, ctx.businessId)))
        .returning();
      return invoice;
    }),

  update: memberProcedure
    .input(z.object({
      id: z.string().uuid(),
      partyId: z.string().uuid().optional(),
      invoiceDate: z.string().datetime().optional(),
      dueDate: z.string().datetime().optional().nullable(),
      notes: z.string().max(2000).optional().nullable(),
      termsAndConditions: z.string().max(2000).optional().nullable(),
      charges: z.array(invoiceChargeSchema).optional(),
      invoiceDiscount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
      invoiceDiscountType: z.enum(["amount", "percent"]).optional(),
      roundOff: z.string().regex(/^-?\d+(\.\d{1,2})?$/).optional(),
      lineItems: z.array(invoiceLineItemSchema).min(1).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Invoice");
      return ctx.db.transaction(async (tx) => {
        // 1. Fetch existing invoice
        const [existing] = await tx.select()
          .from(invoices)
          .where(and(eq(invoices.id, input.id), eq(invoices.businessId, ctx.businessId)))
          .for("update")
          .limit(1);

        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
        if (existing.status === "paid") throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot edit a paid invoice. Remove payments first." });

        // 2. Build update payload
        const updates: Record<string, any> = { updatedAt: new Date() };

        if (input.partyId) updates.partyId = input.partyId;
        if (input.invoiceDate) updates.invoiceDate = new Date(input.invoiceDate);
        if (input.dueDate !== undefined) updates.dueDate = input.dueDate ? new Date(input.dueDate) : null;
        if (input.notes !== undefined) updates.notes = input.notes;
        if (input.termsAndConditions !== undefined) updates.termsAndConditions = input.termsAndConditions;

        // 3. Handle charges
        if (input.charges) {
          updates.charges = input.charges;
          updates.additionalCharges = money.sum(input.charges.map((c) => c.amount));
        }
        if (input.roundOff !== undefined) updates.roundOff = input.roundOff;

        // 4. Handle line items — delete old, insert new, recalculate totals
        if (input.lineItems) {
          // Step 1: Read old line items to reverse their stock impact
          const oldLineItems = await tx.select({
            itemId: invoiceItems.itemId,
            quantity: invoiceItems.quantity,
            conversionFactor: invoiceItems.conversionFactor,
            variantId: invoiceItems.variantId,
          }).from(invoiceItems).where(eq(invoiceItems.invoiceId, input.id));

          // Step 2: Reverse old stock adjustments (separate item vs variant)
          const oldItemStockMap = new Map<string, number>();
          const oldVariantStockMap = new Map<string, number>();
          for (const li of oldLineItems) {
            if (li.variantId) {
              const qty = parseFloat(li.quantity);
              oldVariantStockMap.set(li.variantId, (oldVariantStockMap.get(li.variantId) || 0) + qty);
            } else if (li.itemId) {
              const qty = parseFloat(li.quantity) * parseFloat(li.conversionFactor || "1");
              oldItemStockMap.set(li.itemId, (oldItemStockMap.get(li.itemId) || 0) + qty);
            }
          }
          for (const [itemId, totalQty] of oldItemStockMap) {
            const qtyStr = totalQty.toFixed(3);
            await tx.update(items).set({
              stockQuantity: existing.type === "sale"
                ? sql`${items.stockQuantity}::numeric + ${qtyStr}::numeric`
                : sql`${items.stockQuantity}::numeric - ${qtyStr}::numeric`,
              updatedAt: new Date(),
            }).where(eq(items.id, itemId));
          }
          for (const [variantId, totalQty] of oldVariantStockMap) {
            const qtyStr = totalQty.toFixed(3);
            await tx.update(itemVariants).set({
              stockQuantity: existing.type === "sale"
                ? sql`${itemVariants.stockQuantity}::numeric + ${qtyStr}::numeric`
                : sql`${itemVariants.stockQuantity}::numeric - ${qtyStr}::numeric`,
              updatedAt: new Date(),
            }).where(eq(itemVariants.id, variantId));
          }

          // Step 3: Delete existing line items
          await tx.delete(invoiceItems).where(eq(invoiceItems.invoiceId, input.id));

          // Step 4: Process and insert new line items using fixed-point arithmetic
          const processedItems = input.lineItems.map((li, idx) => {
            const calc = calcLineItem({
              quantity: li.quantity,
              unitPrice: li.unitPrice,
              taxPercent: li.taxPercent || "0",
              discountPercent: li.discountPercent || "0",
            });
            return {
              invoiceId: input.id,
              itemId: li.itemId || null,
              description: li.description,
              quantity: li.quantity,
              unitPrice: li.unitPrice,
              taxPercent: li.taxPercent || "0",
              taxAmount: calc.taxAmount,
              discountPercent: li.discountPercent || "0",
              totalAmount: calc.total,
              sortOrder: idx,
              selectedUnit: li.selectedUnit || null,
              conversionFactor: li.variantId ? "1" : (li.conversionFactor || "1"),
              variantId: li.variantId || null,
            };
          });

          if (processedItems.length > 0) {
            await tx.insert(invoiceItems).values(processedItems);
          }

          // Step 5: Apply new stock adjustments (separate item vs variant)
          const newItemStockMap = new Map<string, number>();
          const newVariantStockMap = new Map<string, number>();
          for (const li of input.lineItems) {
            if (li.variantId) {
              const qty = parseFloat(li.quantity);
              newVariantStockMap.set(li.variantId, (newVariantStockMap.get(li.variantId) || 0) + qty);
            } else if (li.itemId) {
              const qty = parseFloat(li.quantity) * parseFloat(li.conversionFactor || "1");
              newItemStockMap.set(li.itemId, (newItemStockMap.get(li.itemId) || 0) + qty);
            }
          }
          for (const [itemId, totalQty] of newItemStockMap) {
            const qtyStr = totalQty.toFixed(3);
            await tx.update(items).set({
              stockQuantity: existing.type === "sale"
                ? sql`${items.stockQuantity}::numeric - ${qtyStr}::numeric`
                : sql`${items.stockQuantity}::numeric + ${qtyStr}::numeric`,
              updatedAt: new Date(),
            }).where(eq(items.id, itemId));
          }
          for (const [variantId, totalQty] of newVariantStockMap) {
            const qtyStr = totalQty.toFixed(3);
            await tx.update(itemVariants).set({
              stockQuantity: existing.type === "sale"
                ? sql`${itemVariants.stockQuantity}::numeric - ${qtyStr}::numeric`
                : sql`${itemVariants.stockQuantity}::numeric + ${qtyStr}::numeric`,
              updatedAt: new Date(),
            }).where(eq(itemVariants.id, variantId));
          }

          // Recalculate totals using fixed-point arithmetic
          const roundOffStr = input.roundOff !== undefined ? input.roundOff : existing.roundOff;
          const totals = calcInvoiceTotals({
            lineItems: input.lineItems.map((li) => ({
              quantity: li.quantity,
              unitPrice: li.unitPrice,
              taxPercent: li.taxPercent || "0",
              discountPercent: li.discountPercent || "0",
            })),
            charges: input.charges ? input.charges : undefined,
            invoiceDiscount: input.invoiceDiscount || existing.discountAmount || "0",
            invoiceDiscountType: input.invoiceDiscountType || "amount",
            roundOff: roundOffStr,
          });

          updates.subtotal = totals.subtotal;
          updates.taxAmount = totals.taxTotal;
          updates.discountAmount = totals.invoiceDiscountAmount;
          updates.totalAmount = totals.total;
        }

        // 5. Apply update
        const [updated] = await tx.update(invoices)
          .set(updates)
          .where(eq(invoices.id, input.id))
          .returning();

        return updated;
      });
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "delete", "Invoice");

      const [inv] = await ctx.db.select({ status: invoices.status, invoiceNumber: invoices.invoiceNumber, deletedAt: invoices.deletedAt, createdAt: invoices.createdAt })
        .from(invoices)
        .where(and(eq(invoices.id, input.id), eq(invoices.businessId, ctx.businessId)))
        .limit(1);

      if (!inv) return { success: true };
      if (inv.deletedAt) return { success: true }; // already soft-deleted

      // seller_manager: can only delete unpaid invoices created within the last 2 hours
      if (ctx.role === "seller_manager") {
        if (inv.status === "paid") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Cannot delete paid invoices" });
        }
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        if (inv.createdAt < twoHoursAgo) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Can only delete invoices within 2 hours of creation" });
        }
      }

      await ctx.db.update(invoices)
        .set({ deletedAt: new Date(), status: "cancelled" as const, updatedAt: new Date() })
        .where(and(eq(invoices.id, input.id), eq(invoices.businessId, ctx.businessId)));

      const ipAddress = ctx.req.headers.get("x-forwarded-for") || ctx.req.headers.get("cf-connecting-ip") || null;
      await logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user!.id,
        action: "invoice.delete",
        entityType: "invoice",
        entityId: input.id,
        metadata: { invoiceNumber: inv.invoiceNumber, previousStatus: inv.status },
        ipAddress,
      });

      return { success: true };
    }),
});
