import { eq, and, ilike, sql, desc, asc } from "drizzle-orm";
import { z } from "zod";
import { parties, invoices, payments, items, invoiceItems } from "@hisaabo/db";
import { createPartySchema, updatePartySchema, paginationSchema } from "@hisaabo/shared";
import { router, businessProcedure } from "../trpc.js";
import { TRPCError } from "@trpc/server";


export const partyRouter = router({
  list: businessProcedure
    .input(z.object({
      type: z.enum(["customer", "supplier"]).nullish(),
      search: z.string().nullish(),
      category: z.string().nullish(),
      sortBy: z.enum(["name", "balance"]).nullish(),
      sortDir: z.enum(["asc", "desc"]).nullish(),
      ...paginationSchema.shape,
    }))
    .query(async ({ input, ctx }) => {
      const conditions = [eq(parties.businessId, ctx.businessId)];
      if (input.type) conditions.push(eq(parties.type, input.type));
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

  getById: businessProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
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
        balance: (
          parseFloat(party.openingBalance) +
          parseFloat(balanceResult.totalInvoiced) -
          parseFloat(balanceResult.totalPaid)
        ).toFixed(2),
      };
    }),

  create: businessProcedure.input(createPartySchema).mutation(async ({ input, ctx }) => {
    const [party] = await ctx.db.insert(parties).values({
      ...input,
      businessId: ctx.businessId,
      // Handle optional date fields
      contactPersonDob: input.contactPersonDob ? new Date(input.contactPersonDob) : null,
    }).returning();
    return party;
  }),

  update: businessProcedure
    .input(z.object({ id: z.string().uuid(), data: updatePartySchema }))
    .mutation(async ({ input, ctx }) => {
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

  delete: businessProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.db.delete(parties)
        .where(and(eq(parties.id, input.id), eq(parties.businessId, ctx.businessId)));
      return { success: true };
    }),

  topItems: businessProcedure
    .input(z.object({ partyId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
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

  merge: businessProcedure
    .input(z.object({
      sourceId: z.string().uuid(),
      targetId: z.string().uuid(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.sourceId === input.targetId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot merge a party into itself" });
      }

      return ctx.db.transaction(async (tx) => {
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
        const mergedBalance = (parseFloat(source.openingBalance || "0") + parseFloat(target.openingBalance || "0")).toFixed(2);

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

        return { success: true, mergedInto: input.targetId };
      });
    }),

  /**
   * Party ledger — chronological UNION ALL of invoices and payments for a party.
   * Each row: date, type, documentNumber, amount, runningBalance.
   */
  ledger: businessProcedure
    .input(z.object({
      partyId: z.string().uuid(),
      fromDate: z.string().datetime().optional(),
      toDate: z.string().datetime().optional(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(50),
    }))
    .query(async ({ input, ctx }) => {
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

      const openingBalanceNum = parseFloat(party.openingBalance);

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
