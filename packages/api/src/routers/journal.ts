import { eq, and, sql, desc } from "drizzle-orm";
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
import { router, viewerProcedure, adminProcedure, type TenantDatabase } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";
import { logAudit } from "../lib/audit.js";
import { buildBusinessDateFilter } from "../lib/business-date.js";

type JournalEntryRow = typeof journalEntries.$inferSelect;

type VoidOutcome =
  | { kind: "voided"; voidedEntry: JournalEntryRow; reversingEntry: JournalEntryRow }
  | { kind: "already_voided"; entry: JournalEntryRow };

interface VoidCtx {
  db: TenantDatabase;
  businessId: string;
  user: { id: string; name?: string | null };
  ipAddress?: string | null;
}

/**
 * Void a journal entry by posting a reversing entry (debits and credits
 * swapped, same date) and flagging the original as voided. Shared by `void` and
 * `delete`. Everything, including the lookup, runs in one transaction with the
 * original row locked, so two concurrent voids cannot both reverse the same
 * entry.
 *
 * An entry that is itself the reversal of another entry (it has `reversesEntryId`)
 * is refused for both procedures: reversing it would reinstate the original's
 * effect in the ledger while the original stays flagged voided. Correct a wrong
 * void by posting a new entry instead.
 */
async function voidJournalEntry(
  ctx: VoidCtx,
  id: string,
): Promise<VoidOutcome> {
  return ctx.db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.id, id),
          eq(journalEntries.businessId, ctx.businessId),
        ),
      )
      .for("update")
      .limit(1);

    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Journal entry not found" });
    }

    if (existing.reversesEntryId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          `${existing.entryNumber} is the reversal of another journal entry and is part of its audit trail; ` +
          "it cannot be voided or deleted. To correct a wrong void, post a new journal entry.",
      });
    }

    if (existing.isVoided) {
      return { kind: "already_voided" as const, entry: existing };
    }

    const originalLines = await tx
      .select({
        accountId: journalEntryLines.accountId,
        debit: journalEntryLines.debit,
        credit: journalEntryLines.credit,
        narration: journalEntryLines.narration,
      })
      .from(journalEntryLines)
      .where(eq(journalEntryLines.journalEntryId, id));

    // Generate entry number for the reversing entry
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${ctx.businessId} || ':journal_entry_number'))`);
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
    if (originalLines.length > 0) {
      await tx.insert(journalEntryLines).values(
        originalLines.map(line => ({
          journalEntryId: reversingEntry.id,
          accountId: line.accountId,
          debit: line.credit,   // swap: original credit becomes debit
          credit: line.debit,   // swap: original debit becomes credit
          narration: line.narration,
        })),
      );
    }

    // Mark original as voided
    await tx
      .update(journalEntries)
      .set({
        isVoided: true,
        voidedByEntryId: reversingEntry.id,
        updatedAt: new Date(),
      })
      .where(eq(journalEntries.id, existing.id));

    return { kind: "voided" as const, voidedEntry: existing, reversingEntry };
  });
}

/** Audit trail for a void; `via` records which procedure was called. */
async function auditVoid(
  ctx: VoidCtx,
  outcome: Extract<VoidOutcome, { kind: "voided" }>,
  via: "void" | "delete",
) {
  await logAudit(ctx.db, {
    businessId: ctx.businessId,
    userId: ctx.user.id,
    action: "journal.void",
    entityType: "journal_entry",
    entityId: outcome.voidedEntry.id,
    metadata: {
      entryNumber: outcome.voidedEntry.entryNumber,
      reversingEntryId: outcome.reversingEntry.id,
      reversingEntryNumber: outcome.reversingEntry.entryNumber,
      via,
    },
    ipAddress: ctx.ipAddress,
  });
}

export const journalRouter = router({
  list: viewerProcedure
    .input(z.object({
      fromDate: z.string().datetime().optional(),
      toDate: z.string().datetime().optional(),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");

      const conditions = [eq(journalEntries.businessId, ctx.businessId)];
      conditions.push(...buildBusinessDateFilter(journalEntries, { from: input.fromDate, to: input.toDate }));

      // Aggregate line count / debit total once per entry (grouped subquery + LEFT JOIN)
      // instead of two correlated subqueries per row.
      const lineTotals = ctx.db
        .select({
          journalEntryId: journalEntryLines.journalEntryId,
          lineCount: sql<number>`COUNT(*)`.as("line_count"),
          totalAmount: sql<string>`COALESCE(SUM(${journalEntryLines.debit}::numeric), 0)::text`.as("total_amount"),
        })
        .from(journalEntryLines)
        .innerJoin(journalEntries, eq(journalEntries.id, journalEntryLines.journalEntryId))
        .where(eq(journalEntries.businessId, ctx.businessId))
        .groupBy(journalEntryLines.journalEntryId)
        .as("line_totals");

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
          lineCount: sql<number>`COALESCE(${lineTotals.lineCount}, 0)`,
          totalAmount: sql<string>`COALESCE(${lineTotals.totalAmount}, '0')`,
        })
        .from(journalEntries)
        .leftJoin(lineTotals, eq(lineTotals.journalEntryId, journalEntries.id))
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
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${ctx.businessId} || ':journal_entry_number'))`);
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

      const scope: VoidCtx = { db: ctx.db, businessId: ctx.businessId, user: ctx.user, ipAddress: ctx.ipAddress };
      const outcome = await voidJournalEntry(scope, input.id);

      if (outcome.kind === "already_voided") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Journal entry is already voided",
        });
      }

      await auditVoid(scope, outcome, "void");

      return { voidedEntry: outcome.voidedEntry, reversingEntry: outcome.reversingEntry };
    }),

  /**
   * delete — kept for API compatibility; it no longer erases anything.
   *
   * A posted journal entry is part of the books: removing the row (and, through
   * the FK cascade, its lines) left no trace of what was posted or who removed
   * it. `delete` now does exactly what `void` does: it posts a reversing entry
   * (debits and credits swapped, same date) and flags the original as voided,
   * so both stay on record and the effect on the ledger nets to zero.
   *
   * There are no draft journal entries (an entry is posted on creation; the
   * table has no status column), so there is nothing that could be dropped
   * without a trace.
   *
   *  - not found                  -> NOT_FOUND (unchanged)
   *  - already voided             -> `{ success: true, alreadyVoided: true }`, no change
   *                                  (the entry is already out of the books, so a repeated
   *                                  call is a no-op rather than an error)
   *  - a reversal entry           -> BAD_REQUEST: reversing it would silently reinstate the
   *                                  entry it reverses (`void` refuses it too)
   *  - anything else              -> voided, `{ success: true, voided: true, ... }`
   *
   * Returns `{ success: true }` plus additive fields, so existing callers that
   * only check `success` keep working.
   */
  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "delete", "Account");

      const scope: VoidCtx = { db: ctx.db, businessId: ctx.businessId, user: ctx.user, ipAddress: ctx.ipAddress };
      const outcome = await voidJournalEntry(scope, input.id);

      if (outcome.kind === "already_voided") {
        return {
          success: true as const,
          voided: false,
          alreadyVoided: true,
          entryNumber: outcome.entry.entryNumber,
          reversingEntryId: outcome.entry.voidedByEntryId,
          reversingEntryNumber: null as string | null,
        };
      }

      await auditVoid(scope, outcome, "delete");

      return {
        success: true as const,
        voided: true,
        alreadyVoided: false,
        entryNumber: outcome.voidedEntry.entryNumber,
        reversingEntryId: outcome.reversingEntry.id as string | null,
        reversingEntryNumber: outcome.reversingEntry.entryNumber as string | null,
      };
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
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${ctx.businessId} || ':journal_entry_number'))`);
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
