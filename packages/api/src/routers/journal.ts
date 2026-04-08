import { eq, and, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { journalEntries, journalEntryLines, chartOfAccounts } from "@hisaabo/db";
import { createJournalEntrySchema } from "@hisaabo/shared";
import { router, viewerProcedure, adminProcedure } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";

export const journalRouter = router({
  list: viewerProcedure
    .input(z.object({
      fromDate: z.string().datetime().optional(),
      toDate: z.string().datetime().optional(),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");

      const conditions = [eq(journalEntries.businessId, ctx.businessId)];

      if (input.fromDate) {
        conditions.push(gte(journalEntries.entryDate, new Date(input.fromDate)));
      }
      if (input.toDate) {
        conditions.push(lte(journalEntries.entryDate, new Date(input.toDate)));
      }

      // Return entries with line count via a subquery
      const entries = await ctx.db
        .select({
          id: journalEntries.id,
          businessId: journalEntries.businessId,
          entryNumber: journalEntries.entryNumber,
          entryDate: journalEntries.entryDate,
          narration: journalEntries.narration,
          source: journalEntries.source,
          createdByUserId: journalEntries.createdByUserId,
          createdByName: journalEntries.createdByName,
          createdAt: journalEntries.createdAt,
          updatedAt: journalEntries.updatedAt,
          lineCount: sql<number>`(
            SELECT COUNT(*) FROM journal_entry_lines
            WHERE journal_entry_id = ${journalEntries.id}
          )`,
        })
        .from(journalEntries)
        .where(and(...conditions))
        .orderBy(journalEntries.entryDate);

      return entries;
    }),

  getById: viewerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");

      const [entry] = await ctx.db
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.id, input.id),
            eq(journalEntries.businessId, ctx.businessId),
          ),
        )
        .limit(1);

      if (!entry) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Journal entry not found" });
      }

      // Fetch lines joined with account name
      const lines = await ctx.db
        .select({
          id: journalEntryLines.id,
          journalEntryId: journalEntryLines.journalEntryId,
          accountId: journalEntryLines.accountId,
          accountCode: chartOfAccounts.code,
          accountName: chartOfAccounts.name,
          debit: journalEntryLines.debit,
          credit: journalEntryLines.credit,
          narration: journalEntryLines.narration,
        })
        .from(journalEntryLines)
        .innerJoin(chartOfAccounts, eq(journalEntryLines.accountId, chartOfAccounts.id))
        .where(eq(journalEntryLines.journalEntryId, entry.id));

      return { ...entry, lines };
    }),

  create: adminProcedure
    .input(createJournalEntrySchema)
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "create", "Account");

      // Verify all account IDs belong to this business
      const accountIds = input.lines.map(l => l.accountId);
      const foundAccounts = await ctx.db
        .select({ id: chartOfAccounts.id })
        .from(chartOfAccounts)
        .where(eq(chartOfAccounts.businessId, ctx.businessId));

      const ownedAccountIds = new Set(foundAccounts.map(a => a.id));
      for (const accountId of accountIds) {
        if (!ownedAccountIds.has(accountId)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Account ${accountId} not found in this business`,
          });
        }
      }

      const entry = await ctx.db.transaction(async (tx) => {
        // Generate entry number atomically inside transaction
        const [maxEntry] = await tx
          .select({
            count: sql<number>`COALESCE(MAX(CAST(SUBSTRING(entry_number FROM '[0-9]+$') AS INTEGER)), 0)`,
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
            entryDate: new Date(input.entryDate),
            narration: input.narration ?? null,
            source: "manual",
            createdByUserId: ctx.user.id,
            createdByName: ctx.user.name ?? null,
          })
          .returning();

        if (!inserted) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create journal entry" });
        }

        await tx.insert(journalEntryLines).values(
          input.lines.map(line => ({
            journalEntryId: inserted.id,
            accountId: line.accountId,
            debit: line.debit,
            credit: line.credit,
            narration: line.narration ?? null,
          })),
        );

        return inserted;
      });

      return entry;
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "delete", "Account");

      const [existing] = await ctx.db
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.id, input.id),
            eq(journalEntries.businessId, ctx.businessId),
          ),
        )
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Journal entry not found" });
      }

      // Lines are cascade-deleted by FK constraint
      await ctx.db
        .delete(journalEntries)
        .where(
          and(
            eq(journalEntries.id, input.id),
            eq(journalEntries.businessId, ctx.businessId),
          ),
        );

      return { success: true };
    }),
});
