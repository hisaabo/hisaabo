import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { journalEntries, journalEntryLines, chartOfAccounts, journalEntryTemplates } from "@hisaabo/db";
import { escapeLike } from "../lib/escape-like.js";
import {
  createJournalEntrySchema,
  updateJournalEntrySchema,
  voidJournalEntrySchema,
  createJournalEntryTemplateSchema,
} from "@hisaabo/shared";
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

      // Return entries with line count and total amount via subqueries
      const entries = await ctx.db
        .select({
          id: journalEntries.id,
          businessId: journalEntries.businessId,
          entryNumber: journalEntries.entryNumber,
          entryDate: journalEntries.entryDate,
          narration: journalEntries.narration,
          source: journalEntries.source,
          isVoided: journalEntries.isVoided,
          voidedByEntryId: journalEntries.voidedByEntryId,
          createdByUserId: journalEntries.createdByUserId,
          createdByName: journalEntries.createdByName,
          createdAt: journalEntries.createdAt,
          updatedAt: journalEntries.updatedAt,
          lineCount: sql<number>`(
            SELECT COUNT(*) FROM journal_entry_lines
            WHERE journal_entry_id = ${journalEntries.id}
          )`,
          totalAmount: sql<string>`(
            SELECT COALESCE(SUM(debit::numeric), 0)::text FROM journal_entry_lines
            WHERE journal_entry_id = ${journalEntries.id}
          )`,
        })
        .from(journalEntries)
        .where(and(...conditions))
        .orderBy(desc(journalEntries.entryDate));

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

  update: adminProcedure
    .input(updateJournalEntrySchema)
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Account");

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

      if (existing.source !== "manual") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only manually created journal entries can be updated",
        });
      }

      if (existing.isVoided) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot update a voided journal entry",
        });
      }

      // If lines are provided, verify all account IDs belong to this business
      if (input.lines) {
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
      }

      const updated = await ctx.db.transaction(async (tx) => {
        // Update lines if provided: delete old, insert new
        if (input.lines) {
          await tx
            .delete(journalEntryLines)
            .where(eq(journalEntryLines.journalEntryId, input.id));

          await tx.insert(journalEntryLines).values(
            input.lines.map(line => ({
              journalEntryId: input.id,
              accountId: line.accountId,
              debit: line.debit,
              credit: line.credit,
              narration: line.narration ?? null,
            })),
          );
        }

        // Build update payload
        const updates: Record<string, unknown> = {
          updatedAt: new Date(),
        };
        if (input.entryDate !== undefined) {
          updates.entryDate = new Date(input.entryDate);
        }
        if (input.narration !== undefined) {
          updates.narration = input.narration;
        }

        const [result] = await tx
          .update(journalEntries)
          .set(updates)
          .where(
            and(
              eq(journalEntries.id, input.id),
              eq(journalEntries.businessId, ctx.businessId),
            ),
          )
          .returning();

        return result;
      });

      return updated;
    }),

  void: adminProcedure
    .input(voidJournalEntrySchema)
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Account");

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

      if (existing.isVoided) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Journal entry is already voided",
        });
      }

      // Fetch original lines
      const originalLines = await ctx.db
        .select({
          accountId: journalEntryLines.accountId,
          debit: journalEntryLines.debit,
          credit: journalEntryLines.credit,
          narration: journalEntryLines.narration,
        })
        .from(journalEntryLines)
        .where(eq(journalEntryLines.journalEntryId, input.id));

      const result = await ctx.db.transaction(async (tx) => {
        // Generate entry number for the reversing entry
        const [maxEntry] = await tx
          .select({
            count: sql<number>`COALESCE(MAX(CAST(SUBSTRING(entry_number FROM '[0-9]+$') AS INTEGER)), 0)`,
          })
          .from(journalEntries)
          .where(eq(journalEntries.businessId, ctx.businessId));

        const nextNum = (maxEntry?.count ?? 0) + 1;
        const entryNumber = `JE-${String(nextNum).padStart(5, "0")}`;

        // Create the reversing entry with debits and credits swapped
        const [reversingEntry] = await tx
          .insert(journalEntries)
          .values({
            businessId: ctx.businessId,
            entryNumber,
            entryDate: existing.entryDate,
            narration: `Void: reversal of ${existing.entryNumber}`,
            source: "manual",
            reversesEntryId: existing.id,
            createdByUserId: ctx.user.id,
            createdByName: ctx.user.name ?? null,
          })
          .returning();

        if (!reversingEntry) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create reversing entry" });
        }

        // Insert reversed lines (debit <-> credit swapped)
        await tx.insert(journalEntryLines).values(
          originalLines.map(line => ({
            journalEntryId: reversingEntry.id,
            accountId: line.accountId,
            debit: line.credit,   // swap: original credit becomes debit
            credit: line.debit,   // swap: original debit becomes credit
            narration: line.narration,
          })),
        );

        // Mark original as voided
        await tx
          .update(journalEntries)
          .set({
            isVoided: true,
            voidedByEntryId: reversingEntry.id,
            updatedAt: new Date(),
          })
          .where(eq(journalEntries.id, existing.id));

        return { voidedEntry: existing, reversingEntry };
      });

      return result;
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

  // ── Template endpoints ──────────────────────────────────────

  templateList: viewerProcedure
    .input(z.object({
      search: z.string().max(200).optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Account");

      const conditions = [eq(journalEntryTemplates.businessId, ctx.businessId)];

      if (input?.search) {
        conditions.push(
          sql`${journalEntryTemplates.name} ILIKE ${`%${escapeLike(input.search)}%`}`,
        );
      }

      const templates = await ctx.db
        .select()
        .from(journalEntryTemplates)
        .where(and(...conditions))
        .orderBy(journalEntryTemplates.name);

      return templates;
    }),

  templateCreate: adminProcedure
    .input(createJournalEntryTemplateSchema)
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

      const [template] = await ctx.db
        .insert(journalEntryTemplates)
        .values({
          businessId: ctx.businessId,
          name: input.name,
          narration: input.narration ?? null,
          lines: input.lines,
          createdByUserId: ctx.user.id,
        })
        .returning();

      return template;
    }),

  templateDelete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "delete", "Account");

      const [existing] = await ctx.db
        .select({ id: journalEntryTemplates.id })
        .from(journalEntryTemplates)
        .where(
          and(
            eq(journalEntryTemplates.id, input.id),
            eq(journalEntryTemplates.businessId, ctx.businessId),
          ),
        )
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Journal entry template not found" });
      }

      await ctx.db
        .delete(journalEntryTemplates)
        .where(
          and(
            eq(journalEntryTemplates.id, input.id),
            eq(journalEntryTemplates.businessId, ctx.businessId),
          ),
        );

      return { success: true };
    }),

  createFromTemplate: adminProcedure
    .input(z.object({
      templateId: z.string().uuid(),
      entryDate: z.string().datetime(),
      narration: z.string().max(2000).optional(),
      lines: z.array(z.object({
        accountId: z.string().uuid(),
        debit: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).default("0"),
        credit: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).default("0"),
        narration: z.string().max(500).optional(),
      })).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "create", "Account");

      // Fetch template
      const [template] = await ctx.db
        .select()
        .from(journalEntryTemplates)
        .where(
          and(
            eq(journalEntryTemplates.id, input.templateId),
            eq(journalEntryTemplates.businessId, ctx.businessId),
          ),
        )
        .limit(1);

      if (!template) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Journal entry template not found" });
      }

      // Determine the lines to use: overridden or from template
      const linesToUse = input.lines ?? template.lines.map(l => ({
        accountId: l.accountId,
        debit: l.debit,
        credit: l.credit,
        narration: l.narration ?? null,
      }));

      // Validate balance
      const totalDebit = linesToUse.reduce((s, l) => s + parseFloat(l.debit), 0);
      const totalCredit = linesToUse.reduce((s, l) => s + parseFloat(l.credit), 0);
      if (Math.abs(totalDebit - totalCredit) >= 0.01) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Journal entry must be balanced (total debits = total credits)",
        });
      }

      // Verify all account IDs belong to this business
      const accountIds = linesToUse.map(l => l.accountId);
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
            narration: input.narration ?? template.narration ?? null,
            source: "manual",
            createdByUserId: ctx.user.id,
            createdByName: ctx.user.name ?? null,
          })
          .returning();

        if (!inserted) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create journal entry" });
        }

        await tx.insert(journalEntryLines).values(
          linesToUse.map(line => ({
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
});
