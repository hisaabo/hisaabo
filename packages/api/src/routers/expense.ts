import { eq, and, sql, desc, gte, lte, ilike, or, isNull, inArray } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { expenses, bankAccounts, bankTransactions } from "@hisaabo/db";
import { createExpenseSchema, paginationSchema, money } from "@hisaabo/shared";
import { router, viewerProcedure, memberProcedure, adminProcedure } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";

// Map payment mode to the bank account type(s) to search for.
// Returns null when no bank debit should be created.
function modeToAccountTypes(mode: string): Array<"cash" | "savings" | "current" | "upi"> | null {
  switch (mode) {
    case "cash":    return ["cash"];
    case "bank":    return ["savings", "current"];
    case "upi":     return ["upi"];
    case "cheque":  return ["savings", "current"];
    default:        return null; // "other" and unknown modes — skip
  }
}

export const expenseRouter = router({
  list: viewerProcedure
    .input(z.object({
      category: z.string().optional(),
      search: z.string().optional(),
      fromDate: z.string().datetime().optional(),
      toDate: z.string().datetime().optional(),
      ...paginationSchema.shape,
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Expense");
      const conditions = [eq(expenses.businessId, ctx.businessId), isNull(expenses.deletedAt)];
      if (input.category) conditions.push(eq(expenses.category, input.category));
      if (input.fromDate) conditions.push(gte(expenses.expenseDate, new Date(input.fromDate)));
      if (input.toDate) conditions.push(lte(expenses.expenseDate, new Date(input.toDate)));
      if (input.search) {
        conditions.push(
          or(
            ilike(expenses.description, `%${input.search}%`),
            ilike(expenses.category, `%${input.search}%`)
          )!
        );
      }

      const offset = (input.page - 1) * input.limit;

      const [data, [{ count }]] = await Promise.all([
        ctx.db.select().from(expenses)
          .where(and(...conditions))
          .orderBy(desc(expenses.expenseDate))
          .limit(input.limit)
          .offset(offset),
        ctx.db.select({ count: sql<number>`count(*)::int` }).from(expenses)
          .where(and(...conditions)),
      ]);

      return { data, total: count, page: input.page, limit: input.limit };
    }),

  create: memberProcedure.input(createExpenseSchema).mutation(async ({ input, ctx }) => {
    requireCan(ctx.ability, "create", "Expense");

    const expense = await ctx.db.transaction(async (tx) => {
      const [newExpense] = await tx.insert(expenses).values({
        ...input,
        businessId: ctx.businessId,
        expenseDate: input.expenseDate ? new Date(input.expenseDate) : new Date(),
        createdByUserId: ctx.user!.id,
        createdByName: ctx.user!.name,
      }).returning();

      // ── Bank account debit ─────────────────────────────────────────
      const accountTypes = modeToAccountTypes(input.mode);
      if (accountTypes) {
        // Find the default account matching the payment mode, then fall back
        // to any account of that type belonging to this business.
        const [account] = await tx
          .select({ id: bankAccounts.id, currentBalance: bankAccounts.currentBalance })
          .from(bankAccounts)
          .where(
            and(
              eq(bankAccounts.businessId, ctx.businessId),
              inArray(bankAccounts.accountType, accountTypes)
            )
          )
          .orderBy(
            // Prefer the default account first
            sql`${bankAccounts.isDefault} DESC`,
            bankAccounts.createdAt
          )
          .for("update")
          .limit(1);

        if (account) {
          const newBalance = money.sub(account.currentBalance, input.amount);

          await tx.insert(bankTransactions).values({
            businessId: ctx.businessId,
            bankAccountId: account.id,
            type: "withdrawal",
            amount: input.amount,
            description: `Expense: ${input.category}${input.description ? ` — ${input.description}` : ""}`,
            referenceType: "expense",
            referenceId: newExpense.id,
            transactionDate: newExpense.expenseDate,
          });

          await tx
            .update(bankAccounts)
            .set({ currentBalance: newBalance, updatedAt: new Date() })
            .where(eq(bankAccounts.id, account.id));
        }
      }

      return newExpense;
    });

    return expense;
  }),

  update: memberProcedure
    .input(z.object({ id: z.string().uuid(), data: createExpenseSchema.partial() }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Expense");
      const [existing] = await ctx.db.select({ id: expenses.id })
        .from(expenses)
        .where(and(eq(expenses.id, input.id), eq(expenses.businessId, ctx.businessId)))
        .limit(1);

      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Expense not found" });

      const [updated] = await ctx.db.update(expenses)
        .set({
          ...input.data,
          expenseDate: input.data.expenseDate ? new Date(input.data.expenseDate) : undefined,
        })
        .where(and(eq(expenses.id, input.id), eq(expenses.businessId, ctx.businessId)))
        .returning();
      return updated;
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "delete", "Expense");
      const [existing] = await ctx.db
        .select({ id: expenses.id, deletedAt: expenses.deletedAt })
        .from(expenses)
        .where(and(eq(expenses.id, input.id), eq(expenses.businessId, ctx.businessId)))
        .limit(1);

      if (!existing) return { success: true };
      if (existing.deletedAt) return { success: true }; // already soft-deleted

      await ctx.db.transaction(async (tx) => {
        // Soft-delete the expense
        await tx
          .update(expenses)
          .set({ deletedAt: new Date() })
          .where(and(eq(expenses.id, input.id), eq(expenses.businessId, ctx.businessId)));

        // Reverse the bank withdrawal that was created when this expense was recorded
        const [originalTx] = await tx
          .select({
            id: bankTransactions.id,
            bankAccountId: bankTransactions.bankAccountId,
            amount: bankTransactions.amount,
          })
          .from(bankTransactions)
          .where(
            and(
              eq(bankTransactions.businessId, ctx.businessId),
              eq(bankTransactions.referenceType, "expense"),
              eq(bankTransactions.referenceId, input.id)
            )
          )
          .limit(1);

        if (originalTx) {
          // Lock the account row before updating
          const [account] = await tx
            .select({ currentBalance: bankAccounts.currentBalance })
            .from(bankAccounts)
            .where(eq(bankAccounts.id, originalTx.bankAccountId))
            .for("update")
            .limit(1);

          if (account) {
            // Add the amount back (reversing the withdrawal)
            const restoredBalance = money.add(account.currentBalance, originalTx.amount);

            await tx
              .update(bankAccounts)
              .set({ currentBalance: restoredBalance, updatedAt: new Date() })
              .where(eq(bankAccounts.id, originalTx.bankAccountId));
          }

          // Remove the bank transaction record
          await tx
            .delete(bankTransactions)
            .where(eq(bankTransactions.id, originalTx.id));
        }
      });

      return { success: true };
    }),

  categories: viewerProcedure.query(async ({ ctx }) => {
    requireCan(ctx.ability, "read", "Expense");
    const result = await ctx.db.selectDistinct({ category: expenses.category })
      .from(expenses)
      .where(and(eq(expenses.businessId, ctx.businessId), isNull(expenses.deletedAt)))
      .orderBy(expenses.category);
    return result.map((r) => r.category);
  }),

  summary: viewerProcedure
    .input(z.object({
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Expense");
      const conditions = [eq(expenses.businessId, ctx.businessId), isNull(expenses.deletedAt)];
      if (input.from) conditions.push(sql`${expenses.expenseDate} >= ${input.from}`);
      if (input.to) conditions.push(sql`${expenses.expenseDate} <= ${input.to}`);

      const result = await ctx.db.select({
        category: expenses.category,
        total: sql<string>`coalesce(sum(${expenses.amount}::numeric), 0)::text`,
        count: sql<number>`count(*)::int`,
      }).from(expenses)
        .where(and(...conditions))
        .groupBy(expenses.category)
        .orderBy(sql`sum(${expenses.amount}::numeric) desc`);

      return result;
    }),
});
