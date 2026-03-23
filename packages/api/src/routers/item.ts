import { eq, and, ilike, sql, desc } from "drizzle-orm";
import { z } from "zod";
import { items, invoiceItems, invoices, parties } from "@hisaabo/db";
import { createItemSchema, updateItemSchema, paginationSchema, itemTypes } from "@hisaabo/shared";
import { router, businessProcedure } from "../trpc.js";

export const itemRouter = router({
  list: businessProcedure
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

  getById: businessProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const [item] = await ctx.db.select().from(items)
        .where(and(eq(items.id, input.id), eq(items.businessId, ctx.businessId)))
        .limit(1);
      return item ?? null;
    }),

  create: businessProcedure.input(createItemSchema).mutation(async ({ input, ctx }) => {
    const [item] = await ctx.db.insert(items).values({
      ...input,
      businessId: ctx.businessId,
    }).returning();
    return item;
  }),

  update: businessProcedure
    .input(z.object({ id: z.string().uuid(), data: updateItemSchema }))
    .mutation(async ({ input, ctx }) => {
      const [item] = await ctx.db.update(items)
        .set({ ...input.data, updatedAt: new Date() })
        .where(and(eq(items.id, input.id), eq(items.businessId, ctx.businessId)))
        .returning();
      return item;
    }),

  delete: businessProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.db.delete(items)
        .where(and(eq(items.id, input.id), eq(items.businessId, ctx.businessId)));
      return { success: true };
    }),

  // Price history: every price this item was sold/purchased at, derived from invoice line items
  priceHistory: businessProcedure
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
  stockMovements: businessProcedure
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
  relatedInvoices: businessProcedure
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
  topBuyers: businessProcedure
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

  lowStockCount: businessProcedure.query(async ({ ctx }) => {
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
