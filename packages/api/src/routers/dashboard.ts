import { eq, and, sql, desc, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { invoices, payments, expenses, parties, businesses } from "@hisaabo/db";
import { router, viewerProcedure } from "../trpc.js";

export const dashboardRouter = router({
  summary: viewerProcedure.query(async ({ ctx }) => {
    // Fetch business to get financialYearStart (1-indexed month, e.g. 4 = April)
    const [biz] = await ctx.db
      .select({ financialYearStart: businesses.financialYearStart })
      .from(businesses)
      .where(eq(businesses.id, ctx.businessId))
      .limit(1);

    const fyStartMonth = (biz?.financialYearStart ?? 4) - 1; // convert to 0-indexed

    const now = new Date();
    // If current month is before FY start month, the FY started last year
    const fyYear = now.getMonth() < fyStartMonth ? now.getFullYear() - 1 : now.getFullYear();
    const fyStart = new Date(fyYear, fyStartMonth, 1);

    const fyCondition = (dateCol: Parameters<typeof gte>[0]) => gte(dateCol, fyStart);

    const [salesResult] = await ctx.db.select({
      total: sql<string>`coalesce(sum(${invoices.totalAmount}::numeric), 0)::text`,
    }).from(invoices)
      .where(and(
        eq(invoices.businessId, ctx.businessId),
        eq(invoices.type, "sale"),
        eq(invoices.documentType, "invoice"),
        fyCondition(invoices.invoiceDate),
      ));

    const [purchaseResult] = await ctx.db.select({
      total: sql<string>`coalesce(sum(${invoices.totalAmount}::numeric), 0)::text`,
    }).from(invoices)
      .where(and(
        eq(invoices.businessId, ctx.businessId),
        eq(invoices.type, "purchase"),
        eq(invoices.documentType, "invoice"),
        fyCondition(invoices.invoiceDate),
      ));

    const [expenseResult] = await ctx.db.select({
      total: sql<string>`coalesce(sum(${expenses.amount}::numeric), 0)::text`,
    }).from(expenses)
      .where(and(
        eq(expenses.businessId, ctx.businessId),
        fyCondition(expenses.expenseDate),
      ));

    // Receivable = total sale invoices - amount paid on sales
    const [receivableResult] = await ctx.db.select({
      total: sql<string>`coalesce(sum(${invoices.totalAmount}::numeric - ${invoices.amountPaid}::numeric), 0)::text`,
    }).from(invoices)
      .where(and(
        eq(invoices.businessId, ctx.businessId),
        eq(invoices.type, "sale"),
        eq(invoices.documentType, "invoice"),
        sql`${invoices.status} NOT IN ('paid', 'cancelled')`,
      ));

    // Payable = total purchase invoices - amount paid on purchases
    const [payableResult] = await ctx.db.select({
      total: sql<string>`coalesce(sum(${invoices.totalAmount}::numeric - ${invoices.amountPaid}::numeric), 0)::text`,
    }).from(invoices)
      .where(and(
        eq(invoices.businessId, ctx.businessId),
        eq(invoices.type, "purchase"),
        eq(invoices.documentType, "invoice"),
        sql`${invoices.status} NOT IN ('paid', 'cancelled')`,
      ));

    // Recent invoices
    const recentInvoices = await ctx.db.select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      partyName: parties.name,
      totalAmount: invoices.totalAmount,
      status: invoices.status,
      invoiceDate: invoices.invoiceDate,
    }).from(invoices)
      .innerJoin(parties, eq(parties.id, invoices.partyId))
      .where(and(
        eq(invoices.businessId, ctx.businessId),
        eq(invoices.documentType, "invoice"),
      ))
      .orderBy(desc(invoices.createdAt))
      .limit(10);

    // Cash in hand = all payments received (in) - all payments made (out) - expenses
    const [cashIn] = await ctx.db.select({
      total: sql<string>`coalesce(sum(${payments.amount}::numeric), 0)::text`,
    }).from(payments)
      .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
      .where(and(
        eq(payments.businessId, ctx.businessId),
        eq(invoices.type, "sale"),
      ));

    const [cashOut] = await ctx.db.select({
      total: sql<string>`coalesce(sum(${payments.amount}::numeric), 0)::text`,
    }).from(payments)
      .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
      .where(and(
        eq(payments.businessId, ctx.businessId),
        eq(invoices.type, "purchase"),
      ));

    const cashInHand = (
      parseFloat(cashIn.total) -
      parseFloat(cashOut.total) -
      parseFloat(expenseResult.total)
    ).toFixed(2);

    return {
      totalSales: salesResult.total,
      totalPurchases: purchaseResult.total,
      totalExpenses: expenseResult.total,
      receivable: receivableResult.total,
      payable: payableResult.total,
      cashInHand,
      fyStart: fyStart.toISOString(),
      recentInvoices: recentInvoices.map((inv) => ({
        ...inv,
        invoiceDate: inv.invoiceDate.toISOString(),
      })),
    };
  }),

  shippingSummary: viewerProcedure
    .input(z.object({
      fromDate: z.string().datetime().optional(),
      toDate: z.string().datetime().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const conditions = [
        eq(invoices.businessId, ctx.businessId),
        eq(invoices.documentType, "invoice"),
        sql`${invoices.status} != 'cancelled'`,
      ];

      if (input?.fromDate) conditions.push(gte(invoices.invoiceDate, new Date(input.fromDate)));
      if (input?.toDate) conditions.push(lte(invoices.invoiceDate, new Date(input.toDate)));

      const [shippingCharged] = await ctx.db.select({
        total: sql<string>`COALESCE(SUM(
          (SELECT COALESCE(SUM((elem->>'amount')::numeric), 0)
           FROM jsonb_array_elements(${invoices.charges}) AS elem
           WHERE LOWER(elem->>'label') IN ('shipping', 'freight', 'delivery', 'courier'))
        ), 0)::text`,
      })
        .from(invoices)
        .where(and(...conditions, sql`${invoices.charges} IS NOT NULL`));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const expenseConditions: any[] = [
        eq(expenses.businessId, ctx.businessId),
        sql`LOWER(${expenses.category}) IN ('shipping', 'freight', 'delivery', 'courier')`,
      ];
      if (input?.fromDate) expenseConditions.push(gte(expenses.expenseDate, new Date(input.fromDate)));
      if (input?.toDate) expenseConditions.push(lte(expenses.expenseDate, new Date(input.toDate)));

      const [shippingExpenses] = await ctx.db.select({
        total: sql<string>`COALESCE(SUM(${expenses.amount}::numeric), 0)::text`,
      })
        .from(expenses)
        .where(and(...expenseConditions));

      const charged = parseFloat(shippingCharged.total);
      const spent = parseFloat(shippingExpenses.total);

      return {
        charged: charged.toFixed(2),
        spent: spent.toFixed(2),
        net: (charged - spent).toFixed(2),
      };
    }),
});
