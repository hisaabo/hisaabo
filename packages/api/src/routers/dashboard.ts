import { eq, and, sql, desc, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { invoices, invoiceItems, items, payments, expenses, parties, businesses } from "@hisaabo/db";
import { money } from "@hisaabo/shared";
import { router, viewerProcedure } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";


export const dashboardRouter = router({
  summary: viewerProcedure
    .input(z.object({
      fromDate: z.string().datetime().optional(),
      toDate: z.string().datetime().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
    requireCan(ctx.ability, "read", "Report");
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

    // Use custom date range if provided, otherwise default to FY
    const periodStart = input?.fromDate ? new Date(input.fromDate) : fyStart;
    const periodEnd = input?.toDate ? new Date(input.toDate) : undefined;

    const dateCondition = (dateCol: Parameters<typeof gte>[0]) => {
      if (periodEnd) return and(gte(dateCol, periodStart), lte(dateCol, periodEnd));
      return gte(dateCol, periodStart);
    };

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
          dateCondition(invoices.invoiceDate),
        )),

      // Purchase total (FY)
      ctx.db.select({
        total: sql<string>`coalesce(sum(${invoices.totalAmount}::numeric), 0)::text`,
      }).from(invoices)
        .where(and(
          eq(invoices.businessId, ctx.businessId),
          eq(invoices.type, "purchase"),
          eq(invoices.documentType, "invoice"),
          dateCondition(invoices.invoiceDate),
        )),

      // Expense total (FY)
      ctx.db.select({
        total: sql<string>`coalesce(sum(${expenses.amount}::numeric), 0)::text`,
      }).from(expenses)
        .where(and(
          eq(expenses.businessId, ctx.businessId),
          dateCondition(expenses.expenseDate),
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

      // Cash in = payments received for sales (period-scoped)
      ctx.db.select({
        total: sql<string>`coalesce(sum(${payments.amount}::numeric), 0)::text`,
      }).from(payments)
        .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
        .where(and(
          eq(payments.businessId, ctx.businessId),
          eq(invoices.type, "sale"),
          dateCondition(payments.paymentDate),
        )),

      // Cash out = payments made for purchases (period-scoped)
      ctx.db.select({
        total: sql<string>`coalesce(sum(${payments.amount}::numeric), 0)::text`,
      }).from(payments)
        .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
        .where(and(
          eq(payments.businessId, ctx.businessId),
          eq(invoices.type, "purchase"),
          dateCondition(payments.paymentDate),
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
      requireCan(ctx.ability, "read", "Report");
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
      requireCan(ctx.ability, "read", "Report");
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
      requireCan(ctx.ability, "read", "Report");
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

  topCustomers: viewerProcedure
    .input(z.object({
      limit: z.number().int().min(3).max(20).default(5),
      fromDate: z.string().datetime().optional(),
      toDate: z.string().datetime().optional(),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");
      const conditions = [
        eq(invoices.businessId, ctx.businessId),
        eq(invoices.type, "sale"),
        eq(invoices.documentType, sql`'invoice'`),
        sql`${invoices.status} NOT IN ('draft', 'cancelled')`,
      ];
      if (input.fromDate) conditions.push(gte(invoices.invoiceDate, new Date(input.fromDate)));
      if (input.toDate) conditions.push(lte(invoices.invoiceDate, new Date(input.toDate)));

      const results = await ctx.db
        .select({
          partyId: parties.id,
          partyName: parties.name,
          totalAmount: sql<string>`SUM(${invoices.totalAmount}::numeric)::text`,
          invoiceCount: sql<number>`COUNT(*)::int`,
        })
        .from(invoices)
        .innerJoin(parties, eq(parties.id, invoices.partyId))
        .where(and(...conditions))
        .groupBy(parties.id, parties.name)
        .orderBy(sql`SUM(${invoices.totalAmount}::numeric) DESC`)
        .limit(input.limit);

      return results;
    }),

  topSellingItems: viewerProcedure
    .input(z.object({
      limit: z.number().int().min(3).max(20).default(5),
      itemType: z.enum(["product", "service"]).optional(),
      fromDate: z.string().datetime().optional(),
      toDate: z.string().datetime().optional(),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");
      const conditions = [
        eq(invoices.businessId, ctx.businessId),
        eq(invoices.type, "sale"),
        eq(invoices.documentType, sql`'invoice'`),
        sql`${invoices.status} NOT IN ('draft', 'cancelled')`,
      ];
      if (input.fromDate) conditions.push(gte(invoices.invoiceDate, new Date(input.fromDate)));
      if (input.toDate) conditions.push(lte(invoices.invoiceDate, new Date(input.toDate)));
      if (input.itemType) conditions.push(eq(items.itemType, input.itemType));

      const results = await ctx.db
        .select({
          itemId: invoiceItems.itemId,
          itemName: sql<string>`COALESCE(${items.name}, ${invoiceItems.description})`,
          unit: items.unit,
          totalQty: sql<string>`SUM(${invoiceItems.quantity}::numeric * COALESCE(${invoiceItems.conversionFactor}::numeric, 1))::text`,
          totalAmount: sql<string>`SUM(${invoiceItems.totalAmount}::numeric)::text`,
          invoiceCount: sql<number>`COUNT(DISTINCT ${invoices.id})::int`,
        })
        .from(invoiceItems)
        .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
        .leftJoin(items, eq(items.id, invoiceItems.itemId))
        .where(and(...conditions))
        .groupBy(invoiceItems.itemId, items.name, invoiceItems.description, items.unit)
        .orderBy(sql`SUM(${invoiceItems.totalAmount}::numeric) DESC`)
        .limit(input.limit);

      return results;
    }),

  expensesByCategory: viewerProcedure
    .input(z.object({
      fromDate: z.string().datetime().optional(),
      toDate: z.string().datetime().optional(),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");
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
      requireCan(ctx.ability, "read", "Report");
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

  profitAndLoss: viewerProcedure
    .input(z.object({
      fromDate: z.string().datetime().optional(),
      toDate: z.string().datetime().optional(),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const invConditions: any[] = [eq(invoices.businessId, ctx.businessId)];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const expConditions: any[] = [eq(expenses.businessId, ctx.businessId)];

      if (input.fromDate) {
        invConditions.push(gte(invoices.invoiceDate, new Date(input.fromDate)));
        expConditions.push(gte(expenses.expenseDate, new Date(input.fromDate)));
      }
      if (input.toDate) {
        invConditions.push(lte(invoices.invoiceDate, new Date(input.toDate)));
        expConditions.push(lte(expenses.expenseDate, new Date(input.toDate)));
      }

      const [
        [sales],
        [purchases],
        [expenseTotal],
        expenseBreakdown,
      ] = await Promise.all([
        ctx.db.select({
          total: sql<string>`COALESCE(SUM(${invoices.totalAmount}::numeric), 0)::text`,
        }).from(invoices)
          .where(and(...invConditions, eq(invoices.type, "sale"), eq(invoices.documentType, "invoice"), sql`${invoices.status} != 'cancelled'`)),

        ctx.db.select({
          total: sql<string>`COALESCE(SUM(${invoices.totalAmount}::numeric), 0)::text`,
        }).from(invoices)
          .where(and(...invConditions, eq(invoices.type, "purchase"), eq(invoices.documentType, "invoice"), sql`${invoices.status} != 'cancelled'`)),

        ctx.db.select({
          total: sql<string>`COALESCE(SUM(${expenses.amount}::numeric), 0)::text`,
        }).from(expenses)
          .where(and(...expConditions)),

        ctx.db.select({
          category: expenses.category,
          total: sql<string>`SUM(${expenses.amount}::numeric)::text`,
        }).from(expenses)
          .where(and(...expConditions))
          .groupBy(expenses.category)
          .orderBy(sql`SUM(${expenses.amount}::numeric) DESC`),
      ]);

      const revenue = sales.total;
      const cogs = purchases.total;
      const grossProfit = money.sub(revenue, cogs);
      const totalExpenses = expenseTotal.total;
      const netProfit = money.sub(grossProfit, totalExpenses);

      return {
        revenue,
        cogs,
        grossProfit,
        grossMarginPercent: money.toNumber(revenue) > 0
          ? ((money.toNumber(grossProfit) / money.toNumber(revenue)) * 100).toFixed(1)
          : "0.0",
        expenses: expenseBreakdown,
        totalExpenses,
        netProfit,
        netMarginPercent: money.toNumber(revenue) > 0
          ? ((money.toNumber(netProfit) / money.toNumber(revenue)) * 100).toFixed(1)
          : "0.0",
      };
    }),

  receivablesAging: viewerProcedure
    .query(async ({ ctx }) => {
      requireCan(ctx.ability, "read", "Report");

      const unpaidInvoices = await ctx.db.select({
        partyId: invoices.partyId,
        partyName: parties.name,
        invoiceNumber: invoices.invoiceNumber,
        invoiceDate: invoices.invoiceDate,
        dueDate: invoices.dueDate,
        totalAmount: invoices.totalAmount,
        amountPaid: invoices.amountPaid,
      }).from(invoices)
        .innerJoin(parties, eq(parties.id, invoices.partyId))
        .where(and(
          eq(invoices.businessId, ctx.businessId),
          eq(invoices.type, "sale"),
          eq(invoices.documentType, "invoice"),
          sql`${invoices.status} NOT IN ('paid', 'cancelled', 'draft')`,
        ))
        .orderBy(invoices.invoiceDate);

      const now = new Date();

      const partyBuckets = new Map<string, {
        partyName: string;
        current: number;
        days31_60: number;
        days61_90: number;
        days90Plus: number;
        total: number;
      }>();

      for (const inv of unpaidInvoices) {
        const outstanding = parseFloat(inv.totalAmount) - parseFloat(inv.amountPaid);
        if (outstanding <= 0) continue;

        const refDate = inv.dueDate || inv.invoiceDate;
        const daysOld = Math.floor((now.getTime() - new Date(refDate).getTime()) / (1000 * 60 * 60 * 24));

        const existing = partyBuckets.get(inv.partyId) ?? {
          partyName: inv.partyName,
          current: 0,
          days31_60: 0,
          days61_90: 0,
          days90Plus: 0,
          total: 0,
        };

        if (daysOld <= 30) existing.current += outstanding;
        else if (daysOld <= 60) existing.days31_60 += outstanding;
        else if (daysOld <= 90) existing.days61_90 += outstanding;
        else existing.days90Plus += outstanding;
        existing.total += outstanding;

        partyBuckets.set(inv.partyId, existing);
      }

      const rows = [...partyBuckets.entries()]
        .map(([partyId, data]) => ({ partyId, ...data }))
        .sort((a, b) => b.total - a.total);

      const summary = rows.reduce(
        (acc, r) => ({
          current: acc.current + r.current,
          days31_60: acc.days31_60 + r.days31_60,
          days61_90: acc.days61_90 + r.days61_90,
          days90Plus: acc.days90Plus + r.days90Plus,
          total: acc.total + r.total,
        }),
        { current: 0, days31_60: 0, days61_90: 0, days90Plus: 0, total: 0 }
      );

      return {
        rows: rows.map((r) => ({
          partyId: r.partyId,
          partyName: r.partyName,
          current: r.current.toFixed(2),
          days31_60: r.days31_60.toFixed(2),
          days61_90: r.days61_90.toFixed(2),
          days90Plus: r.days90Plus.toFixed(2),
          total: r.total.toFixed(2),
        })),
        summary: {
          current: summary.current.toFixed(2),
          days31_60: summary.days31_60.toFixed(2),
          days61_90: summary.days61_90.toFixed(2),
          days90Plus: summary.days90Plus.toFixed(2),
          total: summary.total.toFixed(2),
        },
      };
    }),

  // ── Payment Mode Breakdown ────────────────────────────────────────────────

  paymentModeBreakdown: viewerProcedure
    .input(z.object({
      fromDate: z.string().datetime().optional(),
      toDate: z.string().datetime().optional(),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");
      const conditions = [
        eq(payments.businessId, ctx.businessId),
        sql`${payments.deletedAt} IS NULL`,
      ];
      if (input.fromDate) conditions.push(gte(payments.paymentDate, new Date(input.fromDate)));
      if (input.toDate) conditions.push(lte(payments.paymentDate, new Date(input.toDate)));

      const results = await ctx.db
        .select({
          mode: payments.mode,
          total: sql<string>`SUM(${payments.amount}::numeric)::text`,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(payments)
        .where(and(...conditions))
        .groupBy(payments.mode)
        .orderBy(sql`SUM(${payments.amount}::numeric) DESC`);

      return results;
    }),

  // ── Collection Efficiency ─────────────────────────────────────────────────

  collectionEfficiency: viewerProcedure
    .input(z.object({
      fromDate: z.string().datetime().optional(),
      toDate: z.string().datetime().optional(),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");

      // Current period
      const currConditions = [
        eq(invoices.businessId, ctx.businessId),
        eq(invoices.type, "sale"),
        eq(invoices.documentType, "invoice"),
        sql`${invoices.status} NOT IN ('draft', 'cancelled')`,
      ];
      if (input.fromDate) currConditions.push(gte(invoices.invoiceDate, new Date(input.fromDate)));
      if (input.toDate) currConditions.push(lte(invoices.invoiceDate, new Date(input.toDate)));

      const [curr] = await ctx.db
        .select({
          totalInvoiced: sql<string>`COALESCE(SUM(${invoices.totalAmount}::numeric), 0)::text`,
          totalCollected: sql<string>`COALESCE(SUM(${invoices.amountPaid}::numeric), 0)::text`,
          invoiceCount: sql<number>`COUNT(*)::int`,
        })
        .from(invoices)
        .where(and(...currConditions));

      // Previous period — same duration, shifted back
      let prevTotalInvoiced = "0";
      let prevTotalCollected = "0";

      if (input.fromDate && input.toDate) {
        const from = new Date(input.fromDate);
        const to = new Date(input.toDate);
        const durationMs = to.getTime() - from.getTime();
        const prevFrom = new Date(from.getTime() - durationMs);
        const prevTo = new Date(from.getTime() - 1);

        const prevConditions = [
          eq(invoices.businessId, ctx.businessId),
          eq(invoices.type, "sale"),
          eq(invoices.documentType, "invoice"),
          sql`${invoices.status} NOT IN ('draft', 'cancelled')`,
          gte(invoices.invoiceDate, prevFrom),
          lte(invoices.invoiceDate, prevTo),
        ];

        const [prev] = await ctx.db
          .select({
            totalInvoiced: sql<string>`COALESCE(SUM(${invoices.totalAmount}::numeric), 0)::text`,
            totalCollected: sql<string>`COALESCE(SUM(${invoices.amountPaid}::numeric), 0)::text`,
          })
          .from(invoices)
          .where(and(...prevConditions));

        prevTotalInvoiced = prev?.totalInvoiced ?? "0";
        prevTotalCollected = prev?.totalCollected ?? "0";
      }

      const invoiced = parseFloat(curr?.totalInvoiced ?? "0");
      const collected = parseFloat(curr?.totalCollected ?? "0");
      const efficiencyPct = invoiced > 0 ? Math.round((collected / invoiced) * 100) : 0;

      const prevInvoiced = parseFloat(prevTotalInvoiced);
      const prevCollected = parseFloat(prevTotalCollected);
      const prevEfficiencyPct = prevInvoiced > 0 ? Math.round((prevCollected / prevInvoiced) * 100) : null;

      return {
        totalInvoiced: curr?.totalInvoiced ?? "0",
        totalCollected: curr?.totalCollected ?? "0",
        efficiencyPct,
        prevEfficiencyPct,
        invoiceCount: curr?.invoiceCount ?? 0,
      };
    }),

  // ── Expense Category Breakdown ────────────────────────────────────────────

  expenseCategoryBreakdown: viewerProcedure
    .input(z.object({
      fromDate: z.string().datetime().optional(),
      toDate: z.string().datetime().optional(),
      limit: z.number().int().min(3).max(20).default(8),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");
      const conditions = [
        eq(expenses.businessId, ctx.businessId),
        sql`${expenses.deletedAt} IS NULL`,
      ];
      if (input.fromDate) conditions.push(gte(expenses.expenseDate, new Date(input.fromDate)));
      if (input.toDate) conditions.push(lte(expenses.expenseDate, new Date(input.toDate)));

      const results = await ctx.db
        .select({
          category: expenses.category,
          total: sql<string>`SUM(${expenses.amount}::numeric)::text`,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(expenses)
        .where(and(...conditions))
        .groupBy(expenses.category)
        .orderBy(sql`SUM(${expenses.amount}::numeric) DESC`)
        .limit(input.limit);

      const [grandTotal] = await ctx.db
        .select({
          total: sql<string>`COALESCE(SUM(${expenses.amount}::numeric), 0)::text`,
        })
        .from(expenses)
        .where(and(...conditions));

      return {
        categories: results,
        grandTotal: grandTotal?.total ?? "0",
      };
    }),

  // ── Monthly Comparison ────────────────────────────────────────────────────

  monthlyComparison: viewerProcedure
    .query(async ({ ctx }) => {
      requireCan(ctx.ability, "read", "Report");

      const now = new Date();
      const currMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const currMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

      const [
        [currSales],
        [prevSales],
        [currExpenses],
        [prevExpenses],
        [currPurchases],
        [prevPurchases],
      ] = await Promise.all([
        ctx.db.select({
          total: sql<string>`COALESCE(SUM(${invoices.totalAmount}::numeric), 0)::text`,
        }).from(invoices).where(and(
          eq(invoices.businessId, ctx.businessId),
          eq(invoices.type, "sale"),
          eq(invoices.documentType, "invoice"),
          sql`${invoices.status} NOT IN ('draft', 'cancelled')`,
          gte(invoices.invoiceDate, currMonthStart),
          lte(invoices.invoiceDate, currMonthEnd),
        )),

        ctx.db.select({
          total: sql<string>`COALESCE(SUM(${invoices.totalAmount}::numeric), 0)::text`,
        }).from(invoices).where(and(
          eq(invoices.businessId, ctx.businessId),
          eq(invoices.type, "sale"),
          eq(invoices.documentType, "invoice"),
          sql`${invoices.status} NOT IN ('draft', 'cancelled')`,
          gte(invoices.invoiceDate, prevMonthStart),
          lte(invoices.invoiceDate, prevMonthEnd),
        )),

        ctx.db.select({
          total: sql<string>`COALESCE(SUM(${expenses.amount}::numeric), 0)::text`,
        }).from(expenses).where(and(
          eq(expenses.businessId, ctx.businessId),
          gte(expenses.expenseDate, currMonthStart),
          lte(expenses.expenseDate, currMonthEnd),
        )),

        ctx.db.select({
          total: sql<string>`COALESCE(SUM(${expenses.amount}::numeric), 0)::text`,
        }).from(expenses).where(and(
          eq(expenses.businessId, ctx.businessId),
          gte(expenses.expenseDate, prevMonthStart),
          lte(expenses.expenseDate, prevMonthEnd),
        )),

        ctx.db.select({
          total: sql<string>`COALESCE(SUM(${invoices.totalAmount}::numeric), 0)::text`,
        }).from(invoices).where(and(
          eq(invoices.businessId, ctx.businessId),
          eq(invoices.type, "purchase"),
          eq(invoices.documentType, "invoice"),
          sql`${invoices.status} NOT IN ('draft', 'cancelled')`,
          gte(invoices.invoiceDate, currMonthStart),
          lte(invoices.invoiceDate, currMonthEnd),
        )),

        ctx.db.select({
          total: sql<string>`COALESCE(SUM(${invoices.totalAmount}::numeric), 0)::text`,
        }).from(invoices).where(and(
          eq(invoices.businessId, ctx.businessId),
          eq(invoices.type, "purchase"),
          eq(invoices.documentType, "invoice"),
          sql`${invoices.status} NOT IN ('draft', 'cancelled')`,
          gte(invoices.invoiceDate, prevMonthStart),
          lte(invoices.invoiceDate, prevMonthEnd),
        )),
      ]);

      function pctChange(curr: string, prev: string): number | null {
        const c = parseFloat(curr);
        const p = parseFloat(prev);
        if (p === 0) return null;
        return Math.round(((c - p) / p) * 100);
      }

      const currMonthName = currMonthStart.toLocaleString("en-IN", { month: "short", year: "2-digit" });
      const prevMonthName = prevMonthStart.toLocaleString("en-IN", { month: "short", year: "2-digit" });

      return {
        currMonth: currMonthName,
        prevMonth: prevMonthName,
        sales: {
          curr: currSales?.total ?? "0",
          prev: prevSales?.total ?? "0",
          pctChange: pctChange(currSales?.total ?? "0", prevSales?.total ?? "0"),
        },
        purchases: {
          curr: currPurchases?.total ?? "0",
          prev: prevPurchases?.total ?? "0",
          pctChange: pctChange(currPurchases?.total ?? "0", prevPurchases?.total ?? "0"),
        },
        expenses: {
          curr: currExpenses?.total ?? "0",
          prev: prevExpenses?.total ?? "0",
          pctChange: pctChange(currExpenses?.total ?? "0", prevExpenses?.total ?? "0"),
        },
      };
    }),
});
