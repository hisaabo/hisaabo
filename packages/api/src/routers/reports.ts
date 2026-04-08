import { eq, and, sql, desc, gte, lte, isNull } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  invoices,
  invoiceItems,
  payments,
  expenses,
  parties,
  items,
  itemVariants,
  bankAccounts,
  chartOfAccounts,
  businesses,
  journalEntries,
  journalEntryLines,
} from "@hisaabo/db";
import { deriveLedger, deriveFullLedger } from "../lib/derive-ledger.js";
import {
  daybookInputSchema,
  outstandingInputSchema,
  registerInputSchema,
  taxSummaryInputSchema,
  collectionEfficiencyInputSchema,
  itemSalesInputSchema,
  stockSummaryInputSchema,
  partyStatementInputSchema,
  paymentSummaryInputSchema,
  money,
} from "@hisaabo/shared";
import { router, viewerProcedure } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";
import { generateTallyXml } from "../lib/tally-xml-export.js";

export const reportsRouter = router({
  // ── 1. Daybook ─────────────────────────────────────────────────
  daybook: viewerProcedure
    .input(daybookInputSchema)
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");

      const dayStart = new Date(`${input.fromDate}T00:00:00`);
      const dayEnd = new Date(`${input.toDate}T23:59:59.999`);

      const [dayInvoices, dayPayments, dayExpenses] = await Promise.all([
        input.typeFilter === "payments" || input.typeFilter === "expenses"
          ? []
          : ctx.db
              .select({
                id: invoices.id,
                time: invoices.invoiceDate,
                number: invoices.invoiceNumber,
                type: invoices.type,
                documentType: invoices.documentType,
                partyName: parties.name,
                totalAmount: invoices.totalAmount,
                status: invoices.status,
              })
              .from(invoices)
              .innerJoin(parties, eq(parties.id, invoices.partyId))
              .where(
                and(
                  eq(invoices.businessId, ctx.businessId),
                  gte(invoices.invoiceDate, dayStart),
                  lte(invoices.invoiceDate, dayEnd),
                  isNull(invoices.deletedAt),
                ),
              )
              .orderBy(invoices.invoiceDate),

        input.typeFilter === "invoices" || input.typeFilter === "expenses"
          ? []
          : ctx.db
              .select({
                id: payments.id,
                time: payments.paymentDate,
                number: payments.paymentNumber,
                partyName: parties.name,
                partyType: parties.type,
                amount: payments.amount,
                mode: payments.mode,
              })
              .from(payments)
              .innerJoin(parties, eq(parties.id, payments.partyId))
              .where(
                and(
                  eq(payments.businessId, ctx.businessId),
                  gte(payments.paymentDate, dayStart),
                  lte(payments.paymentDate, dayEnd),
                  isNull(payments.deletedAt),
                ),
              )
              .orderBy(payments.paymentDate),

        input.typeFilter === "invoices" || input.typeFilter === "payments"
          ? []
          : ctx.db
              .select({
                id: expenses.id,
                time: expenses.expenseDate,
                category: expenses.category,
                description: expenses.description,
                amount: expenses.amount,
                mode: expenses.mode,
              })
              .from(expenses)
              .where(
                and(
                  eq(expenses.businessId, ctx.businessId),
                  gte(expenses.expenseDate, dayStart),
                  lte(expenses.expenseDate, dayEnd),
                  isNull(expenses.deletedAt),
                ),
              )
              .orderBy(expenses.expenseDate),
      ]);

      type Entry = {
        id: string;
        time: Date;
        entryType: "invoice" | "payment" | "expense";
        number: string | null;
        partyOrCategory: string;
        debit: string;
        credit: string;
        mode: string | null;
        status: string | null;
        meta: Record<string, string | null>;
      };

      const entries: Entry[] = [
        ...(dayInvoices as typeof dayInvoices).map((inv) => ({
          id: inv.id,
          time: inv.time,
          entryType: "invoice" as const,
          number: inv.number,
          partyOrCategory: inv.partyName,
          debit: inv.type === "purchase" ? inv.totalAmount : "0",
          credit: inv.type === "sale" ? inv.totalAmount : "0",
          mode: null,
          status: inv.status,
          meta: { type: inv.type, documentType: inv.documentType },
        })),
        ...(dayPayments as typeof dayPayments).map((pmt) => ({
          id: pmt.id,
          time: pmt.time,
          entryType: "payment" as const,
          number: pmt.number ?? null,
          partyOrCategory: pmt.partyName,
          debit: pmt.partyType === "supplier" ? pmt.amount : "0",
          credit: pmt.partyType === "customer" ? pmt.amount : "0",
          mode: pmt.mode,
          status: null,
          meta: { partyType: pmt.partyType },
        })),
        ...(dayExpenses as typeof dayExpenses).map((exp) => ({
          id: exp.id,
          time: exp.time,
          entryType: "expense" as const,
          number: null,
          partyOrCategory: exp.category,
          debit: exp.amount,
          credit: "0",
          mode: exp.mode,
          status: null,
          meta: { description: exp.description ?? null },
        })),
      ].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

      const totalSalesInvoiced = money.sum(
        (dayInvoices as typeof dayInvoices)
          .filter((i) => i.type === "sale")
          .map((i) => i.totalAmount),
      );
      const totalPurchaseInvoiced = money.sum(
        (dayInvoices as typeof dayInvoices)
          .filter((i) => i.type === "purchase")
          .map((i) => i.totalAmount),
      );
      const totalPaymentsReceived = money.sum(
        (dayPayments as typeof dayPayments)
          .filter((p) => p.partyType === "customer")
          .map((p) => p.amount),
      );
      const totalPaymentsMade = money.sum(
        (dayPayments as typeof dayPayments)
          .filter((p) => p.partyType === "supplier")
          .map((p) => p.amount),
      );
      const totalExpenses = money.sum(
        (dayExpenses as typeof dayExpenses).map((e) => e.amount),
      );

      return {
        entries,
        summary: {
          totalSalesInvoiced,
          totalPurchaseInvoiced,
          totalPaymentsReceived,
          totalPaymentsMade,
          totalExpenses,
          netCashMovement: money.sub(
            money.sub(totalPaymentsReceived, totalPaymentsMade),
            totalExpenses,
          ),
        },
      };
    }),

  // ── 2. Outstanding Report ──────────────────────────────────────
  outstanding: viewerProcedure
    .input(outstandingInputSchema)
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");

      const asOf = input.asOfDate ? new Date(input.asOfDate) : new Date();

      async function fetchOutstanding(invoiceType: "sale" | "purchase") {
        return ctx.db
          .select({
            partyId: parties.id,
            partyName: parties.name,
            partyPhone: parties.phone,
            invoiceId: invoices.id,
            invoiceNumber: invoices.invoiceNumber,
            invoiceDate: invoices.invoiceDate,
            dueDate: invoices.dueDate,
            totalAmount: invoices.totalAmount,
            amountPaid: invoices.amountPaid,
            outstanding: sql<string>`(${invoices.totalAmount}::numeric - ${invoices.amountPaid}::numeric)::text`,
            daysOverdue: sql<string>`GREATEST(0, EXTRACT(DAY FROM ${asOf.toISOString()}::timestamptz - COALESCE(${invoices.dueDate}, ${invoices.invoiceDate})))::text`,
          })
          .from(invoices)
          .innerJoin(parties, eq(parties.id, invoices.partyId))
          .where(
            and(
              eq(invoices.businessId, ctx.businessId),
              eq(invoices.type, invoiceType),
              eq(invoices.documentType, "invoice"),
              sql`${invoices.status} NOT IN ('paid', 'cancelled', 'draft')`,
              sql`${invoices.totalAmount}::numeric - ${invoices.amountPaid}::numeric > 0`,
              isNull(invoices.deletedAt),
            ),
          )
          .orderBy(parties.name, sql`COALESCE(${invoices.dueDate}, ${invoices.invoiceDate}) ASC`);
      }

      function buildAgingBuckets(rows: Awaited<ReturnType<typeof fetchOutstanding>>) {
        const partyMap = new Map<
          string,
          {
            partyName: string;
            partyPhone: string | null;
            current: number;
            days31_60: number;
            days61_90: number;
            days90Plus: number;
            total: number;
            invoices: typeof rows;
          }
        >();

        for (const row of rows) {
          const days = parseFloat(row.daysOverdue);
          const outstanding = parseFloat(row.outstanding);
          const existing = partyMap.get(row.partyId) ?? {
            partyName: row.partyName,
            partyPhone: row.partyPhone,
            current: 0,
            days31_60: 0,
            days61_90: 0,
            days90Plus: 0,
            total: 0,
            invoices: [],
          };

          if (days <= 30) existing.current += outstanding;
          else if (days <= 60) existing.days31_60 += outstanding;
          else if (days <= 90) existing.days61_90 += outstanding;
          else existing.days90Plus += outstanding;
          existing.total += outstanding;
          existing.invoices.push(row);

          partyMap.set(row.partyId, existing);
        }

        const parties = [...partyMap.entries()]
          .map(([partyId, data]) => ({
            partyId,
            partyName: data.partyName,
            partyPhone: data.partyPhone,
            current: data.current.toFixed(2),
            days31_60: data.days31_60.toFixed(2),
            days61_90: data.days61_90.toFixed(2),
            days90Plus: data.days90Plus.toFixed(2),
            total: data.total.toFixed(2),
            invoices: data.invoices,
          }))
          .sort((a, b) => parseFloat(b.total) - parseFloat(a.total));

        const summary = parties.reduce(
          (acc, r) => ({
            current: (parseFloat(acc.current) + parseFloat(r.current)).toFixed(2),
            days31_60: (parseFloat(acc.days31_60) + parseFloat(r.days31_60)).toFixed(2),
            days61_90: (parseFloat(acc.days61_90) + parseFloat(r.days61_90)).toFixed(2),
            days90Plus: (parseFloat(acc.days90Plus) + parseFloat(r.days90Plus)).toFixed(2),
            total: (parseFloat(acc.total) + parseFloat(r.total)).toFixed(2),
          }),
          { current: "0", days31_60: "0", days61_90: "0", days90Plus: "0", total: "0" },
        );

        return { parties, summary };
      }

      if (input.type === "receivable") {
        const rows = await fetchOutstanding("sale");
        return { receivables: buildAgingBuckets(rows), payables: null };
      }

      if (input.type === "payable") {
        const rows = await fetchOutstanding("purchase");
        return { receivables: null, payables: buildAgingBuckets(rows) };
      }

      const [receivableRows, payableRows] = await Promise.all([
        fetchOutstanding("sale"),
        fetchOutstanding("purchase"),
      ]);

      return {
        receivables: buildAgingBuckets(receivableRows),
        payables: buildAgingBuckets(payableRows),
      };
    }),

  // ── 3. Sales Register ──────────────────────────────────────────
  salesRegister: viewerProcedure
    .input(registerInputSchema)
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");

      const conditions = [
        eq(invoices.businessId, ctx.businessId),
        eq(invoices.type, "sale"),
        sql`${invoices.documentType} IN ('invoice', 'credit_note', 'debit_note')`,
        sql`${invoices.status} != 'cancelled'`,
        isNull(invoices.deletedAt),
        gte(invoices.invoiceDate, new Date(input.fromDate)),
        lte(invoices.invoiceDate, new Date(input.toDate)),
      ];

      if (input.partyId) conditions.push(eq(invoices.partyId, input.partyId));

      const [rows, taxRows] = await Promise.all([
        ctx.db
          .select({
            id: invoices.id,
            invoiceDate: invoices.invoiceDate,
            invoiceNumber: invoices.invoiceNumber,
            documentType: invoices.documentType,
            customerName: parties.name,
            customerGstin: parties.gstin,
            customerState: parties.state,
            subtotal: invoices.subtotal,
            discountAmount: invoices.discountAmount,
            taxAmount: invoices.taxAmount,
            totalAmount: invoices.totalAmount,
            amountPaid: invoices.amountPaid,
            status: invoices.status,
          })
          .from(invoices)
          .innerJoin(parties, eq(parties.id, invoices.partyId))
          .where(and(...conditions))
          .orderBy(invoices.invoiceDate),

        ctx.db
          .select({
            invoiceId: invoiceItems.invoiceId,
            taxPercent: invoiceItems.taxPercent,
            taxableAmount: sql<string>`SUM(${invoiceItems.totalAmount}::numeric - ${invoiceItems.taxAmount}::numeric)::text`,
            taxAmount: sql<string>`SUM(${invoiceItems.taxAmount}::numeric)::text`,
          })
          .from(invoiceItems)
          .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
          .where(
            and(
              eq(invoices.businessId, ctx.businessId),
              eq(invoices.type, "sale"),
              gte(invoices.invoiceDate, new Date(input.fromDate)),
              lte(invoices.invoiceDate, new Date(input.toDate)),
              isNull(invoices.deletedAt),
            ),
          )
          .groupBy(invoiceItems.invoiceId, invoiceItems.taxPercent),
      ]);

      const taxByInvoice = new Map<string, Array<{ taxPercent: string; taxableAmount: string; taxAmount: string }>>();
      for (const row of taxRows) {
        const existing = taxByInvoice.get(row.invoiceId) ?? [];
        existing.push({ taxPercent: row.taxPercent, taxableAmount: row.taxableAmount, taxAmount: row.taxAmount });
        taxByInvoice.set(row.invoiceId, existing);
      }

      const totalSubtotal = money.sum(rows.map((r) => r.subtotal));
      const totalTax = money.sum(rows.map((r) => r.taxAmount));
      const totalAmount = money.sum(rows.map((r) => r.totalAmount));

      return {
        rows: rows.map((r) => ({
          ...r,
          taxBreakdown: taxByInvoice.get(r.id) ?? [],
        })),
        summary: { totalSubtotal, totalTax, totalAmount, count: rows.length },
      };
    }),

  // ── 4. Purchase Register ───────────────────────────────────────
  purchaseRegister: viewerProcedure
    .input(registerInputSchema)
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");

      const conditions = [
        eq(invoices.businessId, ctx.businessId),
        eq(invoices.type, "purchase"),
        eq(invoices.documentType, "invoice"),
        sql`${invoices.status} != 'cancelled'`,
        isNull(invoices.deletedAt),
        gte(invoices.invoiceDate, new Date(input.fromDate)),
        lte(invoices.invoiceDate, new Date(input.toDate)),
      ];

      if (input.partyId) conditions.push(eq(invoices.partyId, input.partyId));

      const [rows, taxRows] = await Promise.all([
        ctx.db
          .select({
            id: invoices.id,
            invoiceDate: invoices.invoiceDate,
            invoiceNumber: invoices.invoiceNumber,
            supplierName: parties.name,
            supplierGstin: parties.gstin,
            subtotal: invoices.subtotal,
            discountAmount: invoices.discountAmount,
            taxAmount: invoices.taxAmount,
            totalAmount: invoices.totalAmount,
            amountPaid: invoices.amountPaid,
            status: invoices.status,
          })
          .from(invoices)
          .innerJoin(parties, eq(parties.id, invoices.partyId))
          .where(and(...conditions))
          .orderBy(invoices.invoiceDate),

        ctx.db
          .select({
            invoiceId: invoiceItems.invoiceId,
            taxPercent: invoiceItems.taxPercent,
            taxableAmount: sql<string>`SUM(${invoiceItems.totalAmount}::numeric - ${invoiceItems.taxAmount}::numeric)::text`,
            taxAmount: sql<string>`SUM(${invoiceItems.taxAmount}::numeric)::text`,
          })
          .from(invoiceItems)
          .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
          .where(
            and(
              eq(invoices.businessId, ctx.businessId),
              eq(invoices.type, "purchase"),
              gte(invoices.invoiceDate, new Date(input.fromDate)),
              lte(invoices.invoiceDate, new Date(input.toDate)),
              isNull(invoices.deletedAt),
            ),
          )
          .groupBy(invoiceItems.invoiceId, invoiceItems.taxPercent),
      ]);

      const taxByInvoice = new Map<string, Array<{ taxPercent: string; taxableAmount: string; taxAmount: string }>>();
      for (const row of taxRows) {
        const existing = taxByInvoice.get(row.invoiceId) ?? [];
        existing.push({ taxPercent: row.taxPercent, taxableAmount: row.taxableAmount, taxAmount: row.taxAmount });
        taxByInvoice.set(row.invoiceId, existing);
      }

      const totalSubtotal = money.sum(rows.map((r) => r.subtotal));
      const totalTax = money.sum(rows.map((r) => r.taxAmount));
      const totalAmount = money.sum(rows.map((r) => r.totalAmount));

      return {
        rows: rows.map((r) => ({
          ...r,
          taxBreakdown: taxByInvoice.get(r.id) ?? [],
        })),
        summary: { totalSubtotal, totalTax, totalAmount, count: rows.length },
      };
    }),

  // ── 5. Tax Summary ─────────────────────────────────────────────
  taxSummary: viewerProcedure
    .input(taxSummaryInputSchema)
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");

      const typeCondition =
        input.type === "sales"
          ? sql`${invoices.type} = 'sale'`
          : input.type === "purchases"
            ? sql`${invoices.type} = 'purchase'`
            : sql`${invoices.type} IN ('sale', 'purchase')`;

      const rows = await ctx.db
        .select({
          invoiceType: invoices.type,
          taxPercent: invoiceItems.taxPercent,
          invoiceCount: sql<number>`COUNT(DISTINCT ${invoices.id})::int`,
          taxableAmount: sql<string>`SUM(${invoiceItems.totalAmount}::numeric - ${invoiceItems.taxAmount}::numeric)::text`,
          taxAmount: sql<string>`SUM(${invoiceItems.taxAmount}::numeric)::text`,
          grossAmount: sql<string>`SUM(${invoiceItems.totalAmount}::numeric)::text`,
        })
        .from(invoiceItems)
        .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
        .where(
          and(
            eq(invoices.businessId, ctx.businessId),
            eq(invoices.documentType, "invoice"),
            sql`${invoices.status} NOT IN ('draft', 'cancelled')`,
            isNull(invoices.deletedAt),
            gte(invoices.invoiceDate, new Date(input.fromDate)),
            lte(invoices.invoiceDate, new Date(input.toDate)),
            typeCondition,
          ),
        )
        .groupBy(invoices.type, invoiceItems.taxPercent)
        .orderBy(invoices.type, invoiceItems.taxPercent);

      const salesRows = rows.filter((r) => r.invoiceType === "sale");
      const purchaseRows = rows.filter((r) => r.invoiceType === "purchase");

      const totalTaxCollected = money.sum(salesRows.map((r) => r.taxAmount));
      const totalTaxPaid = money.sum(purchaseRows.map((r) => r.taxAmount));
      const netTaxLiability = money.sub(totalTaxCollected, totalTaxPaid);

      return {
        salesBreakdown: salesRows,
        purchaseBreakdown: purchaseRows,
        summary: {
          totalTaxCollected,
          totalTaxPaid,
          netTaxLiability,
        },
      };
    }),

  // ── 6. Cash Flow Forecast ──────────────────────────────────────
  cashFlowForecast: viewerProcedure
    .input(z.object({}).optional())
    .query(async ({ ctx }) => {
      requireCan(ctx.ability, "read", "Report");

      const [openReceivables, bankBalance, avgDailyExpense] = await Promise.all([
        ctx.db
          .select({
            bucket: sql<string>`
              CASE
                WHEN ${invoices.dueDate} IS NULL THEN 'no_due_date'
                WHEN ${invoices.dueDate} <= NOW() THEN 'overdue'
                WHEN ${invoices.dueDate} <= NOW() + INTERVAL '7 days' THEN '7d'
                WHEN ${invoices.dueDate} <= NOW() + INTERVAL '14 days' THEN '14d'
                WHEN ${invoices.dueDate} <= NOW() + INTERVAL '30 days' THEN '30d'
                ELSE 'beyond_30d'
              END`,
            totalDue: sql<string>`SUM(${invoices.totalAmount}::numeric - ${invoices.amountPaid}::numeric)::text`,
            invoiceCount: sql<number>`COUNT(*)::int`,
          })
          .from(invoices)
          .where(
            and(
              eq(invoices.businessId, ctx.businessId),
              eq(invoices.type, "sale"),
              eq(invoices.documentType, "invoice"),
              sql`${invoices.status} NOT IN ('paid', 'cancelled', 'draft')`,
              isNull(invoices.deletedAt),
            ),
          )
          .groupBy(sql`1`),

        ctx.db
          .select({
            total: sql<string>`COALESCE(SUM(${bankAccounts.currentBalance}::numeric), 0)::text`,
          })
          .from(bankAccounts)
          .where(eq(bankAccounts.businessId, ctx.businessId)),

        ctx.db
          .select({
            avgDaily: sql<string>`(COALESCE(SUM(${expenses.amount}::numeric), 0) / 30)::text`,
          })
          .from(expenses)
          .where(
            and(
              eq(expenses.businessId, ctx.businessId),
              gte(expenses.expenseDate, sql`NOW() - INTERVAL '30 days'`),
            ),
          ),
      ]);

      const historicalRatesResult = await ctx.db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE p.payment_date <= i.due_date + INTERVAL '7 days')::numeric
            / NULLIF(COUNT(*), 0) AS rate_7d,
          COUNT(*) FILTER (WHERE p.payment_date <= i.due_date + INTERVAL '14 days')::numeric
            / NULLIF(COUNT(*), 0) AS rate_14d,
          COUNT(*) FILTER (WHERE p.payment_date <= i.due_date + INTERVAL '30 days')::numeric
            / NULLIF(COUNT(*), 0) AS rate_30d,
          COUNT(*) AS paid_invoice_count
        FROM invoices i
        JOIN payments p ON p.invoice_id = i.id
        WHERE i.business_id = ${ctx.businessId}
          AND i.type = 'sale'
          AND i.status = 'paid'
          AND i.due_date IS NOT NULL
          AND i.invoice_date >= NOW() - INTERVAL '90 days'
      `);

      const rates = (historicalRatesResult as unknown as Array<{
        rate_7d: string | null;
        rate_14d: string | null;
        rate_30d: string | null;
        paid_invoice_count: string;
      }>)[0];

      const rate7d = parseFloat(rates?.rate_7d ?? "0") || 0;
      const rate14d = parseFloat(rates?.rate_14d ?? "0") || 0;
      const rate30d = parseFloat(rates?.rate_30d ?? "0") || 0;
      const paidInvoiceCount = parseInt(rates?.paid_invoice_count ?? "0", 10);
      const lowConfidence = paidInvoiceCount < 10;

      const bucketMap = new Map(openReceivables.map((r) => [r.bucket, r]));
      const currentBalance = parseFloat(bankBalance[0]?.total ?? "0");
      const dailyExpenses = parseFloat(avgDailyExpense[0]?.avgDaily ?? "0");

      function bucketDue(bucket: string): number {
        return parseFloat(bucketMap.get(bucket)?.totalDue ?? "0");
      }

      const overdueAmount = bucketDue("overdue");
      const due7d = bucketDue("7d");
      const due14d = bucketDue("14d");
      const due30d = bucketDue("30d");

      const forecast = [
        { label: "today", days: 0 },
        { label: "+7d", days: 7 },
        { label: "+14d", days: 14 },
        { label: "+30d", days: 30 },
      ].map(({ label, days }) => {
        const expenseBurn = dailyExpenses * days;
        const optimistic = currentBalance + overdueAmount + due7d + due14d + due30d - expenseBurn;
        const collectable =
          overdueAmount * 0.5 +
          due7d * rate7d +
          due14d * rate14d +
          due30d * rate30d;
        const expected = currentBalance + collectable - expenseBurn;
        const conservative = currentBalance + collectable * 0.5 - expenseBurn;

        return {
          label,
          days,
          optimistic: optimistic.toFixed(2),
          expected: expected.toFixed(2),
          conservative: conservative.toFixed(2),
        };
      });

      return {
        forecast,
        currentBankBalance: bankBalance[0]?.total ?? "0",
        avgDailyExpenses: avgDailyExpense[0]?.avgDaily ?? "0",
        openReceivables: openReceivables.map((r) => ({
          bucket: r.bucket,
          totalDue: r.totalDue,
          invoiceCount: r.invoiceCount,
        })),
        collectionRates: {
          rate7d: rate7d.toFixed(3),
          rate14d: rate14d.toFixed(3),
          rate30d: rate30d.toFixed(3),
          paidInvoiceCount,
          lowConfidence,
        },
      };
    }),

  // ── 7. Collection Efficiency + DSO ────────────────────────────
  collectionEfficiency: viewerProcedure
    .input(collectionEfficiencyInputSchema)
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");

      const periodStart = new Date(input.fromDate);
      const periodEnd = new Date(input.toDate);
      const daysInPeriod = Math.max(
        1,
        Math.round((periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)),
      );

      const [efficiencyResult, dsoResult] = await Promise.all([
        ctx.db.execute(sql`
          WITH paid_invoices AS (
            SELECT
              i.id,
              i.due_date,
              i.total_amount::numeric AS total,
              i.amount_paid::numeric AS paid,
              MAX(p.payment_date) AS last_payment_date
            FROM invoices i
            LEFT JOIN payments p ON p.invoice_id = i.id
              AND p.business_id = ${ctx.businessId}
            WHERE i.business_id = ${ctx.businessId}
              AND i.type = 'sale'
              AND i.document_type = 'invoice'
              AND i.status = 'paid'
              AND i.due_date IS NOT NULL
              AND i.invoice_date >= ${periodStart.toISOString()}::timestamptz
              AND i.invoice_date <= ${periodEnd.toISOString()}::timestamptz
              AND i.deleted_at IS NULL
            GROUP BY i.id, i.due_date, i.total_amount, i.amount_paid
          )
          SELECT
            COUNT(*) AS total_invoices,
            COUNT(*) FILTER (WHERE last_payment_date <= due_date) AS paid_on_time,
            COUNT(*) FILTER (WHERE last_payment_date > due_date) AS paid_late,
            ROUND(
              COUNT(*) FILTER (WHERE last_payment_date <= due_date)::numeric
                / NULLIF(COUNT(*), 0) * 100,
              1
            ) AS on_time_rate
          FROM paid_invoices
        `),

        ctx.db.execute(sql`
          WITH period_sales AS (
            SELECT
              SUM(total_amount::numeric) AS total_sales,
              AVG(total_amount::numeric - amount_paid::numeric) AS avg_receivable
            FROM invoices
            WHERE business_id = ${ctx.businessId}
              AND type = 'sale'
              AND document_type = 'invoice'
              AND status NOT IN ('draft', 'cancelled')
              AND invoice_date >= ${periodStart.toISOString()}::timestamptz
              AND invoice_date <= ${periodEnd.toISOString()}::timestamptz
              AND deleted_at IS NULL
          )
          SELECT
            ROUND(
              avg_receivable / NULLIF(total_sales, 0) * ${daysInPeriod}::numeric,
              1
            ) AS dso_days,
            total_sales::text AS total_sales,
            COALESCE(avg_receivable, 0)::text AS avg_receivable
          FROM period_sales
        `),
      ]);

      const eff = (efficiencyResult as unknown as Array<{
        total_invoices: string;
        paid_on_time: string;
        paid_late: string;
        on_time_rate: string | null;
      }>)[0];

      const dso = (dsoResult as unknown as Array<{
        dso_days: string | null;
        total_sales: string;
        avg_receivable: string;
      }>)[0];

      return {
        collectionEfficiency: {
          totalInvoices: parseInt(eff?.total_invoices ?? "0", 10),
          paidOnTime: parseInt(eff?.paid_on_time ?? "0", 10),
          paidLate: parseInt(eff?.paid_late ?? "0", 10),
          onTimeRate: eff?.on_time_rate ?? "0",
        },
        dso: {
          dsoDays: dso?.dso_days ?? null,
          totalSales: dso?.total_sales ?? "0",
          avgReceivable: dso?.avg_receivable ?? "0",
          daysInPeriod,
          isHealthy: dso?.dso_days ? parseFloat(dso.dso_days) <= 30 : null,
          isWarning: dso?.dso_days ? parseFloat(dso.dso_days) > 45 : null,
        },
      };
    }),

  // ── 8. Item-wise Sales Report ─────────────────────────────────
  itemSales: viewerProcedure
    .input(itemSalesInputSchema)
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");

      const fromDate = new Date(input.fromDate);
      const toDate = new Date(input.toDate);

      const conditions = [
        eq(invoices.businessId, ctx.businessId),
        eq(invoices.type, "sale"),
        eq(invoices.documentType, "invoice"),
        sql`${invoices.status} NOT IN ('draft', 'cancelled')`,
        isNull(invoices.deletedAt),
        gte(invoices.invoiceDate, fromDate),
        lte(invoices.invoiceDate, toDate),
      ];

      if (input.category) conditions.push(eq(items.category, input.category));

      const sortExpr =
        input.sortBy === "quantity"
          ? sql`SUM(${invoiceItems.quantity}::numeric * COALESCE(${invoiceItems.conversionFactor}::numeric, 1)) DESC`
          : input.sortBy === "invoices"
            ? sql`COUNT(DISTINCT ${invoices.id}) DESC`
            : input.sortBy === "margin"
              ? sql`(SUM(${invoiceItems.totalAmount}::numeric) - SUM(${invoiceItems.quantity}::numeric * COALESCE(${invoiceItems.conversionFactor}::numeric, 1) * COALESCE(${items.purchasePrice}::numeric, 0))) / NULLIF(SUM(${invoiceItems.totalAmount}::numeric), 0) DESC NULLS LAST`
              : sql`SUM(${invoiceItems.totalAmount}::numeric) DESC`;

      async function queryPeriod(periodConditions: typeof conditions) {
        return ctx.db
          .select({
            itemId: invoiceItems.itemId,
            itemName: sql<string>`COALESCE(${items.name}, ${invoiceItems.description})`,
            category: items.category,
            unit: items.unit,
            soldQty: sql<string>`SUM(${invoiceItems.quantity}::numeric * COALESCE(${invoiceItems.conversionFactor}::numeric, 1))::text`,
            totalRevenue: sql<string>`SUM(${invoiceItems.totalAmount}::numeric)::text`,
            avgUnitPrice: sql<string>`ROUND(SUM(${invoiceItems.totalAmount}::numeric) / NULLIF(SUM(${invoiceItems.quantity}::numeric * COALESCE(${invoiceItems.conversionFactor}::numeric, 1)), 0), 2)::text`,
            invoiceCount: sql<number>`COUNT(DISTINCT ${invoices.id})::int`,
            uniqueCustomers: sql<number>`COUNT(DISTINCT ${invoices.partyId})::int`,
            estimatedCost: sql<string>`SUM(${invoiceItems.quantity}::numeric * COALESCE(${invoiceItems.conversionFactor}::numeric, 1) * COALESCE(${items.purchasePrice}::numeric, 0))::text`,
            grossMarginPct: sql<string>`
              ROUND(
                (SUM(${invoiceItems.totalAmount}::numeric) - SUM(${invoiceItems.quantity}::numeric * COALESCE(${invoiceItems.conversionFactor}::numeric, 1) * COALESCE(${items.purchasePrice}::numeric, 0)))
                / NULLIF(SUM(${invoiceItems.totalAmount}::numeric), 0) * 100,
                1
              )::text`,
          })
          .from(invoiceItems)
          .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
          .leftJoin(items, eq(items.id, invoiceItems.itemId))
          .where(and(...periodConditions))
          .groupBy(invoiceItems.itemId, items.name, items.category, items.unit, invoiceItems.description, items.purchasePrice)
          .orderBy(sortExpr);
      }

      const primaryRows = await queryPeriod(conditions);

      let previousRows: typeof primaryRows = [];
      if (input.compareToPrevious) {
        const periodMs = toDate.getTime() - fromDate.getTime();
        const prevToDate = new Date(fromDate.getTime() - 1);
        const prevFromDate = new Date(prevToDate.getTime() - periodMs);

        const prevConditions = [
          eq(invoices.businessId, ctx.businessId),
          eq(invoices.type, "sale"),
          eq(invoices.documentType, "invoice"),
          sql`${invoices.status} NOT IN ('draft', 'cancelled')`,
          isNull(invoices.deletedAt),
          gte(invoices.invoiceDate, prevFromDate),
          lte(invoices.invoiceDate, prevToDate),
          ...(input.category ? [eq(items.category, input.category)] : []),
        ];

        previousRows = await queryPeriod(prevConditions);
      }

      const prevMap = new Map(previousRows.map((r) => [r.itemId, r]));

      const rows = primaryRows.map((r) => {
        const previous = prevMap.get(r.itemId) ?? null;
        const revenueChange = previous
          ? (() => {
              const prev = parseFloat(previous.totalRevenue);
              const curr = parseFloat(r.totalRevenue);
              if (prev === 0) return null;
              return (((curr - prev) / prev) * 100).toFixed(1);
            })()
          : null;
        return { ...r, previous, revenueChange };
      });

      const totalRevenue = money.sum(primaryRows.map((r) => r.totalRevenue));

      return { rows, totalRevenue, count: rows.length };
    }),

  // ── 9. Stock Summary ──────────────────────────────────────────
  stockSummary: viewerProcedure
    .input(stockSummaryInputSchema)
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");

      const simpleConditions = [
        eq(items.businessId, ctx.businessId),
        eq(items.itemType, "product"),
        sql`${items.itemMode} != 'variants'`,
      ];
      if (!input.showZeroStock) simpleConditions.push(sql`${items.stockQuantity}::numeric != 0`);
      if (input.category) simpleConditions.push(eq(items.category, input.category));

      const variantConditions = [
        eq(items.businessId, ctx.businessId),
        eq(items.itemType, "product"),
        eq(items.itemMode, "variants"),
      ];
      if (input.category) variantConditions.push(eq(items.category, input.category));

      const [simpleRows, variantRows] = await Promise.all([
        ctx.db
          .select({
            itemId: items.id,
            itemName: items.name,
            category: items.category,
            hsn: items.hsn,
            unit: items.unit,
            currentStock: items.stockQuantity,
            purchasePrice: items.purchasePrice,
            salePrice: items.salePrice,
            stockValue: sql<string>`ROUND(GREATEST(${items.stockQuantity}::numeric, 0) * COALESCE(${items.purchasePrice}::numeric, 0), 2)::text`,
            stockValueAtSale: sql<string>`ROUND(GREATEST(${items.stockQuantity}::numeric, 0) * COALESCE(${items.salePrice}::numeric, 0), 2)::text`,
            lowStockAlert: items.lowStockAlert,
            isLowStock: sql<boolean>`${items.lowStockAlert} IS NOT NULL AND ${items.stockQuantity}::numeric <= ${items.lowStockAlert}::numeric`,
          })
          .from(items)
          .where(and(...simpleConditions))
          .orderBy(items.name),

        ctx.db
          .select({
            itemId: items.id,
            itemName: items.name,
            category: items.category,
            hsn: items.hsn,
            unit: items.unit,
            totalStock: sql<string>`SUM(${itemVariants.stockQuantity}::numeric)::text`,
            totalValue: sql<string>`ROUND(SUM(GREATEST(${itemVariants.stockQuantity}::numeric, 0) * COALESCE(${itemVariants.purchasePrice}::numeric, 0)), 2)::text`,
            totalValueAtSale: sql<string>`ROUND(SUM(GREATEST(${itemVariants.stockQuantity}::numeric, 0) * COALESCE(${itemVariants.salePrice}::numeric, 0)), 2)::text`,
            variantDetails: sql<string>`JSON_AGG(JSON_BUILD_OBJECT(
              'sku', ${itemVariants.sku},
              'attributes', ${itemVariants.attributeValues},
              'stock', ${itemVariants.stockQuantity},
              'purchasePrice', ${itemVariants.purchasePrice},
              'salePrice', ${itemVariants.salePrice},
              'lowStockAlert', ${itemVariants.lowStockAlert},
              'isLowStock', (${itemVariants.lowStockAlert} IS NOT NULL AND ${itemVariants.stockQuantity}::numeric <= ${itemVariants.lowStockAlert}::numeric),
              'value', ROUND(GREATEST(${itemVariants.stockQuantity}::numeric, 0) * COALESCE(${itemVariants.purchasePrice}::numeric, 0), 2)
            ) ORDER BY ${itemVariants.createdAt})`,
          })
          .from(items)
          .innerJoin(itemVariants, eq(itemVariants.itemId, items.id))
          .where(and(...variantConditions))
          .groupBy(items.id, items.name, items.category, items.hsn, items.unit)
          .having(
            input.showZeroStock
              ? sql`TRUE`
              : sql`SUM(${itemVariants.stockQuantity}::numeric) != 0`,
          )
          .orderBy(items.name),
      ]);

      const totalCostValue = (
        parseFloat(money.sum(simpleRows.map((r) => r.stockValue))) +
        parseFloat(money.sum(variantRows.map((r) => r.totalValue)))
      ).toFixed(2);

      const totalSaleValue = (
        parseFloat(money.sum(simpleRows.map((r) => r.stockValueAtSale))) +
        parseFloat(money.sum(variantRows.map((r) => r.totalValueAtSale)))
      ).toFixed(2);

      const lowStockCount =
        simpleRows.filter((r) => r.isLowStock).length +
        variantRows.filter((r) => {
          try {
            const details = JSON.parse(r.variantDetails) as Array<{ isLowStock: boolean }>;
            return details.some((v) => v.isLowStock);
          } catch {
            return false;
          }
        }).length;

      return {
        simpleItems: simpleRows,
        variantItems: variantRows.map((r) => ({
          ...r,
          variantDetails: (() => {
            try {
              return JSON.parse(r.variantDetails);
            } catch {
              return [];
            }
          })(),
        })),
        summary: {
          totalCostValue,
          totalSaleValue,
          totalSkuCount: simpleRows.length + variantRows.length,
          lowStockCount,
        },
      };
    }),

  // ── 10. Party Statement ────────────────────────────────────────
  partyStatement: viewerProcedure
    .input(partyStatementInputSchema)
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");

      const [party] = await ctx.db
        .select()
        .from(parties)
        .where(
          and(
            eq(parties.id, input.partyId),
            eq(parties.businessId, ctx.businessId),
          ),
        )
        .limit(1);

      if (!party) return null;

      const invoiceConditions = [
        eq(invoices.partyId, input.partyId),
        eq(invoices.businessId, ctx.businessId),
        eq(invoices.documentType, "invoice"),
        isNull(invoices.deletedAt),
      ];
      const paymentConditions = [
        eq(payments.partyId, input.partyId),
        eq(payments.businessId, ctx.businessId),
        isNull(payments.deletedAt),
      ];

      if (input.fromDate) {
        invoiceConditions.push(gte(invoices.invoiceDate, new Date(input.fromDate)));
        paymentConditions.push(gte(payments.paymentDate, new Date(input.fromDate)));
      }
      if (input.toDate) {
        invoiceConditions.push(lte(invoices.invoiceDate, new Date(input.toDate)));
        paymentConditions.push(lte(payments.paymentDate, new Date(input.toDate)));
      }

      const [partyInvoices, partyPayments] = await Promise.all([
        ctx.db
          .select({
            id: invoices.id,
            invoiceNumber: invoices.invoiceNumber,
            date: invoices.invoiceDate,
            type: invoices.type,
            totalAmount: invoices.totalAmount,
            status: invoices.status,
          })
          .from(invoices)
          .where(and(...invoiceConditions))
          .orderBy(invoices.invoiceDate),

        ctx.db
          .select({
            id: payments.id,
            paymentNumber: payments.paymentNumber,
            date: payments.paymentDate,
            amount: payments.amount,
            mode: payments.mode,
          })
          .from(payments)
          .where(and(...paymentConditions))
          .orderBy(payments.paymentDate),
      ]);

      const entries = [
        ...partyInvoices.map((inv) => ({
          date: inv.date,
          type: "invoice" as const,
          number: inv.invoiceNumber,
          description: inv.type === "sale" ? "Sale Invoice" : "Purchase Invoice",
          debit: inv.type === "sale" ? inv.totalAmount : "0",
          credit: inv.type === "sale" ? "0" : inv.totalAmount,
          status: inv.status as string | null,
          documentId: inv.id,
        })),
        ...partyPayments.map((pmt) => ({
          date: pmt.date,
          type: "payment" as const,
          number: pmt.paymentNumber ?? "",
          description: `Payment (${pmt.mode})`,
          debit: party.type === "supplier" ? pmt.amount : "0",
          credit: party.type === "supplier" ? "0" : pmt.amount,
          status: null as string | null,
          documentId: pmt.id,
        })),
      ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      let runningBalance = party.openingBalance;
      const entriesWithBalance = entries.map((e) => {
        runningBalance = money.add(money.sub(runningBalance, e.credit), e.debit);
        return { ...e, runningBalance };
      });

      const totalDebit = money.sum(entries.map((e) => e.debit));
      const totalCredit = money.sum(entries.map((e) => e.credit));
      const closingBalance = money.add(money.sub(party.openingBalance, totalCredit), totalDebit);

      return {
        party: {
          id: party.id,
          name: party.name,
          type: party.type,
          openingBalance: party.openingBalance,
          gstin: party.gstin,
          phone: party.phone,
          email: party.email,
          city: party.city,
          state: party.state,
          billingAddress: party.billingAddress,
        },
        entries: entriesWithBalance,
        summary: {
          totalDebit,
          totalCredit,
          closingBalance,
          isDebit: parseFloat(closingBalance) >= 0,
        },
      };
    }),

  // ── 11. Payment Summary ────────────────────────────────────────
  paymentSummary: viewerProcedure
    .input(paymentSummaryInputSchema)
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");

      const fromDate = new Date(input.fromDate);
      const toDate = new Date(input.toDate);

      const paymentConditions = [
        eq(payments.businessId, ctx.businessId),
        isNull(payments.deletedAt),
        gte(payments.paymentDate, fromDate),
        lte(payments.paymentDate, toDate),
      ];
      if (input.bankAccountId) paymentConditions.push(eq(payments.bankAccountId, input.bankAccountId));

      const receivedCondition =
        input.type === "received"
          ? [eq(parties.type, "customer")]
          : input.type === "made"
            ? [eq(parties.type, "supplier")]
            : [];

      const [paymentModeRows, expenseRows, recentPayments] = await Promise.all([
        ctx.db
          .select({
            mode: payments.mode,
            bankAccountId: payments.bankAccountId,
            bankAccountName: bankAccounts.accountName,
            count: sql<number>`COUNT(*)::int`,
            totalAmount: sql<string>`SUM(${payments.amount}::numeric)::text`,
            customerPayments: sql<string>`SUM(CASE WHEN ${parties.type} = 'customer' THEN ${payments.amount}::numeric ELSE 0 END)::text`,
            supplierPayments: sql<string>`SUM(CASE WHEN ${parties.type} = 'supplier' THEN ${payments.amount}::numeric ELSE 0 END)::text`,
          })
          .from(payments)
          .innerJoin(parties, eq(parties.id, payments.partyId))
          .leftJoin(bankAccounts, eq(bankAccounts.id, payments.bankAccountId))
          .where(and(...paymentConditions, ...receivedCondition))
          .groupBy(payments.mode, payments.bankAccountId, bankAccounts.accountName)
          .orderBy(sql`SUM(${payments.amount}::numeric) DESC`),

        input.type !== "received"
          ? ctx.db
              .select({
                mode: expenses.mode,
                count: sql<number>`COUNT(*)::int`,
                totalAmount: sql<string>`SUM(${expenses.amount}::numeric)::text`,
              })
              .from(expenses)
              .where(
                and(
                  eq(expenses.businessId, ctx.businessId),
                  isNull(expenses.deletedAt),
                  gte(expenses.expenseDate, fromDate),
                  lte(expenses.expenseDate, toDate),
                ),
              )
              .groupBy(expenses.mode)
          : [],

        ctx.db
          .select({
            id: payments.id,
            paymentNumber: payments.paymentNumber,
            date: payments.paymentDate,
            partyName: parties.name,
            partyType: parties.type,
            amount: payments.amount,
            mode: payments.mode,
          })
          .from(payments)
          .innerJoin(parties, eq(parties.id, payments.partyId))
          .where(and(...paymentConditions, ...receivedCondition))
          .orderBy(desc(payments.paymentDate))
          .limit(200),
      ]);

      const totalReceived = money.sum(
        paymentModeRows.map((r) => r.customerPayments),
      );
      const totalMade = money.sum(
        paymentModeRows.map((r) => r.supplierPayments),
      );
      const totalExpenses = money.sum(
        (expenseRows as typeof expenseRows).map((r) => r.totalAmount),
      );

      return {
        byMode: paymentModeRows,
        expenses: expenseRows,
        recentPayments,
        summary: {
          totalReceived,
          totalMade,
          totalExpenses,
          netCashMovement: money.sub(totalReceived, money.add(totalMade, totalExpenses)),
        },
      };
    }),

  // ── 11. Trial Balance ──────────────────────────────────────────
  trialBalance: viewerProcedure
    .input(z.object({
      asOfDate: z.string().datetime(),
      fromDate: z.string().datetime().optional(),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");

      const asOf = new Date(input.asOfDate);

      // Determine FY start: default to April 1 of the asOf year (or prev year if before April)
      const [biz] = await ctx.db
        .select({ financialYearStart: businesses.financialYearStart })
        .from(businesses)
        .where(eq(businesses.id, ctx.businessId))
        .limit(1);

      const fyStartMonth = (biz?.financialYearStart ?? 4) - 1; // 0-indexed
      const fyYear =
        asOf.getMonth() < fyStartMonth
          ? asOf.getFullYear() - 1
          : asOf.getFullYear();
      const from = input.fromDate
        ? new Date(input.fromDate)
        : new Date(fyYear, fyStartMonth, 1);

      const entries = await deriveFullLedger(ctx.db, ctx.businessId, from, asOf);

      // Aggregate debits and credits per account code
      const accountMap = new Map<
        string,
        { debit: string; credit: string; code: string; name: string }
      >();

      for (const entry of entries) {
        for (const line of entry.lines) {
          const existing = accountMap.get(line.accountCode) ?? {
            debit: "0.00",
            credit: "0.00",
            code: line.accountCode,
            name: line.accountName,
          };
          existing.debit = money.add(existing.debit, line.debit);
          existing.credit = money.add(existing.credit, line.credit);
          accountMap.set(line.accountCode, existing);
        }
      }

      // Fetch account types from CoA
      const coaRows = await ctx.db
        .select({
          code: chartOfAccounts.code,
          accountType: chartOfAccounts.accountType,
        })
        .from(chartOfAccounts)
        .where(eq(chartOfAccounts.businessId, ctx.businessId));

      const coaTypeMap = new Map(coaRows.map((r) => [r.code, r.accountType]));

      const accounts = [...accountMap.values()]
        .map((a) => ({
          accountCode: a.code,
          accountName: a.name,
          accountType: coaTypeMap.get(a.code) ?? "expense",
          debit: a.debit,
          credit: a.credit,
          balance: money.sub(a.debit, a.credit),
        }))
        .filter(
          (a) =>
            money.compare(a.debit, "0") !== 0 ||
            money.compare(a.credit, "0") !== 0,
        )
        .sort((a, b) => a.accountCode.localeCompare(b.accountCode));

      const totalDebit = money.sum(accounts.map((a) => a.debit));
      const totalCredit = money.sum(accounts.map((a) => a.credit));

      return { accounts, totalDebit, totalCredit };
    }),

  // ── 12. Balance Sheet ──────────────────────────────────────────
  balanceSheet: viewerProcedure
    .input(z.object({ asOfDate: z.string().datetime() }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");

      const asOf = new Date(input.asOfDate);

      // Derive all entries from the beginning of time up to asOf.
      // Balance sheet is cumulative — income/expense flows accumulate as net income
      // in equity (this system has no year-end closing entries).
      const allEntries = await deriveFullLedger(
        ctx.db,
        ctx.businessId,
        new Date("2000-01-01"),
        asOf,
      );

      // Fetch CoA for type information
      const coaRows = await ctx.db
        .select({
          code: chartOfAccounts.code,
          name: chartOfAccounts.name,
          accountType: chartOfAccounts.accountType,
        })
        .from(chartOfAccounts)
        .where(eq(chartOfAccounts.businessId, ctx.businessId));

      const coaTypeMap = new Map(
        coaRows.map((r) => [r.code, { name: r.name, type: r.accountType }]),
      );

      // Aggregate cumulative balances for all account types
      type AccBalance = { code: string; name: string; debit: string; credit: string };
      const allMap = new Map<string, AccBalance>();

      for (const entry of allEntries) {
        for (const line of entry.lines) {
          const existing = allMap.get(line.accountCode) ?? {
            code: line.accountCode,
            name: line.accountName,
            debit: "0.00",
            credit: "0.00",
          };
          existing.debit = money.add(existing.debit, line.debit);
          existing.credit = money.add(existing.credit, line.credit);
          allMap.set(line.accountCode, existing);
        }
      }

      // Compute net income from all-time income/expense movements.
      // Since there are no closing journal entries, all accumulated income/expense
      // contributes to net income (retained earnings equivalent).
      let totalIncomeCredits = "0.00";
      let totalIncomeDebits = "0.00";
      let totalExpenseDebits = "0.00";
      let totalExpenseCredits = "0.00";

      for (const [code, acc] of allMap) {
        const acctInfo = coaTypeMap.get(code);
        if (!acctInfo) continue;
        if (acctInfo.type === "income") {
          totalIncomeCredits = money.add(totalIncomeCredits, acc.credit);
          totalIncomeDebits = money.add(totalIncomeDebits, acc.debit);
        } else if (acctInfo.type === "expense") {
          totalExpenseDebits = money.add(totalExpenseDebits, acc.debit);
          totalExpenseCredits = money.add(totalExpenseCredits, acc.credit);
        }
      }

      const netIncome = money.sub(
        money.sub(totalIncomeCredits, totalIncomeDebits),
        money.sub(totalExpenseDebits, totalExpenseCredits),
      );

      // Build section arrays from cumulative balances (balance sheet accounts only)
      type BsItem = { accountCode: string; accountName: string; balance: string };
      const assets: BsItem[] = [];
      const liabilities: BsItem[] = [];
      const equity: BsItem[] = [];

      for (const [code, acc] of allMap) {
        const acctInfo = coaTypeMap.get(code);
        if (!acctInfo) continue;
        const { type } = acctInfo;

        if (type === "asset") {
          // Asset balance = debit - credit (debit-normal)
          const balance = money.sub(acc.debit, acc.credit);
          if (money.compare(balance, "0") !== 0) {
            assets.push({ accountCode: code, accountName: acc.name, balance });
          }
        } else if (type === "liability") {
          // Liability balance = credit - debit (credit-normal)
          const balance = money.sub(acc.credit, acc.debit);
          if (money.compare(balance, "0") !== 0) {
            liabilities.push({ accountCode: code, accountName: acc.name, balance });
          }
        } else if (type === "equity") {
          // Equity balance = credit - debit (credit-normal)
          const balance = money.sub(acc.credit, acc.debit);
          if (money.compare(balance, "0") !== 0) {
            equity.push({ accountCode: code, accountName: acc.name, balance });
          }
        }
        // income/expense accounts go into net income, not balance sheet directly
      }

      // Sort each section by account code
      assets.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
      liabilities.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
      equity.sort((a, b) => a.accountCode.localeCompare(b.accountCode));

      // Append net income to equity section
      equity.push({
        accountCode: "9999",
        accountName: "Net Income (Current Period)",
        balance: netIncome,
      });

      const totalAssets = money.sum(assets.map((a) => a.balance));
      const totalLiabilities = money.sum(liabilities.map((a) => a.balance));
      const totalEquity = money.sum(equity.map((a) => a.balance));

      return { assets, liabilities, equity, totalAssets, totalLiabilities, totalEquity };
    }),

  // ── 13. Profit & Loss (CoA-based) ─────────────────────────────
  profitAndLoss: viewerProcedure
    .input(z.object({
      fromDate: z.string().datetime(),
      toDate: z.string().datetime(),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");

      const from = new Date(input.fromDate);
      const to = new Date(input.toDate);

      const entries = await deriveFullLedger(ctx.db, ctx.businessId, from, to);

      // Fetch CoA for type information
      const coaRows = await ctx.db
        .select({
          code: chartOfAccounts.code,
          name: chartOfAccounts.name,
          accountType: chartOfAccounts.accountType,
        })
        .from(chartOfAccounts)
        .where(eq(chartOfAccounts.businessId, ctx.businessId));

      const coaTypeMap = new Map(
        coaRows.map((r) => [r.code, { name: r.name, type: r.accountType }]),
      );

      // Aggregate debits and credits per account
      type AccBalance = { code: string; name: string; debit: string; credit: string };
      const accountMap = new Map<string, AccBalance>();

      for (const entry of entries) {
        for (const line of entry.lines) {
          const existing = accountMap.get(line.accountCode) ?? {
            code: line.accountCode,
            name: line.accountName,
            debit: "0.00",
            credit: "0.00",
          };
          existing.debit = money.add(existing.debit, line.debit);
          existing.credit = money.add(existing.credit, line.credit);
          accountMap.set(line.accountCode, existing);
        }
      }

      // Split into income and expense line items
      // Income: amount = credit - debit (credit-normal accounts)
      // Expenses: amount = debit - credit (debit-normal accounts)
      type PlItem = { accountCode: string; accountName: string; amount: string };
      const income: PlItem[] = [];
      const expenseItems: PlItem[] = [];

      for (const [code, acc] of accountMap) {
        const acctInfo = coaTypeMap.get(code);
        if (!acctInfo) continue;
        const { type } = acctInfo;

        if (type === "income") {
          const amount = money.sub(acc.credit, acc.debit);
          income.push({ accountCode: code, accountName: acc.name, amount });
        } else if (type === "expense") {
          const amount = money.sub(acc.debit, acc.credit);
          expenseItems.push({ accountCode: code, accountName: acc.name, amount });
        }
      }

      income.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
      expenseItems.sort((a, b) => a.accountCode.localeCompare(b.accountCode));

      const totalIncome = money.sum(income.map((a) => a.amount));
      const totalExpenses = money.sum(expenseItems.map((a) => a.amount));

      // Gross profit = Sales (4000) - Direct costs (5000 Purchases + 5100 Direct Expenses)
      const salesAmt = income.find((a) => a.accountCode === "4000")?.amount ?? "0.00";
      const salesReturnsAmt = expenseItems.find((a) => a.accountCode === "4010")?.amount ?? "0.00";
      const purchasesAmt = expenseItems.find((a) => a.accountCode === "5000")?.amount ?? "0.00";
      const directExpAmt = expenseItems.find((a) => a.accountCode === "5100")?.amount ?? "0.00";

      const grossProfit = money.sub(
        money.sub(salesAmt, salesReturnsAmt),
        money.add(purchasesAmt, directExpAmt),
      );

      const netProfit = money.sub(totalIncome, totalExpenses);

      return {
        income,
        expenses: expenseItems,
        totalIncome,
        totalExpenses,
        grossProfit,
        netProfit,
      };
    }),

  // ── 14. General Ledger ────────────────────────────────────────
  generalLedger: viewerProcedure
    .input(z.object({
      accountId: z.string().uuid(),
      fromDate: z.string().datetime(),
      toDate: z.string().datetime(),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");

      // 1. Get account details
      const [account] = await ctx.db.select()
        .from(chartOfAccounts)
        .where(and(
          eq(chartOfAccounts.id, input.accountId),
          eq(chartOfAccounts.businessId, ctx.businessId),
        ))
        .limit(1);

      if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });

      const from = new Date(input.fromDate);
      const to = new Date(input.toDate);

      // 2. Get derived entries for this account (from operational transactions)
      const allDerived = await deriveLedger(ctx.db, ctx.businessId, from, to);

      type LedgerLine = {
        date: Date;
        narration: string;
        sourceType: string;
        sourceId: string;
        sourceNumber: string;
        debit: string;
        credit: string;
      };

      const derivedLines: LedgerLine[] = [];
      for (const entry of allDerived) {
        for (const line of entry.lines) {
          if (line.accountId === input.accountId) {
            derivedLines.push({
              date: entry.date,
              narration: entry.narration,
              sourceType: entry.sourceType,
              sourceId: entry.sourceId,
              sourceNumber: entry.sourceNumber,
              debit: line.debit,
              credit: line.credit,
            });
          }
        }
      }

      // 3. Get manual journal entry lines for this account
      const jeRows = await ctx.db.select({
        date: journalEntries.entryDate,
        narration: journalEntries.narration,
        sourceNumber: journalEntries.entryNumber,
        debit: journalEntryLines.debit,
        credit: journalEntryLines.credit,
        journalEntryId: journalEntries.id,
      })
      .from(journalEntryLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalEntryLines.journalEntryId))
      .where(and(
        eq(journalEntryLines.accountId, input.accountId),
        eq(journalEntries.businessId, ctx.businessId),
        gte(journalEntries.entryDate, from),
        lte(journalEntries.entryDate, to),
      ));

      const journalLines: LedgerLine[] = jeRows.map(je => ({
        date: je.date,
        narration: je.narration ?? "",
        sourceType: "journal",
        sourceId: je.journalEntryId,
        sourceNumber: je.sourceNumber,
        debit: je.debit,
        credit: je.credit,
      }));

      // 4. Merge, sort by date, compute running balance
      const allLines = [...derivedLines, ...journalLines]
        .sort((a, b) => a.date.getTime() - b.date.getTime());

      let runningBalance = "0.00";
      const entries = allLines.map(line => {
        // Standard ledger convention: balance = previous balance + debit - credit
        runningBalance = money.sub(money.add(runningBalance, line.debit), line.credit);
        return {
          date: line.date.toISOString(),
          narration: line.narration,
          sourceType: line.sourceType,
          sourceId: line.sourceId,
          sourceNumber: line.sourceNumber,
          debit: line.debit,
          credit: line.credit,
          balance: runningBalance,
        };
      });

      return {
        accountId: account.id,
        accountCode: account.code,
        accountName: account.name,
        accountType: account.accountType,
        entries,
        closingBalance: runningBalance,
      };
    }),

  // ── Tally Prime XML export ─────────────────────────────────────
  tallyExport: viewerProcedure
    .input(z.object({
      fromDate: z.string().datetime(),
      toDate: z.string().datetime(),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");

      const from = new Date(input.fromDate);
      const to = new Date(input.toDate);

      // ── 1. Derived entries (invoices, payments, expenses) ─────────
      const derived = await deriveLedger(ctx.db, ctx.businessId, from, to);

      // ── 2. Manual journal entries → DerivedEntry format ───────────
      const manualEntries = await ctx.db
        .select({
          id: journalEntries.id,
          entryNumber: journalEntries.entryNumber,
          entryDate: journalEntries.entryDate,
          narration: journalEntries.narration,
        })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.businessId, ctx.businessId),
            gte(journalEntries.entryDate, from),
            lte(journalEntries.entryDate, to),
          ),
        )
        .orderBy(journalEntries.entryDate);

      const journalDerived = await Promise.all(
        manualEntries.map(async (je) => {
          const lines = await ctx.db
            .select({
              id: journalEntryLines.id,
              accountId: journalEntryLines.accountId,
              accountCode: chartOfAccounts.code,
              accountName: chartOfAccounts.name,
              debit: journalEntryLines.debit,
              credit: journalEntryLines.credit,
            })
            .from(journalEntryLines)
            .innerJoin(chartOfAccounts, eq(journalEntryLines.accountId, chartOfAccounts.id))
            .where(eq(journalEntryLines.journalEntryId, je.id));

          return {
            date: je.entryDate,
            narration: je.narration ?? `Journal Entry ${je.entryNumber}`,
            sourceType: "journal" as const,
            sourceId: je.id,
            sourceNumber: je.entryNumber,
            lines: lines.map((l) => ({
              accountId: l.accountId,
              accountCode: l.accountCode,
              accountName: l.accountName,
              debit: l.debit,
              credit: l.credit,
            })),
          };
        }),
      );

      // ── 3. Chart of Accounts ──────────────────────────────────────
      const coaRows = await ctx.db
        .select({
          code: chartOfAccounts.code,
          name: chartOfAccounts.name,
          accountType: chartOfAccounts.accountType,
        })
        .from(chartOfAccounts)
        .where(eq(chartOfAccounts.businessId, ctx.businessId));

      // ── 4. Business name ──────────────────────────────────────────
      const [biz] = await ctx.db
        .select({ name: businesses.name })
        .from(businesses)
        .where(eq(businesses.id, ctx.businessId))
        .limit(1);

      // ── 5. Generate XML ───────────────────────────────────────────
      const allEntries = [...derived, ...journalDerived].sort(
        (a, b) => a.date.getTime() - b.date.getTime(),
      );

      const xml = generateTallyXml(
        allEntries,
        coaRows.map((a) => ({
          code: a.code,
          name: a.name,
          accountType: a.accountType as "asset" | "liability" | "equity" | "income" | "expense",
        })),
        { name: biz?.name ?? "Business" },
      );

      const fromSlice = input.fromDate.slice(0, 10);
      const toSlice = input.toDate.slice(0, 10);

      return {
        xml,
        filename: `tally-export-${fromSlice}-to-${toSlice}.xml`,
      };
    }),
});
