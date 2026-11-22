import { eq, and, ilike, or, sql, desc, asc, isNull, inArray } from "drizzle-orm";
import { z } from "zod";
import { parties, invoices, payments, expenses, items, invoiceItems } from "@hisaabo/db";
import { createPartySchema, updatePartySchema, paginationSchema, money, csvRow } from "@hisaabo/shared";
import { router, viewerProcedure, memberProcedure, adminProcedure } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { requireCan } from "../lib/permissions.js";
import { logAudit } from "../lib/audit.js";
import { warnTallyCsvExportDeprecated } from "../lib/deprecations.js";
import { escapeLike } from "../lib/escape-like.js";
import { buildBusinessDateFilter } from "../lib/business-date.js";
import { paymentLedgerLeg, paymentSettlement, paymentSettledSql, paymentTdsSql } from "../lib/payment-settlement.js";
import { documentLedgerSide, invoiceBalanceSql, invoiceIsLedgerDebitSql, signedOpeningBalance, BALANCE_DOCUMENT_TYPES } from "../lib/party-balance.js";


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
        // Parties whose balance (opening + the same signed document sum `balance` uses) is > 0
        conditions.push(sql`(
          ${parties.openingBalance}::numeric + COALESCE((
            SELECT SUM(${invoiceBalanceSql()})
            FROM ${invoices}
            WHERE ${invoices.partyId} = ${parties.id}
              AND ${invoices.businessId} = ${parties.businessId}
              AND ${invoices.status} NOT IN ('cancelled')
              AND ${invoices.deletedAt} IS NULL
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

      if (input.search) {
        // Match on name OR phone. Retail POS needs phone lookup as the
        // primary recall path ("that aunty with number 98765..."); name is
        // the fallback for named/B2B customers. Both fields are ILIKE'd
        // with the same user-typed pattern — good enough for the typical
        // catalog size. Tenant-scoped already, so no cross-business leak.
        const pat = `%${escapeLike(input.search)}%`;
        conditions.push(or(ilike(parties.name, pat), ilike(parties.phone, pat))!);
      }
      if (input.category) conditions.push(eq(parties.category, input.category));

      const offset = (input.page - 1) * input.limit;

      // Credit notes, sales returns, purchase returns and purchase-side debit notes REDUCE the
      // balance; quotations, proformas and challans never count (lib/party-balance.ts).
      const invoiceDue = invoiceBalanceSql();
      const invoiceFilter = and(
        eq(invoices.businessId, ctx.businessId),
        sql`${invoices.status} NOT IN ('cancelled')`,
        isNull(invoices.deletedAt),
      );

      const sortByBalance = input.sortBy === "balance";

      // Sorting by balance needs every party's balance, so pre-aggregate invoices
      // per party in a single scan. Otherwise only the returned page needs it:
      // a correlated subquery (indexed on invoices.party_id) is evaluated just
      // for the page's rows instead of aggregating every invoice in the business.
      // (`parties.id` is written literally: Drizzle drops table qualifiers in a
      // join-less select, which would make the column resolve to invoices.id.)
      const invoiceBalanceSq = ctx.db
        .select({
          partyId: invoices.partyId,
          balance: sql<string>`COALESCE(SUM(${invoiceDue}), 0)`.as("inv_balance"),
        })
        .from(invoices)
        .where(invoiceFilter)
        .groupBy(invoices.partyId)
        .as("invoice_balances");

      const balanceExpr = sortByBalance
        ? sql<string>`(${parties.openingBalance}::numeric + COALESCE(${invoiceBalanceSq.balance}::numeric, 0))::text`
        : sql<string>`(${parties.openingBalance}::numeric + COALESCE((
            SELECT SUM(${invoiceDue}) FROM ${invoices}
            WHERE ${invoices.partyId} = parties.id AND ${invoiceFilter}
          ), 0))::text`;

      const sortCol = sortByBalance
        ? (input.sortDir === "asc" ? sql`${balanceExpr}::numeric ASC` : sql`${balanceExpr}::numeric DESC`)
        : (input.sortDir === "desc" ? desc(parties.name) : asc(parties.name));
      const idTiebreak = input.sortDir === "desc" ? desc(parties.id) : asc(parties.id);

      const listQuery = ctx.db.select({
          id: parties.id,
          businessId: parties.businessId,
          name: parties.name,
          type: parties.type,
          phone: parties.phone,
          email: parties.email,
          gstin: parties.gstin,
          pan: parties.pan,
          tan: parties.tan,
          openingBalance: parties.openingBalance,
          billingAddress: parties.billingAddress,
          shippingAddress: parties.shippingAddress,
          city: parties.city,
          state: parties.state,
          stateCode: parties.stateCode,
          pincode: parties.pincode,
          category: parties.category,
          creditPeriodDays: parties.creditPeriodDays,
          creditLimit: parties.creditLimit,
          contactPersonName: parties.contactPersonName,
          contactPersonDob: parties.contactPersonDob,
          bankAccountNumber: parties.bankAccountNumber,
          bankIfsc: parties.bankIfsc,
          bankName: parties.bankName,
          source: parties.source,
          createdAt: parties.createdAt,
          updatedAt: parties.updatedAt,
          balance: balanceExpr,
        }).from(parties).$dynamic();

      const [data, [{ count }]] = await Promise.all([
        (sortByBalance ? listQuery.leftJoin(invoiceBalanceSq, eq(invoiceBalanceSq.partyId, parties.id)) : listQuery)
          .where(and(...conditions))
          .orderBy(sortCol, idTiebreak)
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

      // Calculate balance: CN/SR/PR and purchase-side debit notes reduce the outstanding,
      // invoices and sale-side debit notes add to it, quotations/proformas/challans are ignored.
      const [balanceResult] = await ctx.db.select({
        netBalance: sql<string>`coalesce(sum(${invoiceBalanceSql()}), 0)`,
      }).from(invoices)
        .where(and(
          eq(invoices.partyId, input.id),
          eq(invoices.businessId, ctx.businessId),
          sql`${invoices.status} NOT IN ('cancelled')`,
          isNull(invoices.deletedAt),
        ));

      return {
        ...party,
        balance: money.add(party.openingBalance, balanceResult.netBalance || "0"),
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

    logAudit(ctx.db, {
      businessId: ctx.businessId,
      userId: ctx.user.id,
      action: "party.create",
      entityType: "party",
      entityId: party.id,
      metadata: { name: party.name },
      ipAddress: ctx.ipAddress,
    });

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

      // A cross-tenant id matches no row here, so `.returning()` is empty.
      // Surface that as NOT_FOUND rather than letting the audit log below
      // dereference `party.id` on undefined (which would surface as a 500).
      if (!party) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Party not found" });
      }

      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user.id,
        action: "party.update",
        entityType: "party",
        entityId: party.id,
        metadata: { name: party.name },
        ipAddress: ctx.ipAddress,
      });

      return party;
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "delete", "Party");
      const deleted = await ctx.db.delete(parties)
        .where(and(eq(parties.id, input.id), eq(parties.businessId, ctx.businessId)))
        .returning();

      if (deleted.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Party not found" });
      }

      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user.id,
        action: "party.delete",
        entityType: "party",
        entityId: input.id,
        metadata: { partyId: input.id },
        ipAddress: ctx.ipAddress,
      });

      return { success: true };
    }),

  topItems: viewerProcedure
    .input(z.object({ partyId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Party");
      // Historical join — top items a party has ever bought. Soft-deleted
      // items must still count toward the totals (otherwise the report
      // silently drops rows when the user prunes their catalog). The
      // `innerJoin` means we still fetch the live `items.name`, but the
      // row's deletedAt state is irrelevant to the aggregation.
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

      const result = await ctx.db.transaction(async (tx) => {
        const [source] = await tx.select().from(parties)
          .where(and(eq(parties.id, input.sourceId), eq(parties.businessId, ctx.businessId))).limit(1);
        const [target] = await tx.select().from(parties)
          .where(and(eq(parties.id, input.targetId), eq(parties.businessId, ctx.businessId))).limit(1);

        if (!source || !target) throw new TRPCError({ code: "NOT_FOUND", message: "Party not found" });

        // Move all invoices from source to target, preserving original party name
        const mergeNote = `[Party merged: originally issued to "${source.name}"]`;
        await tx.update(invoices)
          .set({
            partyId: input.targetId,
            notes: sql`CASE WHEN ${invoices.notes} IS NULL OR ${invoices.notes} = '' THEN ${mergeNote} ELSE ${invoices.notes} || E'\n' || ${mergeNote} END`,
            updatedAt: new Date(),
          })
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
        ipAddress: ctx.ipAddress,
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
      limit: z.number().int().min(1).max(5000).default(1000),
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
        inArray(invoices.documentType, [...BALANCE_DOCUMENT_TYPES]),
        sql`${invoices.status} NOT IN ('cancelled')`,
        isNull(invoices.deletedAt),
      ];
      const paymentConditions = [
        eq(payments.partyId, input.partyId),
        eq(payments.businessId, ctx.businessId),
        isNull(payments.deletedAt),
      ];

      invoiceConditions.push(...buildBusinessDateFilter(invoices, { from: input.fromDate, to: input.toDate }));
      paymentConditions.push(...buildBusinessDateFilter(payments, { from: input.fromDate, to: input.toDate }));

      const [partyInvoices, partyPayments] = await Promise.all([
        ctx.db.select({
          id: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          documentType: invoices.documentType,
          date: invoices.invoiceDate,
          type: invoices.type,
          totalAmount: invoices.totalAmount,
          status: invoices.status,
        }).from(invoices).where(and(...invoiceConditions)).orderBy(invoices.invoiceDate).limit(input.limit),
        ctx.db.select({
          id: payments.id,
          paymentNumber: payments.paymentNumber,
          date: payments.paymentDate,
          amount: payments.amount,
          mode: payments.mode,
          tdsAmount: paymentTdsSql(),
        }).from(payments).where(and(...paymentConditions)).orderBy(payments.paymentDate).limit(input.limit),
      ]);

      // Build ledger entries interleaved by date.
      // CN/SR/PR reverse the normal debit/credit direction.
      const DOC_LABELS: Record<string, string> = {
        invoice: "", credit_note: "Credit Note", sales_return: "Sales Return",
        purchase_return: "Purchase Return", debit_note: "Debit Note",
      };

      const entries = [
        ...partyInvoices.map(inv => {
          const label = DOC_LABELS[inv.documentType] || (inv.type === "sale" ? "Sale Invoice" : "Purchase Invoice");
          // Sale invoice / sale debit note = debit; credit note / sales return = credit (reversal).
          // Mirror for purchase: invoice = credit; purchase return / purchase debit note = debit.
          const debit = documentLedgerSide(inv.documentType, inv.type) === "debit" ? inv.totalAmount : "0";
          const credit = debit === "0" ? inv.totalAmount : "0";
          return {
            date: inv.date,
            type: inv.documentType as string,
            number: inv.invoiceNumber,
            description: label,
            debit,
            credit,
            tdsAmount: "0.00",
            status: inv.status,
            documentId: inv.id,
          };
        }),
        // A receipt settles cash + TDS withheld; `tdsAmount` exposes the TDS part.
        ...partyPayments.map(pmt => {
          const leg = paymentLedgerLeg(party.type, pmt);
          return {
            date: pmt.date,
            type: "payment" as const,
            number: pmt.paymentNumber || "",
            description: leg.description,
            debit: leg.debit,
            credit: leg.credit,
            tdsAmount: leg.tds,
            status: null as string | null,
            documentId: pmt.id,
          };
        }),
      ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      // Compute running balance and summary using the money module. The statement is
      // debit-minus-credit, so a supplier's opening balance (what we owe them) starts NEGATIVE,
      // on the same side their purchase invoices post to.
      const openingBalance = signedOpeningBalance(party.type, party.openingBalance);
      let runningBalance = openingBalance;
      const entriesWithBalance = entries.map(e => {
        runningBalance = money.add(money.sub(runningBalance, e.credit), e.debit);
        return { ...e, runningBalance };
      });

      const totalDebit = money.sum(entries.map(e => e.debit));
      const totalCredit = money.sum(entries.map(e => e.credit));
      const closingBalance = money.add(money.sub(openingBalance, totalCredit), totalDebit);

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
      limit: z.number().int().min(1).max(5000).default(1000),
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
        inArray(invoices.documentType, [...BALANCE_DOCUMENT_TYPES]),
        sql`${invoices.status} NOT IN ('cancelled')`,
        isNull(invoices.deletedAt),
      ];
      const paymentConditions = [
        eq(payments.partyId, input.partyId),
        eq(payments.businessId, ctx.businessId),
        isNull(payments.deletedAt),
      ];

      invoiceConditions.push(...buildBusinessDateFilter(invoices, { from: input.fromDate, to: input.toDate }));
      paymentConditions.push(...buildBusinessDateFilter(payments, { from: input.fromDate, to: input.toDate }));

      const [partyInvoices, partyPayments] = await Promise.all([
        ctx.db.select({
          id: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          documentType: invoices.documentType,
          date: invoices.invoiceDate,
          type: invoices.type,
          totalAmount: invoices.totalAmount,
          status: invoices.status,
        }).from(invoices).where(and(...invoiceConditions)).orderBy(invoices.invoiceDate).limit(input.limit),
        ctx.db.select({
          id: payments.id,
          paymentNumber: payments.paymentNumber,
          date: payments.paymentDate,
          amount: payments.amount,
          mode: payments.mode,
          tdsAmount: paymentTdsSql(),
        }).from(payments).where(and(...paymentConditions)).orderBy(payments.paymentDate).limit(input.limit),
      ]);

      const DOC_LABELS: Record<string, string> = {
        invoice: "", credit_note: "Credit Note", sales_return: "Sales Return",
        purchase_return: "Purchase Return", debit_note: "Debit Note",
      };

      const entries = [
        ...partyInvoices.map(inv => {
          const label = DOC_LABELS[inv.documentType] || (inv.type === "sale" ? "Sale Invoice" : "Purchase Invoice");
          const debit = documentLedgerSide(inv.documentType, inv.type) === "debit" ? inv.totalAmount : "0";
          const credit = debit === "0" ? inv.totalAmount : "0";
          return { date: inv.date, number: inv.invoiceNumber, description: label, debit, credit };
        }),
        ...partyPayments.map(pmt => {
          const leg = paymentLedgerLeg(party.type, pmt);
          return {
            date: pmt.date,
            number: pmt.paymentNumber || "",
            description: leg.description,
            debit: leg.debit,
            credit: leg.credit,
          };
        }),
      ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      function fmtDate(d: Date): string {
        const dd = String(d.getDate()).padStart(2, "0");
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const yyyy = d.getFullYear();
        return `${dd}/${mm}/${yyyy}`;
      }
      let runningBalance = signedOpeningBalance(party.type, party.openingBalance);
      const rows: string[] = [];

      // Opening balance row
      rows.push(csvRow([
        fmtDate(new Date(input.fromDate || new Date(0).toISOString())),
        "Opening Balance",
        "",
        "",
        "",
        runningBalance,
      ]));

      for (const e of entries) {
        runningBalance = money.add(money.sub(runningBalance, e.credit), e.debit);
        rows.push(csvRow([
          fmtDate(new Date(e.date)),
          e.description,
          e.number,
          e.debit,
          e.credit,
          runningBalance,
        ]));
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
   * tallyExport — generates a CSV of all vouchers (sales invoices, purchase
   * invoices, payments, expenses) for the period.
   *
   * @deprecated Since 0.10.1. Tally does not import this CSV; it imports XML.
   * Use `reports.tallyExport`, which returns Tally Prime XML (ledger masters plus
   * every invoice, payment, expense and journal entry, with no row limit). This
   * procedure is kept unchanged so existing callers keep working; each process
   * logs a rate-limited WARN while it is still being called. Nothing in this
   * repository calls it any more (the web Reports > Tally Export tab moved to
   * `reports.tallyExport`).
   */
  tallyExport: viewerProcedure
    .input(z.object({
      fromDate: z.string().datetime().optional(),
      toDate: z.string().datetime().optional(),
      limit: z.number().int().min(1).max(5000).default(1000),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");
      warnTallyCsvExportDeprecated();

      function formatTallyDate(d: Date): string {
        const dd = String(d.getDate()).padStart(2, "0");
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const yyyy = d.getFullYear();
        return `${dd}-${mm}-${yyyy}`;
      }

      const invoiceConditions = [eq(invoices.businessId, ctx.businessId), eq(invoices.documentType, "invoice")];
      const paymentConditions = [eq(payments.businessId, ctx.businessId)];
      const expenseConditions = [eq(expenses.businessId, ctx.businessId)];

      invoiceConditions.push(...buildBusinessDateFilter(invoices, { from: input.fromDate, to: input.toDate }));
      paymentConditions.push(...buildBusinessDateFilter(payments, { from: input.fromDate, to: input.toDate }));
      expenseConditions.push(...buildBusinessDateFilter(expenses, { from: input.fromDate, to: input.toDate }));

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
          .orderBy(invoices.invoiceDate)
          .limit(input.limit),

        ctx.db.select({
          paymentDate: payments.paymentDate,
          paymentNumber: payments.paymentNumber,
          amount: payments.amount,
          mode: payments.mode,
          partyName: parties.name,
          partyType: parties.type,
          tdsAmount: paymentTdsSql(),
        }).from(payments)
          .innerJoin(parties, eq(parties.id, payments.partyId))
          .where(and(...paymentConditions))
          .orderBy(payments.paymentDate)
          .limit(input.limit),

        ctx.db.select({
          expenseDate: expenses.expenseDate,
          category: expenses.category,
          description: expenses.description,
          amount: expenses.amount,
          mode: expenses.mode,
        }).from(expenses)
          .where(and(...expenseConditions))
          .orderBy(expenses.expenseDate)
          .limit(input.limit),
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
        // TDS the customer withheld is a second leg of the same receipt voucher:
        // Dr TDS Receivable / Cr party. Without it the party ledger in Tally would
        // keep the withheld tax as outstanding (cash alone does not clear the invoice).
        const settlement = paymentSettlement(pmt.amount, pmt.tdsAmount);
        if (isSalePayment && settlement.hasTds) {
          vouchers.push({
            date: formatTallyDate(new Date(pmt.paymentDate)),
            vchType: "Receipt",
            vchNo: pmt.paymentNumber || "",
            debitLedger: "TDS Receivable",
            creditLedger: pmt.partyName,
            amount: settlement.tds,
            sortKey: new Date(pmt.paymentDate).getTime(),
          });
        }
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

      const header = "Date,Vch Type,Vch No.,Debit Ledger,Credit Ledger,Amount";
      const rows = vouchers.map(v =>
        csvRow([v.date, v.vchType, v.vchNo, v.debitLedger, v.creditLedger, v.amount])
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
        .select({ id: parties.id, type: parties.type, openingBalance: parties.openingBalance })
        .from(parties)
        .where(and(eq(parties.id, input.partyId), eq(parties.businessId, ctx.businessId)))
        .limit(1);

      if (!party) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Party not found" });
      }

      const offset = (input.page - 1) * input.limit;
      const paymentDebit = party.type === "supplier" ? paymentSettledSql() : sql`0::numeric`;
      const paymentCredit = party.type === "supplier" ? sql`0::numeric` : paymentSettledSql();

      // Debit-minus-credit running balance: a supplier's opening balance (what we owe) starts negative.
      const openingBalanceNum = money.toNumber(signedOpeningBalance(party.type, party.openingBalance));

      // Build date filter conditions inline
      const fromDate = input.fromDate ? new Date(input.fromDate) : null;
      const toDate = input.toDate ? new Date(input.toDate) : null;

      // UNION ALL: posting documents + payments
      const ledgerRows = await ctx.db.execute(sql`
        WITH ledger AS (
          -- Every posting document (invoice, credit note, sales return, purchase return, debit
          -- note). Which side it lands on follows lib/party-balance.ts (classifyLedgerDocument):
          -- sale invoice and sale debit note = debit; purchase invoice = credit; credit note /
          -- sales return = credit; purchase return, purchase-side debit note and a credit note /
          -- sales return raised from a purchase invoice (type = 'purchase') = debit.
          SELECT
            invoice_date AS entry_date,
            CASE WHEN document_type = 'invoice' AND type = 'purchase' THEN 'purchase'
                 ELSE document_type::text END AS entry_type,
            invoice_number AS document_number,
            id AS document_id,
            CASE WHEN ${invoiceIsLedgerDebitSql()} THEN total_amount::numeric ELSE 0::numeric END AS debit,
            CASE WHEN ${invoiceIsLedgerDebitSql()} THEN 0::numeric ELSE total_amount::numeric END AS credit,
            status
          FROM invoices
          WHERE party_id = ${input.partyId}
            AND business_id = ${ctx.businessId}
            AND document_type IN ('invoice', 'credit_note', 'sales_return', 'purchase_return', 'debit_note')
            AND status NOT IN ('cancelled')
            AND deleted_at IS NULL

          UNION ALL

          -- Payments received from a customer: credit the SETTLED amount (net cash + TDS
          -- withheld), otherwise TDS stays "outstanding". Payments made to a supplier: debit.
          SELECT
            payment_date AS entry_date,
            'payment'::text AS entry_type,
            coalesce(payment_number, id::text) AS document_number,
            id AS document_id,
            ${paymentDebit} AS debit,
            ${paymentCredit} AS credit,
            NULL AS status
          FROM payments
          WHERE party_id = ${input.partyId}
            AND business_id = ${ctx.businessId}
            AND deleted_at IS NULL
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
