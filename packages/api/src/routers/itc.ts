import { eq, and, sql, desc, isNull } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  itcLedgerEntries,
  itcUtilizations,
  invoices,
  parties,
  chartOfAccounts,
  journalEntries,
  journalEntryLines,
} from "@hisaabo/db";
import {
  markItcBlockedSchema,
  markItcEligibleSchema,
  recordItcUtilizationSchema,
  money,
} from "@hisaabo/shared";
import { router, viewerProcedure, adminProcedure } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";

// ── Helpers ──────────────────────────────────────────────────

function currentReturnPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const ZERO = "0.00";

// ── Router ───────────────────────────────────────────────────

export const itcRouter = router({
  /**
   * Dashboard summary: available, utilized, reversed, blocked ITC totals
   * for a given return period (defaults to current month).
   */
  dashboard: viewerProcedure
    .input(
      z
        .object({
          returnPeriod: z
            .string()
            .regex(/^\d{4}-\d{2}$/)
            .optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "ITC");

      const period = input?.returnPeriod ?? currentReturnPeriod();

      // Sum ITC by status for the period
      const rows = await ctx.db
        .select({
          status: itcLedgerEntries.status,
          totalCgst: sql<string>`COALESCE(SUM(${itcLedgerEntries.cgst}::numeric), 0)::text`,
          totalSgst: sql<string>`COALESCE(SUM(${itcLedgerEntries.sgst}::numeric), 0)::text`,
          totalIgst: sql<string>`COALESCE(SUM(${itcLedgerEntries.igst}::numeric), 0)::text`,
          totalCess: sql<string>`COALESCE(SUM(${itcLedgerEntries.cess}::numeric), 0)::text`,
        })
        .from(itcLedgerEntries)
        .where(
          and(
            eq(itcLedgerEntries.businessId, ctx.businessId),
            eq(itcLedgerEntries.returnPeriod, period),
          ),
        )
        .groupBy(itcLedgerEntries.status);

      const summary: Record<
        string,
        { cgst: string; sgst: string; igst: string; cess: string; total: string }
      > = {};

      for (const status of ["available", "utilized", "reversed", "reclaimed", "blocked"] as const) {
        const row = rows.find((r) => r.status === status);
        const cgst = row?.totalCgst ?? ZERO;
        const sgst = row?.totalSgst ?? ZERO;
        const igst = row?.totalIgst ?? ZERO;
        const cess = row?.totalCess ?? ZERO;
        summary[status] = {
          cgst,
          sgst,
          igst,
          cess,
          total: money.sum([cgst, sgst, igst, cess]),
        };
      }

      // Current period utilization record (if any)
      const [utilization] = await ctx.db
        .select()
        .from(itcUtilizations)
        .where(
          and(
            eq(itcUtilizations.businessId, ctx.businessId),
            eq(itcUtilizations.returnPeriod, period),
          ),
        )
        .limit(1);

      return {
        returnPeriod: period,
        summary,
        utilization: utilization ?? null,
      };
    }),

  /**
   * Paginated ledger of ITC entries with invoice and party context.
   */
  ledger: viewerProcedure
    .input(
      z.object({
        returnPeriod: z
          .string()
          .regex(/^\d{4}-\d{2}$/)
          .optional(),
        status: z
          .enum(["available", "utilized", "reversed", "reclaimed", "blocked"])
          .optional(),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "ITC");

      const conditions = [eq(itcLedgerEntries.businessId, ctx.businessId)];

      if (input.returnPeriod) {
        conditions.push(eq(itcLedgerEntries.returnPeriod, input.returnPeriod));
      }
      if (input.status) {
        conditions.push(eq(itcLedgerEntries.status, input.status));
      }

      const offset = (input.page - 1) * input.limit;

      // Count total matching entries
      const [countResult] = await ctx.db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(itcLedgerEntries)
        .where(and(...conditions));

      const total = countResult?.count ?? 0;

      // Fetch entries joined with invoice and party details
      const entries = await ctx.db
        .select({
          id: itcLedgerEntries.id,
          businessId: itcLedgerEntries.businessId,
          invoiceId: itcLedgerEntries.invoiceId,
          returnPeriod: itcLedgerEntries.returnPeriod,
          status: itcLedgerEntries.status,
          cgst: itcLedgerEntries.cgst,
          sgst: itcLedgerEntries.sgst,
          igst: itcLedgerEntries.igst,
          cess: itcLedgerEntries.cess,
          isReverseCharge: itcLedgerEntries.isReverseCharge,
          blockReason: itcLedgerEntries.blockReason,
          reversalReason: itcLedgerEntries.reversalReason,
          notes: itcLedgerEntries.notes,
          createdAt: itcLedgerEntries.createdAt,
          updatedAt: itcLedgerEntries.updatedAt,
          invoiceNumber: invoices.invoiceNumber,
          invoiceDate: invoices.invoiceDate,
          partyName: parties.name,
        })
        .from(itcLedgerEntries)
        .leftJoin(invoices, eq(itcLedgerEntries.invoiceId, invoices.id))
        .leftJoin(parties, eq(invoices.partyId, parties.id))
        .where(and(...conditions))
        .orderBy(desc(itcLedgerEntries.createdAt))
        .limit(input.limit)
        .offset(offset);

      return {
        entries,
        pagination: {
          page: input.page,
          limit: input.limit,
          total,
          totalPages: Math.ceil(total / input.limit),
        },
      };
    }),

  /**
   * Block ITC for an invoice (Section 17(5) or other reason).
   */
  markBlocked: adminProcedure
    .input(markItcBlockedSchema)
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "ITC");

      const [entry] = await ctx.db
        .select()
        .from(itcLedgerEntries)
        .where(
          and(
            eq(itcLedgerEntries.businessId, ctx.businessId),
            eq(itcLedgerEntries.invoiceId, input.invoiceId),
            eq(itcLedgerEntries.status, "available"),
          ),
        )
        .limit(1);

      if (!entry) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No available ITC entry found for this invoice",
        });
      }

      const [updated] = await ctx.db
        .update(itcLedgerEntries)
        .set({
          status: "blocked",
          blockReason: input.blockReason,
          notes: input.notes ?? null,
          updatedAt: new Date(),
        })
        .where(eq(itcLedgerEntries.id, entry.id))
        .returning();

      return updated;
    }),

  /**
   * Unblock ITC: move a blocked entry back to available.
   */
  markEligible: adminProcedure
    .input(markItcEligibleSchema)
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "ITC");

      const [entry] = await ctx.db
        .select()
        .from(itcLedgerEntries)
        .where(
          and(
            eq(itcLedgerEntries.businessId, ctx.businessId),
            eq(itcLedgerEntries.invoiceId, input.invoiceId),
            eq(itcLedgerEntries.status, "blocked"),
          ),
        )
        .limit(1);

      if (!entry) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No blocked ITC entry found for this invoice",
        });
      }

      const [updated] = await ctx.db
        .update(itcLedgerEntries)
        .set({
          status: "available",
          blockReason: null,
          updatedAt: new Date(),
        })
        .where(eq(itcLedgerEntries.id, entry.id))
        .returning();

      return updated;
    }),

  /**
   * Aging alerts: purchase invoices with available ITC approaching or past
   * the 180-day payment deadline (Section 16(2) proviso).
   */
  agingAlerts: viewerProcedure.query(async ({ ctx }) => {
    requireCan(ctx.ability, "read", "ITC");

    // Find available ITC entries where the linked invoice is older than 150 days
    // and has outstanding balance (not fully paid).
    const alerts = await ctx.db
      .select({
        itcEntryId: itcLedgerEntries.id,
        invoiceId: itcLedgerEntries.invoiceId,
        invoiceNumber: invoices.invoiceNumber,
        partyName: parties.name,
        invoiceDate: invoices.invoiceDate,
        daysOutstanding: sql<number>`EXTRACT(DAY FROM NOW() - ${invoices.invoiceDate})::int`,
        cgst: itcLedgerEntries.cgst,
        sgst: itcLedgerEntries.sgst,
        igst: itcLedgerEntries.igst,
        cess: itcLedgerEntries.cess,
        invoiceTotal: invoices.totalAmount,
        amountPaid: invoices.amountPaid,
      })
      .from(itcLedgerEntries)
      .innerJoin(invoices, eq(itcLedgerEntries.invoiceId, invoices.id))
      .innerJoin(parties, eq(invoices.partyId, parties.id))
      .where(
        and(
          eq(itcLedgerEntries.businessId, ctx.businessId),
          eq(itcLedgerEntries.status, "available"),
          isNull(invoices.deletedAt),
          // Invoice older than 150 days
          sql`${invoices.invoiceDate} < NOW() - INTERVAL '150 days'`,
          // Invoice not fully paid: totalAmount - amountPaid > 0
          sql`(${invoices.totalAmount}::numeric - ${invoices.amountPaid}::numeric) > 0`,
        ),
      )
      .orderBy(sql`${invoices.invoiceDate} ASC`);

    return alerts.map((row) => ({
      itcEntryId: row.itcEntryId,
      invoiceId: row.invoiceId,
      invoiceNumber: row.invoiceNumber,
      partyName: row.partyName,
      invoiceDate: row.invoiceDate,
      daysOutstanding: row.daysOutstanding,
      itcAmount: money.sum([row.cgst, row.sgst, row.igst, row.cess]),
      cgst: row.cgst,
      sgst: row.sgst,
      igst: row.igst,
      cess: row.cess,
      outstandingAmount: money.sub(row.invoiceTotal, row.amountPaid),
      urgency: row.daysOutstanding > 180 ? ("critical" as const) : ("warning" as const),
    }));
  }),

  /**
   * Record ITC utilization for a return period. Creates the utilization record
   * and a system journal entry (Dr Output GST / Cr Input GST).
   */
  recordUtilization: adminProcedure
    .input(recordItcUtilizationSchema)
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "ITC");

      // Calculate total available ITC for the period
      const [availableSums] = await ctx.db
        .select({
          totalCgst: sql<string>`COALESCE(SUM(${itcLedgerEntries.cgst}::numeric), 0)::text`,
          totalSgst: sql<string>`COALESCE(SUM(${itcLedgerEntries.sgst}::numeric), 0)::text`,
          totalIgst: sql<string>`COALESCE(SUM(${itcLedgerEntries.igst}::numeric), 0)::text`,
        })
        .from(itcLedgerEntries)
        .where(
          and(
            eq(itcLedgerEntries.businessId, ctx.businessId),
            eq(itcLedgerEntries.returnPeriod, input.returnPeriod),
            eq(itcLedgerEntries.status, "available"),
          ),
        );

      const availableCgst = availableSums?.totalCgst ?? ZERO;
      const availableSgst = availableSums?.totalSgst ?? ZERO;
      const availableIgst = availableSums?.totalIgst ?? ZERO;

      // Validate: CGST utilized cannot exceed available CGST
      if (money.compare(input.cgstUtilized, availableCgst) > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `CGST utilization (${input.cgstUtilized}) exceeds available balance (${availableCgst})`,
        });
      }

      // Validate: SGST utilized cannot exceed available SGST
      if (money.compare(input.sgstUtilized, availableSgst) > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `SGST utilization (${input.sgstUtilized}) exceeds available balance (${availableSgst})`,
        });
      }

      // Validate: total IGST utilized (against CGST + SGST + IGST) cannot exceed available IGST
      const totalIgstUtilized = money.sum([
        input.igstUtilizedAgainstCgst,
        input.igstUtilizedAgainstSgst,
        input.igstUtilizedAgainstIgst,
      ]);
      if (money.compare(totalIgstUtilized, availableIgst) > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `IGST utilization (${totalIgstUtilized}) exceeds available balance (${availableIgst})`,
        });
      }

      const result = await ctx.db.transaction(async (tx) => {
        // Upsert utilization record (unique on businessId + returnPeriod)
        const [utilization] = await tx
          .insert(itcUtilizations)
          .values({
            businessId: ctx.businessId,
            returnPeriod: input.returnPeriod,
            cgstUtilized: input.cgstUtilized,
            sgstUtilized: input.sgstUtilized,
            igstUtilizedAgainstCgst: input.igstUtilizedAgainstCgst,
            igstUtilizedAgainstSgst: input.igstUtilizedAgainstSgst,
            igstUtilizedAgainstIgst: input.igstUtilizedAgainstIgst,
            notes: input.notes ?? null,
            createdByUserId: ctx.user.id,
          })
          .onConflictDoUpdate({
            target: [itcUtilizations.businessId, itcUtilizations.returnPeriod],
            set: {
              cgstUtilized: input.cgstUtilized,
              sgstUtilized: input.sgstUtilized,
              igstUtilizedAgainstCgst: input.igstUtilizedAgainstCgst,
              igstUtilizedAgainstSgst: input.igstUtilizedAgainstSgst,
              igstUtilizedAgainstIgst: input.igstUtilizedAgainstIgst,
              notes: input.notes ?? null,
              updatedAt: new Date(),
            },
          })
          .returning();

        // Create system journal entry: Dr Output GST / Cr Input GST
        // Account codes: Output CGST=2100, Output SGST=2101, Output IGST=2102
        //                Input  CGST=1510, Input  SGST=1511, Input  IGST=1512
        const journalLines: Array<{
          accountCode: string;
          debit: string;
          credit: string;
          narration: string;
        }> = [];

        // CGST: Dr Output CGST (2100) / Cr Input CGST (1510)
        if (money.isPositive(input.cgstUtilized)) {
          journalLines.push({
            accountCode: "2100",
            debit: input.cgstUtilized,
            credit: ZERO,
            narration: "ITC CGST utilization",
          });
          journalLines.push({
            accountCode: "1510",
            debit: ZERO,
            credit: input.cgstUtilized,
            narration: "ITC CGST utilization",
          });
        }

        // SGST: Dr Output SGST (2101) / Cr Input SGST (1511)
        if (money.isPositive(input.sgstUtilized)) {
          journalLines.push({
            accountCode: "2101",
            debit: input.sgstUtilized,
            credit: ZERO,
            narration: "ITC SGST utilization",
          });
          journalLines.push({
            accountCode: "1511",
            debit: ZERO,
            credit: input.sgstUtilized,
            narration: "ITC SGST utilization",
          });
        }

        // IGST utilized against IGST: Dr Output IGST (2102) / Cr Input IGST (1512)
        if (money.isPositive(input.igstUtilizedAgainstIgst)) {
          journalLines.push({
            accountCode: "2102",
            debit: input.igstUtilizedAgainstIgst,
            credit: ZERO,
            narration: "ITC IGST utilization against IGST",
          });
          journalLines.push({
            accountCode: "1512",
            debit: ZERO,
            credit: input.igstUtilizedAgainstIgst,
            narration: "ITC IGST utilization against IGST",
          });
        }

        // IGST utilized against CGST: Dr Output CGST (2100) / Cr Input IGST (1512)
        if (money.isPositive(input.igstUtilizedAgainstCgst)) {
          journalLines.push({
            accountCode: "2100",
            debit: input.igstUtilizedAgainstCgst,
            credit: ZERO,
            narration: "ITC IGST utilization against CGST",
          });
          journalLines.push({
            accountCode: "1512",
            debit: ZERO,
            credit: input.igstUtilizedAgainstCgst,
            narration: "ITC IGST utilization against CGST",
          });
        }

        // IGST utilized against SGST: Dr Output SGST (2101) / Cr Input IGST (1512)
        if (money.isPositive(input.igstUtilizedAgainstSgst)) {
          journalLines.push({
            accountCode: "2101",
            debit: input.igstUtilizedAgainstSgst,
            credit: ZERO,
            narration: "ITC IGST utilization against SGST",
          });
          journalLines.push({
            accountCode: "1512",
            debit: ZERO,
            credit: input.igstUtilizedAgainstSgst,
            narration: "ITC IGST utilization against SGST",
          });
        }

        // Only create journal entry if there are actual utilization amounts
        let journalEntry = null;
        if (journalLines.length > 0) {
          // Resolve account codes to IDs for this business
          const accountCodes = [...new Set(journalLines.map((l) => l.accountCode))];
          const accounts = await tx
            .select({ id: chartOfAccounts.id, code: chartOfAccounts.code })
            .from(chartOfAccounts)
            .where(
              and(
                eq(chartOfAccounts.businessId, ctx.businessId),
                sql`${chartOfAccounts.code} IN (${sql.join(
                  accountCodes.map((c) => sql`${c}`),
                  sql`, `,
                )})`,
              ),
            );

          const codeToId = new Map(accounts.map((a) => [a.code, a.id]));

          // Verify all required accounts exist
          for (const code of accountCodes) {
            if (!codeToId.has(code)) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Chart of accounts entry with code ${code} not found. Ensure GST accounts are seeded for this business.`,
              });
            }
          }

          // Generate journal entry number
          const [maxEntry] = await tx
            .select({
              count:
                sql<number>`COALESCE(MAX(CAST(SUBSTRING(entry_number FROM '[0-9]+$') AS INTEGER)), 0)`,
            })
            .from(journalEntries)
            .where(eq(journalEntries.businessId, ctx.businessId));

          const nextNum = (maxEntry?.count ?? 0) + 1;
          const entryNumber = `JE-${String(nextNum).padStart(5, "0")}`;

          const [inserted] = await tx
            .insert(journalEntries)
            .values({
              businessId: ctx.businessId,
              entryNumber,
              entryDate: new Date(),
              narration: `ITC utilization for return period ${input.returnPeriod}`,
              source: "system",
              createdByUserId: ctx.user.id,
              createdByName: ctx.user.name ?? null,
            })
            .returning();

          if (!inserted) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to create journal entry for ITC utilization",
            });
          }

          await tx.insert(journalEntryLines).values(
            journalLines.map((line) => ({
              journalEntryId: inserted.id,
              accountId: codeToId.get(line.accountCode)!,
              debit: line.debit,
              credit: line.credit,
              narration: line.narration,
            })),
          );

          journalEntry = inserted;
        }

        return { utilization, journalEntry };
      });

      return result;
    }),

  /**
   * GSTR-3B Table 4 breakdown for a given month.
   * Returns the structured data matching the official GSTR-3B format.
   */
  gstr3bTable4: viewerProcedure
    .input(
      z.object({
        year: z.number().int().min(2017).max(2099),
        month: z.number().int().min(1).max(12),
      }),
    )
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "ITC");

      const period = `${input.year}-${String(input.month).padStart(2, "0")}`;

      // Helper: sum CGST/SGST/IGST/Cess for entries matching conditions
      async function sumItc(
        extraConditions: ReturnType<typeof sql>[],
      ): Promise<{ cgst: string; sgst: string; igst: string; cess: string; total: string }> {
        const baseConditions = [
          eq(itcLedgerEntries.businessId, ctx.businessId),
          eq(itcLedgerEntries.returnPeriod, period),
          ...extraConditions,
        ];

        const [row] = await ctx.db
          .select({
            cgst: sql<string>`COALESCE(SUM(${itcLedgerEntries.cgst}::numeric), 0)::text`,
            sgst: sql<string>`COALESCE(SUM(${itcLedgerEntries.sgst}::numeric), 0)::text`,
            igst: sql<string>`COALESCE(SUM(${itcLedgerEntries.igst}::numeric), 0)::text`,
            cess: sql<string>`COALESCE(SUM(${itcLedgerEntries.cess}::numeric), 0)::text`,
          })
          .from(itcLedgerEntries)
          .where(and(...baseConditions));

        const cgst = row?.cgst ?? ZERO;
        const sgst = row?.sgst ?? ZERO;
        const igst = row?.igst ?? ZERO;
        const cess = row?.cess ?? ZERO;

        return {
          cgst,
          sgst,
          igst,
          cess,
          total: money.sum([cgst, sgst, igst, cess]),
        };
      }

      // 4A1: Import of goods (not tracked yet — always 0)
      const row4A1 = { cgst: ZERO, sgst: ZERO, igst: ZERO, cess: ZERO, total: ZERO };

      // 4A2: Import of services (not tracked yet — always 0)
      const row4A2 = { cgst: ZERO, sgst: ZERO, igst: ZERO, cess: ZERO, total: ZERO };

      // 4A3: Inward supplies liable to reverse charge (available)
      const row4A3 = await sumItc([
        eq(itcLedgerEntries.isReverseCharge, true),
        eq(itcLedgerEntries.status, "available"),
      ]);

      // 4A5: All other ITC (non-RCM, available)
      const row4A5 = await sumItc([
        eq(itcLedgerEntries.isReverseCharge, false),
        eq(itcLedgerEntries.status, "available"),
      ]);

      // 4B1: ITC reversed per Rules 42 & 43
      const row4B1 = await sumItc([
        sql`${itcLedgerEntries.reversalReason} IN ('rule_42', 'rule_43')`,
      ]);

      // 4B2: ITC reversed per Section 17(5) — blocked entries
      const row4B2 = await sumItc([eq(itcLedgerEntries.status, "blocked")]);

      // 4D: Total ineligible ITC (blocked + reversed)
      const row4D_blocked = await sumItc([eq(itcLedgerEntries.status, "blocked")]);
      const row4D_reversed = await sumItc([eq(itcLedgerEntries.status, "reversed")]);

      // Compute totals for each section
      const toTaxRow = (r: typeof row4A1) => ({
        integratedTax: r.igst,
        centralTax: r.cgst,
        stateTax: r.sgst,
        cess: r.cess,
      });

      const total4A = {
        integratedTax: money.sum([row4A1.igst, row4A2.igst, row4A3.igst, row4A5.igst]),
        centralTax: money.sum([row4A1.cgst, row4A2.cgst, row4A3.cgst, row4A5.cgst]),
        stateTax: money.sum([row4A1.sgst, row4A2.sgst, row4A3.sgst, row4A5.sgst]),
        cess: money.sum([row4A1.cess, row4A2.cess, row4A3.cess, row4A5.cess]),
      };

      const total4B = {
        integratedTax: money.add(row4B1.igst, row4B2.igst),
        centralTax: money.add(row4B1.cgst, row4B2.cgst),
        stateTax: money.add(row4B1.sgst, row4B2.sgst),
        cess: money.add(row4B1.cess, row4B2.cess),
      };

      const netItc = {
        integratedTax: money.sub(total4A.integratedTax, total4B.integratedTax),
        centralTax: money.sub(total4A.centralTax, total4B.centralTax),
        stateTax: money.sub(total4A.stateTax, total4B.stateTax),
        cess: money.sub(total4A.cess, total4B.cess),
      };

      return {
        returnPeriod: period,
        itcAvailable: {
          importOfGoods: toTaxRow(row4A1),
          importOfServices: toTaxRow(row4A2),
          reverseCharge: toTaxRow(row4A3),
          allOther: toTaxRow(row4A5),
          total: total4A,
        },
        itcReversed: {
          rules42_43: toTaxRow(row4B1),
          others: toTaxRow(row4B2),
          total: total4B,
        },
        netItc,
        ineligible: {
          section17_5: toTaxRow(row4D_blocked),
          others: toTaxRow(row4D_reversed),
          total: {
            integratedTax: money.add(row4D_blocked.igst, row4D_reversed.igst),
            centralTax: money.add(row4D_blocked.cgst, row4D_reversed.cgst),
            stateTax: money.add(row4D_blocked.sgst, row4D_reversed.sgst),
            cess: money.add(row4D_blocked.cess, row4D_reversed.cess),
          },
        },
      };
    }),
});
