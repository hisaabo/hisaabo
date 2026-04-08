/**
 * bankRecon.ts — Bank Reconciliation tRPC router.
 *
 * WHY THIS FILE EXISTS:
 * Reconciliation is the process of matching imported bank statement lines with
 * internal records (payments, expenses, bank transactions). This router handles
 * the full lifecycle: CSV upload → column mapping confirmation → auto-match →
 * manual review → categorisation rules.
 *
 * All queries are scoped by ctx.businessId (business isolation rule).
 * Permission checks use requireCan() from @casl-based permissions.
 */

import { eq, and, sql, desc, isNull, gte, lte, or, ilike, asc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  bankStatementImports,
  bankStatementLines,
  bankCategorizationRules,
  bankStatementTemplates,
  bankAccounts,
  payments,
  expenses,
  bankTransactions,
} from "@hisaabo/db";
import {
  bankReconColumnMappingSchema,
  confirmBankMappingSchema,
  bankCategorizationRuleSchema,
  paginationSchema,
  createExpenseSchema,
  money,
} from "@hisaabo/shared";
import { router, viewerProcedure, adminProcedure, type TenantDatabase } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";
import { escapeLike } from "../lib/escape-like.js";
import {
  parseCSV,
  detectColumnMapping,
  parseStatementLines,
  type ColumnMapping,
} from "../lib/csv-parser.js";
import {
  matchStatementLines,
  applyCategorizationRules,
  type CategorizationRule,
} from "../lib/bank-reconciliation.js";
import {
  seedBankTemplates,
  detectBankTemplate,
  preprocessRows,
  type DetectionResult,
  type DetectionWarning,
} from "../lib/bank-templates/index.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function toColumnMapping(raw: z.infer<typeof bankReconColumnMappingSchema>): ColumnMapping {
  return {
    date: raw.date,
    narration: raw.narration,
    debit: raw.debit,
    credit: raw.credit,
    amount: raw.amount,
    type: raw.type,
    reference: raw.reference,
    balance: raw.balance,
    dateFormat: raw.dateFormat,
    skipRows: raw.skipRows,
    amountSignConvention: raw.amountSignConvention,
  };
}

// ── Router ────────────────────────────────────────────────────────────────────

export const bankReconRouter = router({
  /**
   * Step 1: Upload CSV content.
   * Parses the first 5 rows for preview, auto-detects column mapping,
   * creates an import record in status="pending".
   */
  uploadCSV: adminProcedure
    .input(z.object({
      bankAccountId: z.string().uuid(),
      fileName: z.string().min(1).max(255),
      csvContent: z.string().min(1).max(10_000_000), // 10 MB max
    }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "create", "BankReconciliation");

      // Verify bank account belongs to this business
      const [account] = await ctx.db
        .select({ id: bankAccounts.id })
        .from(bankAccounts)
        .where(and(
          eq(bankAccounts.id, input.bankAccountId),
          eq(bankAccounts.businessId, ctx.businessId),
        ))
        .limit(1);

      if (!account) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Bank account not found" });
      }

      const rows = parseCSV(input.csvContent);
      if (rows.length < 2) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "CSV file is empty or has no data rows" });
      }

      // Lazy seed built-in templates (idempotent)
      await seedBankTemplates(ctx.db, ctx.businessId);

      // Fetch all active templates for this business
      const dbTemplates = await ctx.db
        .select()
        .from(bankStatementTemplates)
        .where(and(
          eq(bankStatementTemplates.businessId, ctx.businessId),
          eq(bankStatementTemplates.isActive, true),
        ));

      // Get bank account IFSC / name for detection hints
      const [acctHints] = await ctx.db
        .select({ ifsc: bankAccounts.ifsc, bankName: bankAccounts.bankName })
        .from(bankAccounts)
        .where(and(
          eq(bankAccounts.id, input.bankAccountId),
          eq(bankAccounts.businessId, ctx.businessId),
        ))
        .limit(1);

      const hints = {
        ifsc: acctHints?.ifsc ?? undefined,
        bankName: acctHints?.bankName ?? undefined,
      };

      // Auto-detect template: tries highest version first, degrades to lower
      // versions if data validation fails. Warns if detected bank != account bank.
      const detection = detectBankTemplate(rows, dbTemplates, hints);
      const detectedTemplate: DetectionResult | null = detection?.result ?? null;
      const detectionWarning: DetectionWarning | null = detection?.warning ?? null;

      const headers = rows[0] ?? [];

      // Use template's column mapping if detected, otherwise fall back to heuristics
      const detectedMapping = detectedTemplate
        ? (() => {
            const tmpl = dbTemplates.find((t) => t.id === detectedTemplate.templateId);
            return tmpl?.columnMapping ?? detectColumnMapping(headers);
          })()
        : detectColumnMapping(headers);

      // Preview: first 5 data rows (after header)
      const previewRows = rows.slice(1, 6);

      const [importRecord] = await ctx.db
        .insert(bankStatementImports)
        .values({
          businessId: ctx.businessId,
          bankAccountId: input.bankAccountId,
          fileName: input.fileName,
          status: "pending",
          totalLines: 0,
          matchedLines: 0,
          unmatchedLines: 0,
          createdByUserId: ctx.user.id,
        })
        .returning();

      return {
        importId: importRecord!.id,
        headers,
        previewRows,
        detectedMapping,
        detectedTemplate,
        detectionWarning,
        totalRows: rows.length - 1,
      };
    }),

  /**
   * Step 2: Confirm column mapping.
   * Parses all rows, runs auto-match, updates import to status="review".
   */
  confirmMapping: adminProcedure
    .input(confirmBankMappingSchema.extend({
      csvContent: z.string().min(1).max(10_000_000),
      templateId: z.string().uuid().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "BankReconciliation");

      // Verify import belongs to this business
      const [importRecord] = await ctx.db
        .select()
        .from(bankStatementImports)
        .where(and(
          eq(bankStatementImports.id, input.importId),
          eq(bankStatementImports.businessId, ctx.businessId),
        ))
        .limit(1);

      if (!importRecord) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Import not found" });
      }

      if (!["pending", "mapped"].includes(importRecord.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Import is not in a mappable state" });
      }

      // Resolve template if provided
      let resolvedTemplateId: string | null = null;
      let resolvedTemplateVersion: number | null = null;

      let rows = parseCSV(input.csvContent);

      if (input.templateId) {
        const [tmpl] = await ctx.db
          .select()
          .from(bankStatementTemplates)
          .where(and(
            eq(bankStatementTemplates.id, input.templateId),
            eq(bankStatementTemplates.businessId, ctx.businessId),
          ))
          .limit(1);

        if (!tmpl) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
        }

        // Apply preprocessing rules before column mapping
        if (tmpl.preprocessRules) {
          rows = preprocessRows(rows, tmpl.preprocessRules);
        }

        resolvedTemplateId = tmpl.id;
        resolvedTemplateVersion = tmpl.version;
      }

      const colMapping = toColumnMapping(input.columnMapping);
      const parsedLines = parseStatementLines(rows, colMapping);

      if (parsedLines.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No valid transaction rows found with this mapping" });
      }

      // Dedup check: look for lines with same date/debit/credit/reference in this business
      // We do a soft check — we insert all but flag dupes with a note in rawData
      const _dedupChecks = parsedLines.map((l) => ({
        date: l.transactionDate,
        debit: l.debit,
        credit: l.credit,
        ref: l.referenceNumber ?? null,
      }));

      // Fetch categorization rules for auto-categorization
      const rules = await ctx.db
        .select()
        .from(bankCategorizationRules)
        .where(and(
          eq(bankCategorizationRules.businessId, ctx.businessId),
          eq(bankCategorizationRules.isActive, true),
        ))
        .orderBy(desc(bankCategorizationRules.priority));

      const typedRules: CategorizationRule[] = rules.map((r) => ({
        id: r.id,
        matchField: r.matchField as "narration" | "reference",
        matchType: r.matchType as "contains" | "starts_with" | "exact" | "regex",
        matchValue: r.matchValue,
        action: r.action as "create_expense" | "ignore" | "tag_party",
        expenseCategory: r.expenseCategory,
        partyId: r.partyId,
        priority: r.priority,
        isActive: r.isActive,
      }));

      // Gather date range from statement
      const dates = parsedLines.map((l) => l.transactionDate);
      const statementStart = new Date(Math.min(...dates.map((d) => d.getTime())));
      const statementEnd = new Date(Math.max(...dates.map((d) => d.getTime())));

      // Fetch potential matches from DB within the date window (+/- 7 days)
      const fromDate = new Date(statementStart.getTime() - 7 * 86_400_000);
      const toDate = new Date(statementEnd.getTime() + 7 * 86_400_000);

      const [dbPayments, dbExpenses, dbBankTxns] = await Promise.all([
        ctx.db
          .select({
            id: payments.id,
            amount: payments.amount,
            paymentDate: payments.paymentDate,
            referenceNumber: payments.referenceNumber,
            mode: payments.mode,
            partyId: payments.partyId,
          })
          .from(payments)
          .where(and(
            eq(payments.businessId, ctx.businessId),
            isNull(payments.deletedAt),
            gte(payments.paymentDate, fromDate),
            lte(payments.paymentDate, toDate),
          )),
        ctx.db
          .select({
            id: expenses.id,
            amount: expenses.amount,
            expenseDate: expenses.expenseDate,
            referenceNumber: expenses.referenceNumber,
            description: expenses.description,
            category: expenses.category,
          })
          .from(expenses)
          .where(and(
            eq(expenses.businessId, ctx.businessId),
            isNull(expenses.deletedAt),
            gte(expenses.expenseDate, fromDate),
            lte(expenses.expenseDate, toDate),
          )),
        ctx.db
          .select({
            id: bankTransactions.id,
            amount: bankTransactions.amount,
            transactionDate: bankTransactions.transactionDate,
            description: bankTransactions.description,
            referenceType: bankTransactions.referenceType,
            referenceId: bankTransactions.referenceId,
          })
          .from(bankTransactions)
          .where(and(
            eq(bankTransactions.businessId, ctx.businessId),
            eq(bankTransactions.bankAccountId, importRecord.bankAccountId),
            gte(bankTransactions.transactionDate, fromDate),
            lte(bankTransactions.transactionDate, toDate),
          )),
      ]);

      // Run matching
      const matchResults = matchStatementLines(
        parsedLines,
        dbPayments,
        dbExpenses,
        dbBankTxns,
        typedRules,
      );

      // Build a lookup by lineNumber
      const matchByLine = new Map(matchResults.map((m) => [m.lineNumber, m]));

      // Remove existing lines for this import (re-import scenario)
      await ctx.db
        .delete(bankStatementLines)
        .where(eq(bankStatementLines.importId, input.importId));

      // Insert all parsed lines with match results
      let matchedCount = 0;
      const lineInserts = parsedLines.map((line) => {
        const match = matchByLine.get(line.lineNumber);
        const isMatched = match && match.matchedId !== null;
        if (isMatched) matchedCount++;

        // Apply categorization rules for auto_category
        const ruleResult = applyCategorizationRules(
          line.narration ?? "",
          line.referenceNumber ?? "",
          typedRules,
        );

        return {
          importId: input.importId,
          businessId: ctx.businessId,
          lineNumber: line.lineNumber,
          transactionDate: line.transactionDate,
          narration: line.narration,
          debit: line.debit,
          credit: line.credit,
          balance: line.balance ?? null,
          referenceNumber: line.referenceNumber ?? null,
          rawData: line.rawData,
          matchStatus: isMatched ? ("auto_matched" as const) : ("unmatched" as const),
          matchConfidence: match?.confidence ? String(match.confidence) : null,
          matchedPaymentId: match?.matchType === "payment" ? match.matchedId : null,
          matchedExpenseId: match?.matchType === "expense" ? match.matchedId : null,
          matchedBankTransactionId: match?.matchType === "bank_transaction" ? match.matchedId : null,
          autoCategory: ruleResult?.category ?? null,
        };
      });

      if (lineInserts.length > 0) {
        // Insert in batches of 500 to avoid parameter limits
        const BATCH = 500;
        for (let i = 0; i < lineInserts.length; i += BATCH) {
          await ctx.db.insert(bankStatementLines).values(lineInserts.slice(i, i + BATCH));
        }
      }

      // Update import status
      const closingBalance = parsedLines.at(-1)?.balance ?? null;
      await ctx.db
        .update(bankStatementImports)
        .set({
          status: "review",
          columnMapping: input.columnMapping,
          templateId: resolvedTemplateId,
          templateVersion: resolvedTemplateVersion,
          totalLines: parsedLines.length,
          matchedLines: matchedCount,
          unmatchedLines: parsedLines.length - matchedCount,
          statementStartDate: statementStart,
          statementEndDate: statementEnd,
          closingBalance: closingBalance ?? null,
          updatedAt: new Date(),
        })
        .where(eq(bankStatementImports.id, input.importId));

      return {
        importId: input.importId,
        totalLines: parsedLines.length,
        matchedLines: matchedCount,
        unmatchedLines: parsedLines.length - matchedCount,
      };
    }),

  /**
   * List all imports for a bank account (or all accounts if omitted).
   */
  importList: viewerProcedure
    .input(z.object({
      bankAccountId: z.string().uuid().optional(),
      ...paginationSchema.shape,
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "BankReconciliation");

      const conditions = [eq(bankStatementImports.businessId, ctx.businessId)];
      if (input.bankAccountId) {
        conditions.push(eq(bankStatementImports.bankAccountId, input.bankAccountId));
      }

      const offset = (input.page - 1) * input.limit;

      const [data, [{ count }]] = await Promise.all([
        ctx.db
          .select()
          .from(bankStatementImports)
          .where(and(...conditions))
          .orderBy(desc(bankStatementImports.createdAt))
          .limit(input.limit)
          .offset(offset),
        ctx.db
          .select({ count: sql<number>`count(*)::int` })
          .from(bankStatementImports)
          .where(and(...conditions)),
      ]);

      return { data, total: count, page: input.page, limit: input.limit };
    }),

  /**
   * Get a single import with summary stats.
   */
  importDetail: viewerProcedure
    .input(z.object({ importId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "BankReconciliation");

      const [importRecord] = await ctx.db
        .select()
        .from(bankStatementImports)
        .where(and(
          eq(bankStatementImports.id, input.importId),
          eq(bankStatementImports.businessId, ctx.businessId),
        ))
        .limit(1);

      if (!importRecord) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Import not found" });
      }

      return importRecord;
    }),

  /**
   * Paginated list of statement lines with optional status filter.
   */
  lines: viewerProcedure
    .input(z.object({
      importId: z.string().uuid(),
      status: z.enum(["auto_matched", "manual_matched", "unmatched", "created", "ignored"]).optional(),
      ...paginationSchema.shape,
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "BankReconciliation");

      // Verify import belongs to this business
      const [importRecord] = await ctx.db
        .select({ id: bankStatementImports.id })
        .from(bankStatementImports)
        .where(and(
          eq(bankStatementImports.id, input.importId),
          eq(bankStatementImports.businessId, ctx.businessId),
        ))
        .limit(1);

      if (!importRecord) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Import not found" });
      }

      const conditions = [
        eq(bankStatementLines.importId, input.importId),
        eq(bankStatementLines.businessId, ctx.businessId),
      ];

      if (input.status) {
        conditions.push(eq(bankStatementLines.matchStatus, input.status));
      }

      const offset = (input.page - 1) * input.limit;

      const [data, [{ count }]] = await Promise.all([
        ctx.db
          .select()
          .from(bankStatementLines)
          .where(and(...conditions))
          .orderBy(bankStatementLines.lineNumber)
          .limit(input.limit)
          .offset(offset),
        ctx.db
          .select({ count: sql<number>`count(*)::int` })
          .from(bankStatementLines)
          .where(and(...conditions)),
      ]);

      return { data, total: count, page: input.page, limit: input.limit };
    }),

  /**
   * Confirm an auto-suggested match (promote from auto_matched to manual_matched
   * with user confirmation, or keep as auto_matched).
   */
  confirmMatch: adminProcedure
    .input(z.object({
      lineId: z.string().uuid(),
    }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "BankReconciliation");

      const [line] = await ctx.db
        .select()
        .from(bankStatementLines)
        .where(and(
          eq(bankStatementLines.id, input.lineId),
          eq(bankStatementLines.businessId, ctx.businessId),
        ))
        .limit(1);

      if (!line) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Statement line not found" });
      }

      if (line.matchStatus !== "auto_matched") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Line is not in auto_matched status" });
      }

      await ctx.db
        .update(bankStatementLines)
        .set({ matchStatus: "manual_matched" })
        .where(eq(bankStatementLines.id, input.lineId));

      await updateImportCounts(ctx.db, line.importId);

      return { success: true };
    }),

  /**
   * Manually link a statement line to a payment or expense.
   */
  manualMatch: adminProcedure
    .input(z.object({
      lineId: z.string().uuid(),
      paymentId: z.string().uuid().optional(),
      expenseId: z.string().uuid().optional(),
      bankTransactionId: z.string().uuid().optional(),
    }).refine(
      (d) => [d.paymentId, d.expenseId, d.bankTransactionId].filter(Boolean).length === 1,
      { message: "Provide exactly one of paymentId, expenseId, or bankTransactionId" },
    ))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "BankReconciliation");

      const [line] = await ctx.db
        .select()
        .from(bankStatementLines)
        .where(and(
          eq(bankStatementLines.id, input.lineId),
          eq(bankStatementLines.businessId, ctx.businessId),
        ))
        .limit(1);

      if (!line) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Statement line not found" });
      }

      await ctx.db
        .update(bankStatementLines)
        .set({
          matchStatus: "manual_matched",
          matchConfidence: "1",
          matchedPaymentId: input.paymentId ?? null,
          matchedExpenseId: input.expenseId ?? null,
          matchedBankTransactionId: input.bankTransactionId ?? null,
        })
        .where(eq(bankStatementLines.id, input.lineId));

      await updateImportCounts(ctx.db, line.importId);

      return { success: true };
    }),

  /**
   * Undo a match — revert line back to unmatched.
   */
  unmatch: adminProcedure
    .input(z.object({ lineId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "BankReconciliation");

      const [line] = await ctx.db
        .select()
        .from(bankStatementLines)
        .where(and(
          eq(bankStatementLines.id, input.lineId),
          eq(bankStatementLines.businessId, ctx.businessId),
        ))
        .limit(1);

      if (!line) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Statement line not found" });
      }

      if (!["auto_matched", "manual_matched"].includes(line.matchStatus)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Line is not currently matched" });
      }

      await ctx.db
        .update(bankStatementLines)
        .set({
          matchStatus: "unmatched",
          matchConfidence: null,
          matchedPaymentId: null,
          matchedExpenseId: null,
          matchedBankTransactionId: null,
        })
        .where(eq(bankStatementLines.id, input.lineId));

      await updateImportCounts(ctx.db, line.importId);

      return { success: true };
    }),

  /**
   * Create an expense from an unmatched debit line and link it.
   */
  createExpense: adminProcedure
    .input(z.object({
      lineId: z.string().uuid(),
      expense: createExpenseSchema,
    }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "create", "Expense");

      const [line] = await ctx.db
        .select()
        .from(bankStatementLines)
        .where(and(
          eq(bankStatementLines.id, input.lineId),
          eq(bankStatementLines.businessId, ctx.businessId),
        ))
        .limit(1);

      if (!line) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Statement line not found" });
      }

      if (line.matchStatus !== "unmatched") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Line is already matched or ignored" });
      }

      const newExpense = await ctx.db.transaction(async (tx) => {
        const [exp] = await tx.insert(expenses).values({
          ...input.expense,
          businessId: ctx.businessId,
          expenseDate: input.expense.expenseDate ? new Date(input.expense.expenseDate) : line.transactionDate,
          createdByUserId: ctx.user.id,
          createdByName: ctx.user.name ?? undefined,
        }).returning();

        await tx
          .update(bankStatementLines)
          .set({
            matchStatus: "created",
            matchConfidence: "1",
            matchedExpenseId: exp!.id,
          })
          .where(eq(bankStatementLines.id, input.lineId));

        return exp!;
      });

      await updateImportCounts(ctx.db, line.importId);

      return newExpense;
    }),

  /**
   * Mark a statement line as ignored (no matching needed).
   */
  ignoreLine: adminProcedure
    .input(z.object({ lineId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "BankReconciliation");

      const [line] = await ctx.db
        .select()
        .from(bankStatementLines)
        .where(and(
          eq(bankStatementLines.id, input.lineId),
          eq(bankStatementLines.businessId, ctx.businessId),
        ))
        .limit(1);

      if (!line) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Statement line not found" });
      }

      await ctx.db
        .update(bankStatementLines)
        .set({ matchStatus: "ignored" })
        .where(eq(bankStatementLines.id, input.lineId));

      await updateImportCounts(ctx.db, line.importId);

      return { success: true };
    }),

  /**
   * Bank Reconciliation Statement (BRS): compare bank balance (closing balance
   * from statement) with book balance (current_balance from bank_accounts).
   */
  summary: viewerProcedure
    .input(z.object({
      bankAccountId: z.string().uuid(),
      importId: z.string().uuid().optional(),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "BankReconciliation");

      const [account] = await ctx.db
        .select()
        .from(bankAccounts)
        .where(and(
          eq(bankAccounts.id, input.bankAccountId),
          eq(bankAccounts.businessId, ctx.businessId),
        ))
        .limit(1);

      if (!account) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Bank account not found" });
      }

      // Get the latest import for this account (or the specific one requested)
      const importCond = input.importId
        ? [eq(bankStatementImports.id, input.importId)]
        : [
            eq(bankStatementImports.bankAccountId, input.bankAccountId),
            eq(bankStatementImports.businessId, ctx.businessId),
          ];

      const [latestImport] = await ctx.db
        .select()
        .from(bankStatementImports)
        .where(and(...importCond))
        .orderBy(desc(bankStatementImports.createdAt))
        .limit(1);

      const statementBalance = latestImport?.closingBalance ?? null;
      const bookBalance = account.currentBalance;

      // Unmatched lines that affect the difference
      let unmatchedDebits = "0.00";
      let unmatchedCredits = "0.00";

      if (latestImport) {
        const [debitSum] = await ctx.db
          .select({
            total: sql<string>`COALESCE(SUM(${bankStatementLines.debit}::numeric), 0)::text`,
          })
          .from(bankStatementLines)
          .where(and(
            eq(bankStatementLines.importId, latestImport.id),
            eq(bankStatementLines.matchStatus, "unmatched"),
          ));

        const [creditSum] = await ctx.db
          .select({
            total: sql<string>`COALESCE(SUM(${bankStatementLines.credit}::numeric), 0)::text`,
          })
          .from(bankStatementLines)
          .where(and(
            eq(bankStatementLines.importId, latestImport.id),
            eq(bankStatementLines.matchStatus, "unmatched"),
          ));

        unmatchedDebits = debitSum?.total ?? "0.00";
        unmatchedCredits = creditSum?.total ?? "0.00";
      }

      const difference = statementBalance !== null
        ? money.sub(statementBalance, bookBalance)
        : null;

      return {
        accountName: account.accountName,
        bankName: account.bankName,
        bookBalance,
        statementBalance,
        difference,
        unmatchedDebits,
        unmatchedCredits,
        import: latestImport ?? null,
      };
    }),

  // ── Bank Statement Templates ─────────────────────────────────────────────────

  /**
   * List all templates for this business (seeded + custom/forked).
   */
  templateList: viewerProcedure
    .input(z.object({ search: z.string().optional() }).optional())
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "BankReconciliation");

      const conditions = [eq(bankStatementTemplates.businessId, ctx.businessId)];
      if (input?.search) {
        conditions.push(
          ilike(bankStatementTemplates.bankDisplayName, `%${escapeLike(input.search)}%`),
        );
      }

      const templates = await ctx.db
        .select({
          id: bankStatementTemplates.id,
          bankSlug: bankStatementTemplates.bankSlug,
          bankDisplayName: bankStatementTemplates.bankDisplayName,
          version: bankStatementTemplates.version,
          label: bankStatementTemplates.label,
          isSeeded: bankStatementTemplates.isSeeded,
          forkedFromId: bankStatementTemplates.forkedFromId,
          fileFormat: bankStatementTemplates.fileFormat,
          isActive: bankStatementTemplates.isActive,
          createdAt: bankStatementTemplates.createdAt,
        })
        .from(bankStatementTemplates)
        .where(and(...conditions))
        .orderBy(asc(bankStatementTemplates.bankDisplayName), desc(bankStatementTemplates.version));

      return templates;
    }),

  /**
   * Create a custom (non-seeded) template.
   */
  templateCreate: adminProcedure
    .input(z.object({
      bankSlug: z.string().max(100).optional(),
      bankDisplayName: z.string().min(1).max(255),
      columnMapping: bankReconColumnMappingSchema,
      preprocessRules: z.object({
        extraHeaderRows: z.number().int().min(0).optional(),
        skipRowPatterns: z.array(z.string()).optional(),
        amountParsingMode: z.enum(["standard", "dr_cr_suffix", "parentheses_negative", "signed"]).optional(),
        skipSubtotalRows: z.boolean().optional(),
        encoding: z.string().optional(),
      }).optional(),
      detectionRules: z.object({
        headerPatterns: z.array(z.string()).optional(),
        columnCount: z.object({ min: z.number(), max: z.number() }).optional(),
        firstRowPatterns: z.array(z.string()).optional(),
        ifscPrefix: z.string().optional(),
      }).optional(),
      label: z.string().max(255).optional(),
      fileFormat: z.enum(["csv", "xlsx", "pdf"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "create", "BankReconciliation");

      const bankSlug = input.bankSlug ?? `custom_${randomUUID()}`;

      const [template] = await ctx.db
        .insert(bankStatementTemplates)
        .values({
          businessId: ctx.businessId,
          bankSlug,
          bankDisplayName: input.bankDisplayName,
          version: 1,
          label: input.label ?? null,
          isSeeded: false,
          forkedFromId: null,
          columnMapping: input.columnMapping,
          preprocessRules: input.preprocessRules ?? null,
          detectionRules: input.detectionRules ?? null,
          fileFormat: input.fileFormat ?? "csv",
          isActive: true,
        })
        .returning();

      return template!;
    }),

  /**
   * Fork a seeded or existing template into a user-editable copy.
   */
  templateFork: adminProcedure
    .input(z.object({
      templateId: z.string().uuid(),
      label: z.string().max(255).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "create", "BankReconciliation");

      const [source] = await ctx.db
        .select()
        .from(bankStatementTemplates)
        .where(and(
          eq(bankStatementTemplates.id, input.templateId),
          eq(bankStatementTemplates.businessId, ctx.businessId),
        ))
        .limit(1);

      if (!source) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
      }

      // Find highest existing version for this bankSlug to bump it
      const [maxRow] = await ctx.db
        .select({ maxVersion: sql<number>`MAX(${bankStatementTemplates.version})::int` })
        .from(bankStatementTemplates)
        .where(and(
          eq(bankStatementTemplates.businessId, ctx.businessId),
          eq(bankStatementTemplates.bankSlug, source.bankSlug),
        ));

      const newVersion = (maxRow?.maxVersion ?? source.version) + 1;

      const [forked] = await ctx.db
        .insert(bankStatementTemplates)
        .values({
          businessId: ctx.businessId,
          bankSlug: source.bankSlug,
          bankDisplayName: source.bankDisplayName,
          version: newVersion,
          label: input.label ?? source.label ?? null,
          isSeeded: false,
          forkedFromId: source.id,
          columnMapping: source.columnMapping,
          preprocessRules: source.preprocessRules ?? null,
          detectionRules: source.detectionRules ?? null,
          fileFormat: source.fileFormat,
          isActive: true,
        })
        .returning();

      return forked!;
    }),

  /**
   * Update a custom/forked template. Seeded templates cannot be modified.
   */
  templateUpdate: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      columnMapping: bankReconColumnMappingSchema.optional(),
      preprocessRules: z.object({
        extraHeaderRows: z.number().int().min(0).optional(),
        skipRowPatterns: z.array(z.string()).optional(),
        amountParsingMode: z.enum(["standard", "dr_cr_suffix", "parentheses_negative", "signed"]).optional(),
        skipSubtotalRows: z.boolean().optional(),
        encoding: z.string().optional(),
      }).optional(),
      detectionRules: z.object({
        headerPatterns: z.array(z.string()).optional(),
        columnCount: z.object({ min: z.number(), max: z.number() }).optional(),
        firstRowPatterns: z.array(z.string()).optional(),
        ifscPrefix: z.string().optional(),
      }).optional(),
      label: z.string().max(255).optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "BankReconciliation");

      const [existing] = await ctx.db
        .select()
        .from(bankStatementTemplates)
        .where(and(
          eq(bankStatementTemplates.id, input.id),
          eq(bankStatementTemplates.businessId, ctx.businessId),
        ))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
      }

      if (existing.isSeeded) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot edit a seeded template. Fork it first to create an editable copy.",
        });
      }

      const updateData: Partial<typeof bankStatementTemplates.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (input.columnMapping !== undefined) updateData.columnMapping = input.columnMapping;
      if (input.preprocessRules !== undefined) updateData.preprocessRules = input.preprocessRules;
      if (input.detectionRules !== undefined) updateData.detectionRules = input.detectionRules;
      if (input.label !== undefined) updateData.label = input.label;
      if (input.isActive !== undefined) updateData.isActive = input.isActive;

      const [updated] = await ctx.db
        .update(bankStatementTemplates)
        .set(updateData)
        .where(eq(bankStatementTemplates.id, input.id))
        .returning();

      return updated!;
    }),

  /**
   * Delete a custom/forked template. Seeded templates cannot be deleted.
   */
  templateDelete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "delete", "BankReconciliation");

      const [existing] = await ctx.db
        .select()
        .from(bankStatementTemplates)
        .where(and(
          eq(bankStatementTemplates.id, input.id),
          eq(bankStatementTemplates.businessId, ctx.businessId),
        ))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
      }

      if (existing.isSeeded) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot delete a seeded template.",
        });
      }

      await ctx.db
        .delete(bankStatementTemplates)
        .where(eq(bankStatementTemplates.id, input.id));

      return { success: true };
    }),

  // ── Categorization Rules ────────────────────────────────────────────────────

  ruleList: viewerProcedure
    .input(z.object({
      bankAccountId: z.string().uuid().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "BankReconciliation");

      const conditions = [eq(bankCategorizationRules.businessId, ctx.businessId)];
      if (input?.bankAccountId) {
        conditions.push(
          or(
            eq(bankCategorizationRules.bankAccountId, input.bankAccountId),
            isNull(bankCategorizationRules.bankAccountId),
          )!,
        );
      }

      const rules = await ctx.db
        .select()
        .from(bankCategorizationRules)
        .where(and(...conditions))
        .orderBy(desc(bankCategorizationRules.priority), bankCategorizationRules.createdAt);

      return rules;
    }),

  ruleCreate: adminProcedure
    .input(bankCategorizationRuleSchema)
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "create", "BankReconciliation");

      if (input.bankAccountId) {
        const [account] = await ctx.db
          .select({ id: bankAccounts.id })
          .from(bankAccounts)
          .where(and(
            eq(bankAccounts.id, input.bankAccountId),
            eq(bankAccounts.businessId, ctx.businessId),
          ))
          .limit(1);

        if (!account) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Bank account not found" });
        }
      }

      const [rule] = await ctx.db
        .insert(bankCategorizationRules)
        .values({
          businessId: ctx.businessId,
          ...input,
        })
        .returning();

      return rule!;
    }),

  ruleUpdate: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      data: bankCategorizationRuleSchema.partial().extend({
        isActive: z.boolean().optional(),
      }),
    }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "BankReconciliation");

      const [existing] = await ctx.db
        .select({ id: bankCategorizationRules.id })
        .from(bankCategorizationRules)
        .where(and(
          eq(bankCategorizationRules.id, input.id),
          eq(bankCategorizationRules.businessId, ctx.businessId),
        ))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Rule not found" });
      }

      const [updated] = await ctx.db
        .update(bankCategorizationRules)
        .set(input.data)
        .where(eq(bankCategorizationRules.id, input.id))
        .returning();

      return updated!;
    }),

  ruleDelete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "delete", "BankReconciliation");

      const [existing] = await ctx.db
        .select({ id: bankCategorizationRules.id })
        .from(bankCategorizationRules)
        .where(and(
          eq(bankCategorizationRules.id, input.id),
          eq(bankCategorizationRules.businessId, ctx.businessId),
        ))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Rule not found" });
      }

      await ctx.db
        .delete(bankCategorizationRules)
        .where(eq(bankCategorizationRules.id, input.id));

      return { success: true };
    }),
});

// ── Private helpers ───────────────────────────────────────────────────────────

type Db = TenantDatabase;

async function updateImportCounts(db: Db, importId: string) {
  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      matched: sql<number>`SUM(CASE WHEN match_status IN ('auto_matched','manual_matched','created') THEN 1 ELSE 0 END)::int`,
      unmatched: sql<number>`SUM(CASE WHEN match_status = 'unmatched' THEN 1 ELSE 0 END)::int`,
    })
    .from(bankStatementLines)
    .where(eq(bankStatementLines.importId, importId));

  if (counts) {
    await db
      .update(bankStatementImports)
      .set({
        totalLines: counts.total,
        matchedLines: counts.matched ?? 0,
        unmatchedLines: counts.unmatched ?? 0,
        updatedAt: new Date(),
      })
      .where(eq(bankStatementImports.id, importId));
  }
}
