import { eq, and, ilike, sql, desc, gte, lte, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { businesses, items, storeOrders, invoices, invoiceItems } from "@hisaabo/db";
import { paginationSchema, money } from "@hisaabo/shared";
import { router, viewerProcedure, memberProcedure, adminProcedure } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { requireCan } from "../lib/permissions.js";

// ── Validators ─────────────────────────────────────────────────

const updateStoreSettingsSchema = z.object({
  storeEnabled: z.boolean().optional(),
  storeSlug: z.string()
    .min(3)
    .max(50)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "Slug must be lowercase alphanumeric with hyphens")
    .optional()
    .nullable(),
  storeTagline: z.string().max(200).optional().nullable(),
  storeAccentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  storeMinOrderAmount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().nullable(),
  storeDeliveryNote: z.string().max(500).optional().nullable(),
  storeWhatsappNumber: z.string().max(15).optional().nullable(),
  storeAllowNegativeStock: z.boolean().optional(),
  storeOrderPrefix: z.string().min(1).max(10).optional(),
});

const storeOrderStatuses = ["pending", "confirmed", "preparing", "ready", "delivered", "cancelled"] as const;

// ── Router ─────────────────────────────────────────────────────

export const storeRouter = router({

  // ── Store Settings ───────────────────────────────────────────

  checkSlug: viewerProcedure
    .input(z.object({ slug: z.string().min(3).max(50) }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Store");
      const [existing] = await ctx.db.select({ id: businesses.id })
        .from(businesses)
        .where(and(
          eq(businesses.storeSlug, input.slug),
          sql`${businesses.id} != ${ctx.businessId}`,
        ))
        .limit(1);
      return { available: !existing };
    }),

  getSettings: viewerProcedure.query(async ({ ctx }) => {
    requireCan(ctx.ability, "read", "Store");
    const [biz] = await ctx.db.select({
      storeEnabled: businesses.storeEnabled,
      storeSlug: businesses.storeSlug,
      storeTagline: businesses.storeTagline,
      storeAccentColor: businesses.storeAccentColor,
      storeMinOrderAmount: businesses.storeMinOrderAmount,
      storeDeliveryNote: businesses.storeDeliveryNote,
      storeWhatsappNumber: businesses.storeWhatsappNumber,
      storeAllowNegativeStock: businesses.storeAllowNegativeStock,
      storeOrderPrefix: businesses.storeOrderPrefix,
      nextStoreOrderNumber: businesses.nextStoreOrderNumber,
      currency: businesses.currency,
    }).from(businesses)
      .where(eq(businesses.id, ctx.businessId))
      .limit(1);

    if (!biz) throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });
    return biz;
  }),

  updateSettings: adminProcedure
    .input(updateStoreSettingsSchema)
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "manage", "Store");

      // Validate slug uniqueness within this tenant's businesses
      if (input.storeSlug) {
        const [existing] = await ctx.db.select({ id: businesses.id })
          .from(businesses)
          .where(and(
            eq(businesses.storeSlug, input.storeSlug),
            // Exclude current business
            sql`${businesses.id} != ${ctx.businessId}`,
          ))
          .limit(1);

        if (existing) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This store URL is already taken. Please choose a different one.",
          });
        }
      }

      const [updated] = await ctx.db.update(businesses)
        .set({
          ...input,
          updatedAt: new Date(),
        })
        .where(eq(businesses.id, ctx.businessId))
        .returning({
          storeEnabled: businesses.storeEnabled,
          storeSlug: businesses.storeSlug,
          storeTagline: businesses.storeTagline,
          storeAccentColor: businesses.storeAccentColor,
          storeMinOrderAmount: businesses.storeMinOrderAmount,
          storeDeliveryNote: businesses.storeDeliveryNote,
          storeWhatsappNumber: businesses.storeWhatsappNumber,
          storeAllowNegativeStock: businesses.storeAllowNegativeStock,
          storeOrderPrefix: businesses.storeOrderPrefix,
        });

      return updated;
    }),

  // ── Item Visibility ──────────────────────────────────────────

  listStoreItems: viewerProcedure
    .input(z.object({
      search: z.string().nullish(),
      category: z.string().nullish(),
      storeEnabled: z.boolean().nullish(),
      ...paginationSchema.shape,
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Store");
      const conditions = [eq(items.businessId, ctx.businessId)];

      if (input.search) {
        conditions.push(ilike(items.name, `%${input.search}%`));
      }
      if (input.category) {
        conditions.push(eq(items.category, input.category));
      }
      if (input.storeEnabled !== null && input.storeEnabled !== undefined) {
        conditions.push(eq(items.storeEnabled, input.storeEnabled));
      }

      const offset = (input.page - 1) * input.limit;

      const [data, [{ count }]] = await Promise.all([
        ctx.db.select({
          id: items.id,
          name: items.name,
          description: items.description,
          unit: items.unit,
          salePrice: items.salePrice,
          category: items.category,
          taxPercent: items.taxPercent,
          taxInclusive: items.taxInclusive,
          stockQuantity: items.stockQuantity,
          itemType: items.itemType,
          // Store-specific fields
          storeEnabled: items.storeEnabled,
          storePrice: items.storePrice,
          storeSortOrder: items.storeSortOrder,
          storeCategory: items.storeCategory,
          storeDescription: items.storeDescription,
        }).from(items)
          .where(and(...conditions))
          .orderBy(items.storeSortOrder, items.name)
          .limit(input.limit)
          .offset(offset),
        ctx.db.select({ count: sql<number>`count(*)::int` }).from(items)
          .where(and(...conditions)),
      ]);

      return { data, total: count, page: input.page, limit: input.limit };
    }),

  bulkToggleItems: memberProcedure
    .input(z.object({
      itemIds: z.array(z.string().uuid()).min(1).max(500),
      storeEnabled: z.boolean(),
    }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Store");
      await ctx.db.update(items)
        .set({ storeEnabled: input.storeEnabled, updatedAt: new Date() })
        .where(and(
          inArray(items.id, input.itemIds),
          eq(items.businessId, ctx.businessId),
        ));
      return { updated: input.itemIds.length };
    }),

  updateItemStoreSettings: memberProcedure
    .input(z.object({
      itemId: z.string().uuid(),
      storePrice: z.string().regex(/^\d+(\.\d{1,2})?$/).nullish(),
      storeSortOrder: z.number().int().min(0).nullish(),
      storeCategory: z.string().max(100).nullish(),
      storeDescription: z.string().max(1000).nullish(),
    }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Store");

      const { itemId, ...fields } = input;

      // Build update object — nullish values explicitly set to null (clearing)
      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (fields.storePrice !== undefined) updateData.storePrice = fields.storePrice;
      if (fields.storeSortOrder !== undefined) updateData.storeSortOrder = fields.storeSortOrder ?? 0;
      if (fields.storeCategory !== undefined) updateData.storeCategory = fields.storeCategory;
      if (fields.storeDescription !== undefined) updateData.storeDescription = fields.storeDescription;

      const [updated] = await ctx.db.update(items)
        .set(updateData)
        .where(and(
          eq(items.id, itemId),
          eq(items.businessId, ctx.businessId),
        ))
        .returning({
          id: items.id,
          storeEnabled: items.storeEnabled,
          storePrice: items.storePrice,
          storeSortOrder: items.storeSortOrder,
          storeCategory: items.storeCategory,
          storeDescription: items.storeDescription,
        });

      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });
      return updated;
    }),

  // ── Orders ───────────────────────────────────────────────────

  listOrders: viewerProcedure
    .input(z.object({
      status: z.enum(storeOrderStatuses).nullish(),
      fromDate: z.string().datetime().nullish(),
      toDate: z.string().datetime().nullish(),
      search: z.string().nullish(), // search by name, phone, order number
      ...paginationSchema.shape,
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Store");
      const conditions = [eq(storeOrders.businessId, ctx.businessId)];

      if (input.status) conditions.push(eq(storeOrders.status, input.status));
      if (input.fromDate) conditions.push(gte(storeOrders.createdAt, new Date(input.fromDate)));
      if (input.toDate) conditions.push(lte(storeOrders.createdAt, new Date(input.toDate)));
      if (input.search) {
        const term = `%${input.search}%`;
        conditions.push(or(
          ilike(storeOrders.customerName, term),
          ilike(storeOrders.customerPhone, term),
          ilike(storeOrders.orderNumber, term),
        )!);
      }

      const offset = (input.page - 1) * input.limit;

      const [data, [{ count }]] = await Promise.all([
        ctx.db.select({
          id: storeOrders.id,
          orderNumber: storeOrders.orderNumber,
          status: storeOrders.status,
          customerName: storeOrders.customerName,
          customerPhone: storeOrders.customerPhone,
          customerEmail: storeOrders.customerEmail,
          deliveryAddress: storeOrders.deliveryAddress,
          deliveryCity: storeOrders.deliveryCity,
          deliveryPincode: storeOrders.deliveryPincode,
          totalAmount: storeOrders.totalAmount,
          itemCount: storeOrders.itemCount,
          invoiceId: storeOrders.invoiceId,
          createdAt: storeOrders.createdAt,
          confirmedAt: storeOrders.confirmedAt,
        }).from(storeOrders)
          .where(and(...conditions))
          .orderBy(desc(storeOrders.createdAt))
          .limit(input.limit)
          .offset(offset),
        ctx.db.select({ count: sql<number>`count(*)::int` }).from(storeOrders)
          .where(and(...conditions)),
      ]);

      return { data, total: count, page: input.page, limit: input.limit };
    }),

  getOrder: viewerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Store");

      const [order] = await ctx.db.select().from(storeOrders)
        .where(and(
          eq(storeOrders.id, input.id),
          eq(storeOrders.businessId, ctx.businessId),
        ))
        .limit(1);

      if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });

      // Fetch linked invoice + line items if available
      let invoice = null;
      let lineItems: typeof invoiceItems.$inferSelect[] = [];
      if (order.invoiceId) {
        const [inv] = await ctx.db.select().from(invoices)
          .where(eq(invoices.id, order.invoiceId))
          .limit(1);
        invoice = inv ?? null;

        if (invoice) {
          lineItems = await ctx.db.select().from(invoiceItems)
            .where(eq(invoiceItems.invoiceId, order.invoiceId))
            .orderBy(invoiceItems.sortOrder);
        }
      }

      return { ...order, invoice, lineItems };
    }),

  confirmOrder: memberProcedure
    .input(z.object({ orderId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Store");

      return ctx.db.transaction(async (tx) => {
        const [order] = await tx.select().from(storeOrders)
          .where(and(
            eq(storeOrders.id, input.orderId),
            eq(storeOrders.businessId, ctx.businessId),
          ))
          .limit(1);

        if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
        if (order.status !== "pending") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Cannot confirm an order with status "${order.status}"`,
          });
        }

        // Update order status
        await tx.update(storeOrders)
          .set({
            status: "confirmed",
            confirmedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(storeOrders.id, input.orderId));

        // Update linked invoice from draft → sent
        if (order.invoiceId) {
          await tx.update(invoices)
            .set({ status: "sent", updatedAt: new Date() })
            .where(eq(invoices.id, order.invoiceId));
        }

        return { success: true, orderId: input.orderId };
      });
    }),

  cancelOrder: memberProcedure
    .input(z.object({
      orderId: z.string().uuid(),
      reason: z.string().max(500).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Store");

      return ctx.db.transaction(async (tx) => {
        const [order] = await tx.select().from(storeOrders)
          .where(and(
            eq(storeOrders.id, input.orderId),
            eq(storeOrders.businessId, ctx.businessId),
          ))
          .limit(1);

        if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
        if (order.status === "delivered" || order.status === "cancelled") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Cannot cancel an order with status "${order.status}"`,
          });
        }

        // Update order status
        await tx.update(storeOrders)
          .set({
            status: "cancelled",
            cancellationReason: input.reason ?? null,
            cancelledAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(storeOrders.id, input.orderId));

        // Cancel linked invoice
        if (order.invoiceId) {
          await tx.update(invoices)
            .set({ status: "cancelled", updatedAt: new Date() })
            .where(eq(invoices.id, order.invoiceId));
        }

        return { success: true, orderId: input.orderId };
      });
    }),

  updateOrderStatus: memberProcedure
    .input(z.object({
      orderId: z.string().uuid(),
      status: z.enum(["preparing", "ready", "delivered"]),
    }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Store");

      const [order] = await ctx.db.select({ id: storeOrders.id, status: storeOrders.status })
        .from(storeOrders)
        .where(and(
          eq(storeOrders.id, input.orderId),
          eq(storeOrders.businessId, ctx.businessId),
        ))
        .limit(1);

      if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
      if (order.status === "cancelled") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot update a cancelled order" });
      }

      await ctx.db.update(storeOrders)
        .set({ status: input.status, updatedAt: new Date() })
        .where(eq(storeOrders.id, input.orderId));

      return { success: true, status: input.status };
    }),
});
