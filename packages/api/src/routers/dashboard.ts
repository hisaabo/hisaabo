import { eq, and, sql, desc, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { invoices, payments, expenses, parties, businesses } from "@hisaabo/db";
import { money } from "@hisaabo/shared";
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

    const [
      [salesResult],
      [purchaseResult],
      [expenseResult],
      [receivableResult],
      [payableResult],
      recentInvoices,
      [cashIn],
      [cashOut],
    ] = await Promise.all([
      // Sales total (FY)
      ctx.db.select({
        total: sql<string>`coalesce(sum(${invoices.totalAmount}::numeric), 0)::text`,
      }).from(invoices)
        .where(and(
          eq(invoices.businessId, ctx.businessId),
          eq(invoices.type, "sale"),
          eq(invoices.documentType, "invoice"),
          fyCondition(invoices.invoiceDate),
        )),

      // Purchase total (FY)
      ctx.db.select({
        total: sql<string>`coalesce(sum(${invoices.totalAmount}::numeric), 0)::text`,
      }).from(invoices)
        .where(and(
          eq(invoices.businessId, ctx.businessId),
          eq(invoices.type, "purchase"),
          eq(invoices.documentType, "invoice"),
          fyCondition(invoices.invoiceDate),
        )),

      // Expense total (FY)
      ctx.db.select({
        total: sql<string>`coalesce(sum(${expenses.amount}::numeric), 0)::text`,
      }).from(expenses)
        .where(and(
          eq(expenses.businessId, ctx.businessId),
          fyCondition(expenses.expenseDate),
        )),

      // Receivable = total sale invoices - amount paid on sales
      ctx.db.select({
        total: sql<string>`coalesce(sum(${invoices.totalAmount}::numeric - ${invoices.amountPaid}::numeric), 0)::text`,
      }).from(invoices)
        .where(and(
          eq(invoices.businessId, ctx.businessId),
          eq(invoices.type, "sale"),
          eq(invoices.documentType, "invoice"),
          sql`${invoices.status} NOT IN ('paid', 'cancelled')`,
        )),

      // Payable = total purchase invoices - amount paid on purchases
      ctx.db.select({
        total: sql<string>`coalesce(sum(${invoices.totalAmount}::numeric - ${invoices.amountPaid}::numeric), 0)::text`,
      }).from(invoices)
        .where(and(
          eq(invoices.businessId, ctx.businessId),
          eq(invoices.type, "purchase"),
          eq(invoices.documentType, "invoice"),
          sql`${invoices.status} NOT IN ('paid', 'cancelled')`,
        )),

      // Recent invoices
      ctx.db.select({
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
        .limit(10),

      // Cash in hand = all payments received (in) - all payments made (out) - expenses
      ctx.db.select({
        total: sql<string>`coalesce(sum(${payments.amount}::numeric), 0)::text`,
      }).from(payments)
        .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
        .where(and(
          eq(payments.businessId, ctx.businessId),
          eq(invoices.type, "sale"),
        )),

      ctx.db.select({
        total: sql<string>`coalesce(sum(${payments.amount}::numeric), 0)::text`,
      }).from(payments)
        .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
        .where(and(
          eq(payments.businessId, ctx.businessId),
          eq(invoices.type, "purchase"),
        )),
    ]);

    const cashInHand = money.sub(
      money.sub(cashIn.total || "0", cashOut.total || "0"),
      expenseResult.total || "0",
    );

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

      return {
        charged: money.add(shippingCharged.total || "0", "0"),
        spent: money.add(shippingExpenses.total || "0", "0"),
        net: money.sub(shippingCharged.total || "0", shippingExpenses.total || "0"),
      };
    }),

  salesTrend: viewerProcedure
    .input(z.object({
      months: z.number().int().min(3).max(24).default(6),
      fromDate: z.string().datetime().optional(),
      toDate: z.string().datetime().optional(),
    }))
    .query(async ({ input, ctx }) => {
      // If fromDate/toDate are provided, derive the month range from them.
      // Otherwise fall back to the last N months from today.
      let rangeStart: Date;
      let rangeEnd: Date;

      if (input.fromDate) {
        rangeStart = new Date(input.fromDate);
      } else {
        const d = new Date();
        d.setDate(1);
        d.setMonth(d.getMonth() - (input.months - 1));
        rangeStart = d;
      }

      if (input.toDate) {
        rangeEnd = new Date(input.toDate);
      } else {
        rangeEnd = new Date();
      }

      const results = await ctx.db.execute(sql`
        WITH months AS (
          SELECT generate_series(
            date_trunc('month', ${rangeStart.toISOString()}::timestamptz),
            date_trunc('month', ${rangeEnd.toISOString()}::timestamptz),
            '1 month'::interval
          ) as month_start
        )
        SELECT
          m.month_start,
          COALESCE((
            SELECT SUM(total_amount::numeric)
            FROM invoices
            WHERE business_id = ${ctx.businessId}
              AND type = 'sale' AND document_type = 'invoice'
              AND invoice_date >= m.month_start
              AND invoice_date < m.month_start + '1 month'::interval
          ), 0)::text as invoiced,
          COALESCE((
            SELECT SUM(amount::numeric)
            FROM payments
            WHERE business_id = ${ctx.businessId}
              AND payment_date >= m.month_start
              AND payment_date < m.month_start + '1 month'::interval
          ), 0)::text as collected
        FROM months m
        ORDER BY m.month_start ASC
      `);

      return (results as unknown as Array<{ month_start: Date; invoiced: string; collected: string }>).map(r => ({
        month: new Date(r.month_start).toISOString(),
        invoiced: r.invoiced,
        collected: r.collected,
      }));
    }),

  topOutstanding: viewerProcedure
    .input(z.object({ limit: z.number().int().min(3).max(20).default(5) }))
    .query(async ({ input, ctx }) => {
      const results = await ctx.db
        .select({
          partyId: parties.id,
          partyName: parties.name,
          outstanding: sql<string>`(
            COALESCE(${parties.openingBalance}::numeric, 0) +
            COALESCE(SUM(CASE WHEN ${invoices.type} = 'sale' THEN ${invoices.totalAmount}::numeric - ${invoices.amountPaid}::numeric ELSE 0 END), 0)
          )::text`,
        })
        .from(parties)
        .leftJoin(invoices, and(
          eq(invoices.partyId, parties.id),
          eq(invoices.businessId, ctx.businessId),
          eq(invoices.documentType, sql`'invoice'`),
          sql`${invoices.status} NOT IN ('paid', 'cancelled')`,
        ))
        .where(and(eq(parties.businessId, ctx.businessId), eq(parties.type, "customer")))
        .groupBy(parties.id, parties.name, parties.openingBalance)
        .having(sql`(
          COALESCE(${parties.openingBalance}::numeric, 0) +
          COALESCE(SUM(CASE WHEN ${invoices.type} = 'sale' THEN ${invoices.totalAmount}::numeric - ${invoices.amountPaid}::numeric ELSE 0 END), 0)
        ) > 0`)
        .orderBy(sql`(
          COALESCE(${parties.openingBalance}::numeric, 0) +
          COALESCE(SUM(CASE WHEN ${invoices.type} = 'sale' THEN ${invoices.totalAmount}::numeric - ${invoices.amountPaid}::numeric ELSE 0 END), 0)
        ) DESC`)
        .limit(input.limit);

      return results;
    }),

  expensesByCategory: viewerProcedure
    .input(z.object({
      fromDate: z.string().datetime().optional(),
      toDate: z.string().datetime().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const conditions = [eq(expenses.businessId, ctx.businessId)];
      if (input.fromDate) conditions.push(gte(expenses.expenseDate, new Date(input.fromDate)));
      if (input.toDate) conditions.push(lte(expenses.expenseDate, new Date(input.toDate)));

      return ctx.db
        .select({
          category: expenses.category,
          total: sql<string>`SUM(${expenses.amount}::numeric)::text`,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(expenses)
        .where(and(...conditions))
        .groupBy(expenses.category)
        .orderBy(sql`SUM(${expenses.amount}::numeric) DESC`);
    }),

  invoiceStatusBreakdown: viewerProcedure
    .input(z.object({
      fromDate: z.string().datetime().optional(),
      toDate: z.string().datetime().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const conditions = [
        eq(invoices.businessId, ctx.businessId),
        eq(invoices.documentType, sql`'invoice'`),
      ];
      if (input.fromDate) conditions.push(gte(invoices.invoiceDate, new Date(input.fromDate)));
      if (input.toDate) conditions.push(lte(invoices.invoiceDate, new Date(input.toDate)));

      return ctx.db
        .select({
          status: invoices.status,
          count: sql<number>`COUNT(*)::int`,
          total: sql<string>`SUM(${invoices.totalAmount}::numeric)::text`,
        })
        .from(invoices)
        .where(and(...conditions))
        .groupBy(invoices.status)
        .orderBy(sql`COUNT(*) DESC`);
    }),
});
