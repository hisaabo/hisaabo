import { eq, and, sql, desc, gte, lte, isNull } from "drizzle-orm";
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

    // When no input is provided (All Time), skip date filtering entirely.
    // When dates are provided, scope to that range. When only fromDate is
    // provided (e.g. a preset like "This FY"), filter from that date onward.
    const hasDateFilter = !!input?.fromDate || !!input?.toDate;
    const periodStart = input?.fromDate ? new Date(input.fromDate) : fyStart;
    const periodEnd = input?.toDate ? new Date(input.toDate) : undefined;

    const dateCondition = (dateCol: Parameters<typeof gte>[0]) => {
      if (!hasDateFilter) return undefined; // All Time — no date filter
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
          isNull(invoices.deletedAt),
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
          isNull(invoices.deletedAt),
          dateCondition(invoices.invoiceDate),
        )),

      // Expense total (FY)
      ctx.db.select({
        total: sql<string>`coalesce(sum(${expenses.amount}::numeric), 0)::text`,
      }).from(expenses)
        .where(and(
          eq(expenses.businessId, ctx.businessId),
          isNull(expenses.deletedAt),
          dateCondition(expenses.expenseDate),
        )),

      // Receivable = current outstanding balance (balance sheet metric, NOT period-scoped)
      ctx.db.select({
        total: sql<string>`coalesce(sum(${invoices.totalAmount}::numeric - ${invoices.amountPaid}::numeric), 0)::text`,
      }).from(invoices)
        .where(and(
          eq(invoices.businessId, ctx.businessId),
          eq(invoices.type, "sale"),
          eq(invoices.documentType, "invoice"),
          isNull(invoices.deletedAt),
          sql`${invoices.status} NOT IN ('paid', 'cancelled')`,
        )),

      // Payable = current outstanding balance (balance sheet metric, NOT period-scoped)
      ctx.db.select({
        total: sql<string>`coalesce(sum(${invoices.totalAmount}::numeric - ${invoices.amountPaid}::numeric), 0)::text`,
      }).from(invoices)
        .where(and(
          eq(invoices.businessId, ctx.businessId),
          eq(invoices.type, "purchase"),
          eq(invoices.documentType, "invoice"),
          isNull(invoices.deletedAt),
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
          isNull(invoices.deletedAt),
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
        isNull(invoices.deletedAt),
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
        isNull(expenses.deletedAt),
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
      granularity: z.enum(["week", "month", "fy"]).default("month"),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");

      // Fetch business financialYearStart (1-indexed month, e.g. 4 = April)
      const [biz] = await ctx.db
        .select({ financialYearStart: businesses.financialYearStart })
        .from(businesses)
        .where(eq(businesses.id, ctx.businessId))
        .limit(1);

      const fyStartMonth = biz?.financialYearStart ?? 4; // 1-indexed, e.g. 4 = April

      // ── FY granularity: group by financial year ────────────────
      if (input.granularity === "fy") {
        // CASE expression maps a date to the FY start year:
        //   April 2023 – March 2024  →  2023
        //   Jan  2024  (before April) →  2023
        const fyResults = await ctx.db.execute(sql`
          SELECT
            CASE
              WHEN EXTRACT(MONTH FROM invoice_date) >= ${fyStartMonth}
                THEN EXTRACT(YEAR FROM invoice_date)::int
              ELSE (EXTRACT(YEAR FROM invoice_date) - 1)::int
            END AS fy_year,
            COALESCE(SUM(total_amount::numeric), 0)::text AS invoiced
          FROM invoices
          WHERE business_id = ${ctx.businessId}
            AND type = 'sale'
            AND document_type = 'invoice'
          GROUP BY fy_year
          ORDER BY fy_year DESC
          LIMIT 5
        `);

        // Collected amounts per FY (join payments to invoices to scope by sale invoices only)
        const fyCollected = await ctx.db.execute(sql`
          SELECT
            CASE
              WHEN EXTRACT(MONTH FROM p.payment_date) >= ${fyStartMonth}
                THEN EXTRACT(YEAR FROM p.payment_date)::int
              ELSE (EXTRACT(YEAR FROM p.payment_date) - 1)::int
            END AS fy_year,
            COALESCE(SUM(p.amount::numeric), 0)::text AS collected
          FROM payments p
          WHERE p.business_id = ${ctx.businessId}
          GROUP BY fy_year
          ORDER BY fy_year DESC
          LIMIT 5
        `);

        type FyRow = { fy_year: number; invoiced?: string; collected?: string };
        const rows = fyResults as unknown as FyRow[];
        const collectedMap = new Map(
          (fyCollected as unknown as FyRow[]).map(r => [r.fy_year, r.collected ?? "0"])
        );

        // Return most recent 5 FYs ascending
        return rows
          .slice(0, 5)
          .reverse()
          .map(r => ({
            period: String(r.fy_year),
            invoiced: r.invoiced ?? "0",
            collected: collectedMap.get(r.fy_year) ?? "0",
          }));
      }

      // ── Week / Month granularity: generate_series bucketing ───
      // If fromDate/toDate are provided, derive the range from them.
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

      const stepInterval = input.granularity === "week" ? "1 week" : "1 month";

      // Week: use raw fromDate/toDate so buckets align to the selected
      // period (e.g. March 1 for calendar months) rather than snapping to
      // ISO week boundaries which can bleed into adjacent months.
      // Month: date_trunc ensures buckets always start on the 1st.
      const useRawBounds = input.granularity === "week";
      const seriesStart = useRawBounds
        ? sql`${rangeStart.toISOString()}::timestamptz`
        : sql`date_trunc('month', ${rangeStart.toISOString()}::timestamptz)`;
      const seriesEnd = useRawBounds
        ? sql`${rangeEnd.toISOString()}::timestamptz`
        : sql`date_trunc('month', ${rangeEnd.toISOString()}::timestamptz)`;

      const results = await ctx.db.execute(sql`
        WITH periods AS (
          SELECT generate_series(
            ${seriesStart},
            ${seriesEnd},
            ${stepInterval}::interval
          ) as period_start
        )
        SELECT
          p.period_start,
          COALESCE((
            SELECT SUM(total_amount::numeric)
            FROM invoices
            WHERE business_id = ${ctx.businessId}
              AND type = 'sale' AND document_type = 'invoice'
              AND invoice_date >= p.period_start
              AND invoice_date < p.period_start + ${stepInterval}::interval
          ), 0)::text as invoiced,
          COALESCE((
            SELECT SUM(amount::numeric)
            FROM payments
            WHERE business_id = ${ctx.businessId}
              AND payment_date >= p.period_start
              AND payment_date < p.period_start + ${stepInterval}::interval
          ), 0)::text as collected
        FROM periods p
        ORDER BY p.period_start ASC
      `);

      return (results as unknown as Array<{ period_start: Date; invoiced: string; collected: string }>).map(r => ({
        period: new Date(r.period_start).toISOString(),
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
          // Prefer live item name, fall back to the frozen snapshot stored
          // on the invoice line (post-rename: invoice_items.item_name).
          itemName: sql<string>`COALESCE(${items.name}, ${invoiceItems.itemName})`,
          unit: items.unit,
          totalQty: sql<string>`SUM(${invoiceItems.quantity}::numeric * COALESCE(${invoiceItems.conversionFactor}::numeric, 1))::text`,
          totalAmount: sql<string>`SUM(${invoiceItems.totalAmount}::numeric)::text`,
          invoiceCount: sql<number>`COUNT(DISTINCT ${invoices.id})::int`,
        })
        .from(invoiceItems)
        .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
        .leftJoin(items, eq(items.id, invoiceItems.itemId))
        .where(and(...conditions))
        .groupBy(invoiceItems.itemId, items.name, invoiceItems.itemName, items.unit)
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
