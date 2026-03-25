import { eq, and, ilike, sql, desc, asc, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { parties, invoices, payments, expenses, items, invoiceItems } from "@hisaabo/db";
import { createPartySchema, updatePartySchema, paginationSchema, money } from "@hisaabo/shared";
import { router, viewerProcedure, memberProcedure, adminProcedure } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { requireCan } from "../lib/permissions.js";
import { logAudit } from "../lib/audit.js";


export const partyRouter = router({
  list: viewerProcedure
    .input(z.object({
      type: z.enum(["customer", "supplier"]).nullish(),
      filter: z.enum(["all", "customer", "supplier", "outstanding", "overdue"]).nullish(),
      search: z.string().nullish(),
      category: z.string().nullish(),
      sortBy: z.enum(["name", "balance"]).nullish(),
      sortDir: z.enum(["asc", "desc"]).nullish(),
      ...paginationSchema.shape,
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Party");
      const conditions = [eq(parties.businessId, ctx.businessId)];

      // Support both legacy `type` param and new `filter` param
      const effectiveFilter = input.filter ?? (input.type ? input.type : "all");
      if (effectiveFilter === "customer") {
        conditions.push(eq(parties.type, "customer"));
      } else if (effectiveFilter === "supplier") {
        conditions.push(eq(parties.type, "supplier"));
      } else if (effectiveFilter === "outstanding") {
        // Parties where opening_balance + unpaid invoice balance > 0
        conditions.push(sql`(
          ${parties.openingBalance}::numeric + COALESCE((
            SELECT SUM(${invoices.totalAmount}::numeric - ${invoices.amountPaid}::numeric)
            FROM ${invoices}
            WHERE ${invoices.partyId} = ${parties.id}
              AND ${invoices.businessId} = ${parties.businessId}
              AND ${invoices.status} NOT IN ('paid', 'cancelled')
          ), 0)
        ) > 0`);
      } else if (effectiveFilter === "overdue") {
        // Parties that have at least one overdue invoice
        conditions.push(sql`EXISTS (
          SELECT 1 FROM ${invoices}
          WHERE ${invoices.partyId} = ${parties.id}
            AND ${invoices.businessId} = ${parties.businessId}
            AND ${invoices.status} = 'overdue'
        )`);
      }

      if (input.search) conditions.push(ilike(parties.name, `%${input.search}%`));
      if (input.category) conditions.push(eq(parties.category, input.category));

      const offset = (input.page - 1) * input.limit;

      const sortCol = input.sortBy === "balance"
        ? (input.sortDir === "asc" ? sql`${parties.openingBalance}::numeric ASC` : sql`${parties.openingBalance}::numeric DESC`)
        : (input.sortDir === "desc" ? desc(parties.name) : asc(parties.name));

      const [data, [{ count }]] = await Promise.all([
        ctx.db.select().from(parties)
          .where(and(...conditions))
          .orderBy(sortCol)
          .limit(input.limit)
          .offset(offset),
        ctx.db.select({ count: sql<number>`count(*)::int` }).from(parties)
          .where(and(...conditions)),
      ]);

      return { data, total: count, page: input.page, limit: input.limit };
    }),

  getById: viewerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Party");
      const [party] = await ctx.db.select().from(parties)
        .where(and(eq(parties.id, input.id), eq(parties.businessId, ctx.businessId)))
        .limit(1);

      if (!party) return null;

      // Calculate balance from invoices and payments
      const [balanceResult] = await ctx.db.select({
        totalInvoiced: sql<string>`coalesce(sum(${invoices.totalAmount}), '0')`,
        totalPaid: sql<string>`coalesce(sum(${invoices.amountPaid}), '0')`,
      }).from(invoices)
        .where(and(eq(invoices.partyId, input.id), eq(invoices.businessId, ctx.businessId)));

      return {
        ...party,
        balance: money.sub(money.add(party.openingBalance, balanceResult.totalInvoiced || "0"), balanceResult.totalPaid || "0"),
      };
    }),

  create: memberProcedure.input(createPartySchema).mutation(async ({ input, ctx }) => {
    requireCan(ctx.ability, "create", "Party");
    const [party] = await ctx.db.insert(parties).values({
      ...input,
      businessId: ctx.businessId,
      // Handle optional date fields
      contactPersonDob: input.contactPersonDob ? new Date(input.contactPersonDob) : null,
    }).returning();
    return party;
  }),

  update: memberProcedure
    .input(z.object({ id: z.string().uuid(), data: updatePartySchema }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Party");
      const { contactPersonDob, ...rest } = input.data;
      const [party] = await ctx.db.update(parties)
        .set({
          ...rest,
          ...(contactPersonDob ? { contactPersonDob: new Date(contactPersonDob) } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(parties.id, input.id), eq(parties.businessId, ctx.businessId)))
        .returning();
      return party;
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "delete", "Party");
      await ctx.db.delete(parties)
        .where(and(eq(parties.id, input.id), eq(parties.businessId, ctx.businessId)));
      return { success: true };
    }),

  topItems: viewerProcedure
    .input(z.object({ partyId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Party");
      const rows = await ctx.db.select({
        itemId: invoiceItems.itemId,
        itemName: items.name,
        totalQuantity: sql<string>`SUM(${invoiceItems.quantity}::numeric)::text`,
        totalAmount: sql<string>`SUM(${invoiceItems.totalAmount}::numeric)::text`,
        invoiceCount: sql<number>`COUNT(DISTINCT ${invoices.id})::int`,
      })
        .from(invoiceItems)
        .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
        .innerJoin(items, eq(items.id, invoiceItems.itemId))
        .where(
          and(
            eq(invoices.partyId, input.partyId),
            eq(invoices.businessId, ctx.businessId),
            eq(invoices.documentType, "invoice"),
            sql`${invoiceItems.itemId} IS NOT NULL`,
            sql`${invoices.status} != 'cancelled'`,
          )
        )
        .groupBy(invoiceItems.itemId, items.name)
        .orderBy(sql`SUM(${invoiceItems.quantity}::numeric) DESC`)
        .limit(5);

      return rows;
    }),

  getStats: viewerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Party");
      const [stats] = await ctx.db.select({
        invoiceCount: sql<number>`count(distinct ${invoices.id})::int`,
        paymentCount: sql<number>`(select count(*)::int from ${payments} where ${payments.partyId} = ${input.id} and ${payments.businessId} = ${ctx.businessId})`,
      })
        .from(invoices)
        .where(and(eq(invoices.partyId, input.id), eq(invoices.businessId, ctx.businessId)));

      return {
        invoiceCount: stats?.invoiceCount ?? 0,
        paymentCount: stats?.paymentCount ?? 0,
      };
    }),

  merge: adminProcedure
    .input(z.object({
      sourceId: z.string().uuid(),
      targetId: z.string().uuid(),
    }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "delete", "Party");
      if (input.sourceId === input.targetId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot merge a party into itself" });
      }

      const ipAddress = ctx.req.headers.get("x-forwarded-for") || ctx.req.headers.get("cf-connecting-ip") || null;
      const result = await ctx.db.transaction(async (tx) => {
        const [source] = await tx.select().from(parties)
          .where(and(eq(parties.id, input.sourceId), eq(parties.businessId, ctx.businessId))).limit(1);
        const [target] = await tx.select().from(parties)
          .where(and(eq(parties.id, input.targetId), eq(parties.businessId, ctx.businessId))).limit(1);

        if (!source || !target) throw new TRPCError({ code: "NOT_FOUND", message: "Party not found" });

        // Move all invoices from source to target
        await tx.update(invoices)
          .set({ partyId: input.targetId, updatedAt: new Date() })
          .where(and(eq(invoices.partyId, input.sourceId), eq(invoices.businessId, ctx.businessId)));

        // Move all payments from source to target
        await tx.update(payments)
          .set({ partyId: input.targetId })
          .where(and(eq(payments.partyId, input.sourceId), eq(payments.businessId, ctx.businessId)));

        // Merge opening balances
        const mergedBalance = money.add(source.openingBalance || "0", target.openingBalance || "0");

        // Fill missing fields on target from source (don't overwrite existing data)
        const updates: Record<string, unknown> = { openingBalance: mergedBalance, updatedAt: new Date() };
        if (!target.phone && source.phone) updates.phone = source.phone;
        if (!target.email && source.email) updates.email = source.email;
        if (!target.gstin && source.gstin) updates.gstin = source.gstin;
        if (!target.pan && source.pan) updates.pan = source.pan;
        if (!target.billingAddress && source.billingAddress) updates.billingAddress = source.billingAddress;
        if (!target.city && source.city) updates.city = source.city;
        if (!target.state && source.state) updates.state = source.state;
        if (!target.pincode && source.pincode) updates.pincode = source.pincode;
        if (!target.category && source.category) updates.category = source.category;

        await tx.update(parties).set(updates).where(eq(parties.id, input.targetId));

        // Delete the source party
        await tx.delete(parties).where(eq(parties.id, input.sourceId));

        return { success: true, mergedInto: input.targetId, sourceName: source.name, targetName: target.name };
      });

      await logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user!.id,
        action: "party.merge",
        entityType: "party",
        entityId: input.targetId,
        metadata: { sourceId: input.sourceId, sourceName: result.sourceName, targetName: result.targetName },
        ipAddress,
      });

      return { success: result.success, mergedInto: result.mergedInto };
    }),

  /**
   * ledgerReport — aggregated ledger for a party with date range, returns full list
   * plus summary totals and closing balance.
   */
  ledgerReport: viewerProcedure
    .input(z.object({
      partyId: z.string().uuid(),
      fromDate: z.string().datetime().optional(),
      toDate: z.string().datetime().optional(),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");

      const [party] = await ctx.db.select().from(parties)
        .where(and(eq(parties.id, input.partyId), eq(parties.businessId, ctx.businessId)))
        .limit(1);
      if (!party) return null;

      const invoiceConditions = [
        eq(invoices.partyId, input.partyId),
        eq(invoices.businessId, ctx.businessId),
        eq(invoices.documentType, "invoice"),
      ];
      const paymentConditions = [
        eq(payments.partyId, input.partyId),
        eq(payments.businessId, ctx.businessId),
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
        ctx.db.select({
          id: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          date: invoices.invoiceDate,
          type: invoices.type,
          totalAmount: invoices.totalAmount,
          status: invoices.status,
        }).from(invoices).where(and(...invoiceConditions)).orderBy(invoices.invoiceDate),
        ctx.db.select({
          id: payments.id,
          paymentNumber: payments.paymentNumber,
          date: payments.paymentDate,
          amount: payments.amount,
          mode: payments.mode,
        }).from(payments).where(and(...paymentConditions)).orderBy(payments.paymentDate),
      ]);

      // Build ledger entries interleaved by date.
      // For a customer (sale): invoice is a debit (money owed to us), payment is a credit.
      // For a supplier (purchase): invoice is a credit (money we owe), payment is a debit.
      const entries = [
        ...partyInvoices.map(inv => ({
          date: inv.date,
          type: "invoice" as const,
          number: inv.invoiceNumber,
          description: inv.type === "sale" ? "Sale Invoice" : "Purchase Invoice",
          debit: inv.type === "sale" ? inv.totalAmount : "0",
          credit: inv.type === "sale" ? "0" : inv.totalAmount,
          status: inv.status,
          documentId: inv.id,
        })),
        ...partyPayments.map(pmt => ({
          date: pmt.date,
          type: "payment" as const,
          number: pmt.paymentNumber || "",
          description: `Payment (${pmt.mode})`,
          // Payment received from customer = credit; payment made to supplier = debit
          debit: party.type === "supplier" ? pmt.amount : "0",
          credit: party.type === "supplier" ? "0" : pmt.amount,
          status: null as string | null,
          documentId: pmt.id,
        })),
      ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      // Compute running balance and summary using the money module
      let runningBalance = party.openingBalance;
      const entriesWithBalance = entries.map(e => {
        runningBalance = money.add(money.sub(runningBalance, e.credit), e.debit);
        return { ...e, runningBalance };
      });

      const totalDebit = money.sum(entries.map(e => e.debit));
      const totalCredit = money.sum(entries.map(e => e.credit));
      const closingBalance = money.add(money.sub(party.openingBalance, totalCredit), totalDebit);

      return {
        party: {
          name: party.name,
          type: party.type,
          openingBalance: party.openingBalance,
          gstin: party.gstin,
          phone: party.phone,
          city: party.city,
          state: party.state,
        },
        entries: entriesWithBalance,
        summary: {
          totalDebit,
          totalCredit,
          closingBalance,
        },
      };
    }),

  /**
   * ledgerReportCSV — same data as above but serialized as a CSV string.
   */
  ledgerReportCSV: viewerProcedure
    .input(z.object({
      partyId: z.string().uuid(),
      fromDate: z.string().datetime().optional(),
      toDate: z.string().datetime().optional(),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");

      const [party] = await ctx.db.select().from(parties)
        .where(and(eq(parties.id, input.partyId), eq(parties.businessId, ctx.businessId)))
        .limit(1);
      if (!party) return null;

      const invoiceConditions = [
        eq(invoices.partyId, input.partyId),
        eq(invoices.businessId, ctx.businessId),
        eq(invoices.documentType, "invoice"),
      ];
      const paymentConditions = [
        eq(payments.partyId, input.partyId),
        eq(payments.businessId, ctx.businessId),
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
        ctx.db.select({
          id: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          date: invoices.invoiceDate,
          type: invoices.type,
          totalAmount: invoices.totalAmount,
          status: invoices.status,
        }).from(invoices).where(and(...invoiceConditions)).orderBy(invoices.invoiceDate),
        ctx.db.select({
          id: payments.id,
          paymentNumber: payments.paymentNumber,
          date: payments.paymentDate,
          amount: payments.amount,
          mode: payments.mode,
        }).from(payments).where(and(...paymentConditions)).orderBy(payments.paymentDate),
      ]);

      const entries = [
        ...partyInvoices.map(inv => ({
          date: inv.date,
          number: inv.invoiceNumber,
          description: inv.type === "sale" ? "Sale Invoice" : "Purchase Invoice",
          debit: inv.type === "sale" ? inv.totalAmount : "0",
          credit: inv.type === "sale" ? "0" : inv.totalAmount,
        })),
        ...partyPayments.map(pmt => ({
          date: pmt.date,
          number: pmt.paymentNumber || "",
          description: `Payment (${pmt.mode})`,
          debit: party.type === "supplier" ? pmt.amount : "0",
          credit: party.type === "supplier" ? "0" : pmt.amount,
        })),
      ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      function fmtDate(d: Date): string {
        const dd = String(d.getDate()).padStart(2, "0");
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const yyyy = d.getFullYear();
        return `${dd}/${mm}/${yyyy}`;
      }
      function csvCell(v: string): string {
        return `"${v.replace(/"/g, '""')}"`;
      }

      let runningBalance = party.openingBalance;
      const rows: string[] = [];

      // Opening balance row
      rows.push([
        csvCell(fmtDate(new Date(input.fromDate || new Date(0).toISOString()))),
        csvCell("Opening Balance"),
        csvCell(""),
        csvCell(""),
        csvCell(""),
        csvCell(runningBalance),
      ].join(","));

      for (const e of entries) {
        runningBalance = money.add(money.sub(runningBalance, e.credit), e.debit);
        rows.push([
          csvCell(fmtDate(new Date(e.date))),
          csvCell(e.description),
          csvCell(e.number),
          csvCell(e.debit),
          csvCell(e.credit),
          csvCell(runningBalance),
        ].join(","));
      }

      const header = "Date,Description,Document #,Debit,Credit,Balance";
      const csv = [header, ...rows].join("\n");
      const safePartyName = party.name.replace(/[^a-zA-Z0-9_-]/g, "_");
      const dateSuffix = input.fromDate
        ? `_${input.fromDate.slice(0, 10)}`
        : "";

      return {
        csv,
        filename: `ledger_${safePartyName}${dateSuffix}.csv`,
      };
    }),

  /**
   * tallyExport — generates a Tally-compatible CSV of all vouchers
   * (sales invoices, purchase invoices, payments, expenses) for the period.
   */
  tallyExport: viewerProcedure
    .input(z.object({
      fromDate: z.string().datetime().optional(),
      toDate: z.string().datetime().optional(),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");

      function formatTallyDate(d: Date): string {
        const dd = String(d.getDate()).padStart(2, "0");
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const yyyy = d.getFullYear();
        return `${dd}-${mm}-${yyyy}`;
      }

      const invoiceConditions = [eq(invoices.businessId, ctx.businessId), eq(invoices.documentType, "invoice")];
      const paymentConditions = [eq(payments.businessId, ctx.businessId)];
      const expenseConditions = [eq(expenses.businessId, ctx.businessId)];

      if (input.fromDate) {
        invoiceConditions.push(gte(invoices.invoiceDate, new Date(input.fromDate)));
        paymentConditions.push(gte(payments.paymentDate, new Date(input.fromDate)));
        expenseConditions.push(gte(expenses.expenseDate, new Date(input.fromDate)));
      }
      if (input.toDate) {
        invoiceConditions.push(lte(invoices.invoiceDate, new Date(input.toDate)));
        paymentConditions.push(lte(payments.paymentDate, new Date(input.toDate)));
        expenseConditions.push(lte(expenses.expenseDate, new Date(input.toDate)));
      }

      const [allInvoices, allPayments, allExpenses] = await Promise.all([
        ctx.db.select({
          invoiceDate: invoices.invoiceDate,
          invoiceNumber: invoices.invoiceNumber,
          type: invoices.type,
          totalAmount: invoices.totalAmount,
          partyName: parties.name,
        }).from(invoices)
          .innerJoin(parties, eq(parties.id, invoices.partyId))
          .where(and(...invoiceConditions))
          .orderBy(invoices.invoiceDate),

        ctx.db.select({
          paymentDate: payments.paymentDate,
          paymentNumber: payments.paymentNumber,
          amount: payments.amount,
          mode: payments.mode,
          partyName: parties.name,
          partyType: parties.type,
        }).from(payments)
          .innerJoin(parties, eq(parties.id, payments.partyId))
          .where(and(...paymentConditions))
          .orderBy(payments.paymentDate),

        ctx.db.select({
          expenseDate: expenses.expenseDate,
          category: expenses.category,
          description: expenses.description,
          amount: expenses.amount,
          mode: expenses.mode,
        }).from(expenses)
          .where(and(...expenseConditions))
          .orderBy(expenses.expenseDate),
      ]);

      type TallyVoucher = {
        date: string;
        vchType: string;
        vchNo: string;
        debitLedger: string;
        creditLedger: string;
        amount: string;
        sortKey: number;
      };

      const vouchers: TallyVoucher[] = [];

      for (const inv of allInvoices) {
        vouchers.push({
          date: formatTallyDate(new Date(inv.invoiceDate)),
          vchType: inv.type === "sale" ? "Sales" : "Purchase",
          vchNo: inv.invoiceNumber,
          debitLedger: inv.type === "sale" ? inv.partyName : "Purchase Account",
          creditLedger: inv.type === "sale" ? "Sales Account" : inv.partyName,
          amount: inv.totalAmount,
          sortKey: new Date(inv.invoiceDate).getTime(),
        });
      }

      for (const pmt of allPayments) {
        const accountName = pmt.mode === "cash" ? "Cash" : "Bank";
        const isSalePayment = pmt.partyType === "customer";
        vouchers.push({
          date: formatTallyDate(new Date(pmt.paymentDate)),
          vchType: isSalePayment ? "Receipt" : "Payment",
          vchNo: pmt.paymentNumber || "",
          debitLedger: isSalePayment ? accountName : pmt.partyName,
          creditLedger: isSalePayment ? pmt.partyName : accountName,
          amount: pmt.amount,
          sortKey: new Date(pmt.paymentDate).getTime(),
        });
      }

      for (const exp of allExpenses) {
        const expAccountName = exp.mode === "cash" ? "Cash" : "Bank";
        vouchers.push({
          date: formatTallyDate(new Date(exp.expenseDate)),
          vchType: "Payment",
          vchNo: "",
          debitLedger: exp.category,
          creditLedger: expAccountName,
          amount: exp.amount,
          sortKey: new Date(exp.expenseDate).getTime(),
        });
      }

      vouchers.sort((a, b) => a.sortKey - b.sortKey);

      function csvCell(v: string): string {
        return `"${v.replace(/"/g, '""')}"`;
      }

      const header = "Date,Vch Type,Vch No.,Debit Ledger,Credit Ledger,Amount";
      const rows = vouchers.map(v =>
        [csvCell(v.date), csvCell(v.vchType), csvCell(v.vchNo), csvCell(v.debitLedger), csvCell(v.creditLedger), csvCell(v.amount)].join(",")
      );
      const csv = [header, ...rows].join("\n");

      const dateSuffix = input.fromDate ? `_${input.fromDate.slice(0, 10)}` : "_all";
      return {
        csv,
        filename: `tally-export${dateSuffix}.csv`,
        rowCount: vouchers.length,
        preview: vouchers.slice(0, 10),
      };
    }),

  /**
   * Party ledger — chronological UNION ALL of invoices and payments for a party.
   * Each row: date, type, documentNumber, amount, runningBalance.
   */
  ledger: viewerProcedure
    .input(z.object({
      partyId: z.string().uuid(),
      fromDate: z.string().datetime().optional(),
      toDate: z.string().datetime().optional(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(50),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Party");
      // Verify party belongs to this business
      const [party] = await ctx.db
        .select({ id: parties.id, openingBalance: parties.openingBalance })
        .from(parties)
        .where(and(eq(parties.id, input.partyId), eq(parties.businessId, ctx.businessId)))
        .limit(1);

      if (!party) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Party not found" });
      }

      const offset = (input.page - 1) * input.limit;

      const openingBalanceNum = money.toNumber(party.openingBalance);

      // Build date filter conditions inline
      const fromDate = input.fromDate ? new Date(input.fromDate) : null;
      const toDate = input.toDate ? new Date(input.toDate) : null;

      // UNION ALL: invoices (debit for sales, credit for purchases) + payments
      // Uses raw SQL with parameterised values — column names are safe literals.
      const ledgerRows = await ctx.db.execute(sql`
        WITH ledger AS (
          SELECT
            invoice_date AS entry_date,
            'invoice'::text AS entry_type,
            invoice_number AS document_number,
            id AS document_id,
            total_amount::numeric AS debit,
            0::numeric AS credit,
            status
          FROM invoices
          WHERE party_id = ${input.partyId}
            AND business_id = ${ctx.businessId}
            AND type = 'sale'
            AND document_type = 'invoice'

          UNION ALL

          SELECT
            invoice_date AS entry_date,
            'purchase'::text AS entry_type,
            invoice_number AS document_number,
            id AS document_id,
            0::numeric AS debit,
            total_amount::numeric AS credit,
            status
          FROM invoices
          WHERE party_id = ${input.partyId}
            AND business_id = ${ctx.businessId}
            AND type = 'purchase'
            AND document_type = 'invoice'

          UNION ALL

          SELECT
            payment_date AS entry_date,
            'payment'::text AS entry_type,
            coalesce(payment_number, id::text) AS document_number,
            id AS document_id,
            0::numeric AS debit,
            amount::numeric AS credit,
            NULL AS status
          FROM payments
          WHERE party_id = ${input.partyId}
            AND business_id = ${ctx.businessId}
        ),
        filtered AS (
          SELECT * FROM ledger
          WHERE (${fromDate}::timestamptz IS NULL OR entry_date >= ${fromDate}::timestamptz)
            AND (${toDate}::timestamptz IS NULL OR entry_date <= ${toDate}::timestamptz)
        ),
        with_balance AS (
          SELECT
            *,
            ${openingBalanceNum}::numeric
              + SUM(debit - credit) OVER (
                  ORDER BY entry_date ASC, document_number ASC
                  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                )
            AS running_balance
          FROM filtered
        )
        SELECT *, count(*) OVER () AS total_count
        FROM with_balance
        ORDER BY entry_date ASC, document_number ASC
        LIMIT ${input.limit} OFFSET ${offset}
      `);

      const rows = (ledgerRows as unknown) as Array<{
        entry_date: Date;
        entry_type: string;
        document_number: string;
        document_id: string;
        debit: string;
        credit: string;
        status: string | null;
        running_balance: string;
        total_count: string;
      }>;

      const total = rows.length > 0 ? parseInt(rows[0].total_count, 10) : 0;

      return {
        openingBalance: party.openingBalance,
        data: rows.map((r) => ({
          date: r.entry_date,
          type: r.entry_type,
          documentNumber: r.document_number,
          documentId: r.document_id,
          debit: r.debit,
          credit: r.credit,
          status: r.status,
          runningBalance: r.running_balance,
        })),
        total,
        page: input.page,
        limit: input.limit,
      };
    }),
});
