import { eq, and, sql, desc, gte, lte, asc } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { bankAccounts, bankTransactions } from "@hisaabo/db";
import {
  createBankAccountSchema,
  updateBankAccountSchema,
  createBankTransactionSchema,
  bankTransferSchema,
  paginationSchema,
  money,
} from "@hisaabo/shared";
import { router, viewerProcedure, memberProcedure, adminProcedure } from "../trpc.js";

export const bankAccountRouter = router({
  // ── Accounts ────────────────────────────────────────────────

  list: viewerProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.businessId, ctx.businessId))
      .orderBy(desc(bankAccounts.isDefault), asc(bankAccounts.accountName));
  }),

  getById: viewerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const [account] = await ctx.db
        .select()
        .from(bankAccounts)
        .where(
          and(
            eq(bankAccounts.id, input.id),
            eq(bankAccounts.businessId, ctx.businessId)
          )
        )
        .limit(1);

      if (!account) return null;

      const recentTransactions = await ctx.db
        .select()
        .from(bankTransactions)
        .where(eq(bankTransactions.bankAccountId, input.id))
        .orderBy(desc(bankTransactions.transactionDate))
        .limit(20);

      return { ...account, recentTransactions };
    }),

  create: memberProcedure
    .input(createBankAccountSchema)
    .mutation(async ({ input, ctx }) => {
      return ctx.db.transaction(async (tx) => {
        // If new account is default, clear existing defaults
        if (input.isDefault) {
          await tx
            .update(bankAccounts)
            .set({ isDefault: false, updatedAt: new Date() })
            .where(eq(bankAccounts.businessId, ctx.businessId));
        }

        const [account] = await tx
          .insert(bankAccounts)
          .values({
            businessId: ctx.businessId,
            accountName: input.accountName,
            accountNumber: input.accountNumber,
            ifsc: input.ifsc,
            bankName: input.bankName,
            accountType: input.accountType,
            openingBalance: input.openingBalance,
            // currentBalance starts at openingBalance
            currentBalance: input.openingBalance,
            isDefault: input.isDefault,
          })
          .returning();

        return account;
      });
    }),

  update: memberProcedure
    .input(z.object({ id: z.string().uuid(), data: updateBankAccountSchema }))
    .mutation(async ({ input, ctx }) => {
      return ctx.db.transaction(async (tx) => {
        // Verify ownership
        const [existing] = await tx
          .select({ id: bankAccounts.id })
          .from(bankAccounts)
          .where(
            and(
              eq(bankAccounts.id, input.id),
              eq(bankAccounts.businessId, ctx.businessId)
            )
          )
          .limit(1);

        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Bank account not found" });
        }

        // Handle isDefault toggle
        if (input.data.isDefault) {
          await tx
            .update(bankAccounts)
            .set({ isDefault: false, updatedAt: new Date() })
            .where(
              and(
                eq(bankAccounts.businessId, ctx.businessId),
                sql`${bankAccounts.id} != ${input.id}`
              )
            );
        }

        const [account] = await tx
          .update(bankAccounts)
          .set({ ...input.data, updatedAt: new Date() })
          .where(
            and(
              eq(bankAccounts.id, input.id),
              eq(bankAccounts.businessId, ctx.businessId)
            )
          )
          .returning();

        return account;
      });
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.db.transaction(async (tx) => {
        const [account] = await tx
          .select({ id: bankAccounts.id })
          .from(bankAccounts)
          .where(
            and(
              eq(bankAccounts.id, input.id),
              eq(bankAccounts.businessId, ctx.businessId)
            )
          )
          .limit(1);

        if (!account) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Bank account not found" });
        }

        // Check for existing transactions
        const [{ txCount }] = await tx
          .select({ txCount: sql<number>`count(*)::int` })
          .from(bankTransactions)
          .where(eq(bankTransactions.bankAccountId, input.id));

        if (txCount > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Cannot delete account with ${txCount} transaction(s). Please delete transactions first.`,
          });
        }

        await tx
          .delete(bankAccounts)
          .where(
            and(
              eq(bankAccounts.id, input.id),
              eq(bankAccounts.businessId, ctx.businessId)
            )
          );

        return { success: true };
      });
    }),

  // ── Transactions ────────────────────────────────────────────

  listTransactions: viewerProcedure
    .input(
      z.object({
        bankAccountId: z.string().uuid(),
        fromDate: z.string().datetime().optional(),
        toDate: z.string().datetime().optional(),
        type: z.enum(["deposit", "withdrawal", "transfer"]).optional(),
        ...paginationSchema.shape,
      })
    )
    .query(async ({ input, ctx }) => {
      // Verify account belongs to business
      const [account] = await ctx.db
        .select({ id: bankAccounts.id })
        .from(bankAccounts)
        .where(
          and(
            eq(bankAccounts.id, input.bankAccountId),
            eq(bankAccounts.businessId, ctx.businessId)
          )
        )
        .limit(1);

      if (!account) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Bank account not found" });
      }

      const conditions = [eq(bankTransactions.bankAccountId, input.bankAccountId)];

      if (input.type) conditions.push(eq(bankTransactions.type, input.type));
      if (input.fromDate) {
        conditions.push(gte(bankTransactions.transactionDate, new Date(input.fromDate)));
      }
      if (input.toDate) {
        conditions.push(lte(bankTransactions.transactionDate, new Date(input.toDate)));
      }

      const offset = (input.page - 1) * input.limit;

      const [data, [{ count }]] = await Promise.all([
        ctx.db
          .select()
          .from(bankTransactions)
          .where(and(...conditions))
          .orderBy(desc(bankTransactions.transactionDate))
          .limit(input.limit)
          .offset(offset),
        ctx.db
          .select({ count: sql<number>`count(*)::int` })
          .from(bankTransactions)
          .where(and(...conditions)),
      ]);

      return { data, total: count, page: input.page, limit: input.limit };
    }),

  addTransaction: memberProcedure
    .input(createBankTransactionSchema)
    .mutation(async ({ input, ctx }) => {
      return ctx.db.transaction(async (tx) => {
        // Lock account row for atomic balance update
        const [account] = await tx
          .select({
            id: bankAccounts.id,
            currentBalance: bankAccounts.currentBalance,
          })
          .from(bankAccounts)
          .where(
            and(
              eq(bankAccounts.id, input.bankAccountId),
              eq(bankAccounts.businessId, ctx.businessId)
            )
          )
          .for("update")
          .limit(1);

        if (!account) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Bank account not found" });
        }

        const newBalance =
          input.type === "deposit" || input.type === "transfer"
            ? money.add(account.currentBalance, input.amount)
            : money.sub(account.currentBalance, input.amount);

        const [txn] = await tx
          .insert(bankTransactions)
          .values({
            businessId: ctx.businessId,
            bankAccountId: input.bankAccountId,
            type: input.type,
            amount: input.amount,
            description: input.description,
            referenceType: input.referenceType,
            referenceId: input.referenceId,
            balanceAfter: newBalance,
            transactionDate: input.transactionDate
              ? new Date(input.transactionDate)
              : new Date(),
          })
          .returning();

        await tx
          .update(bankAccounts)
          .set({ currentBalance: newBalance, updatedAt: new Date() })
          .where(eq(bankAccounts.id, input.bankAccountId));

        return txn;
      });
    }),

  transfer: memberProcedure
    .input(bankTransferSchema)
    .mutation(async ({ input, ctx }) => {
      if (input.fromAccountId === input.toAccountId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot transfer to the same account",
        });
      }

      return ctx.db.transaction(async (tx) => {
        // Lock both accounts in a consistent order to prevent deadlocks
        const firstId =
          input.fromAccountId < input.toAccountId
            ? input.fromAccountId
            : input.toAccountId;
        const secondId =
          input.fromAccountId < input.toAccountId
            ? input.toAccountId
            : input.fromAccountId;

        const [firstAccount] = await tx
          .select({ id: bankAccounts.id, currentBalance: bankAccounts.currentBalance })
          .from(bankAccounts)
          .where(
            and(
              eq(bankAccounts.id, firstId),
              eq(bankAccounts.businessId, ctx.businessId)
            )
          )
          .for("update")
          .limit(1);

        const [secondAccount] = await tx
          .select({ id: bankAccounts.id, currentBalance: bankAccounts.currentBalance })
          .from(bankAccounts)
          .where(
            and(
              eq(bankAccounts.id, secondId),
              eq(bankAccounts.businessId, ctx.businessId)
            )
          )
          .for("update")
          .limit(1);

        if (!firstAccount || !secondAccount) {
          throw new TRPCError({ code: "NOT_FOUND", message: "One or both accounts not found" });
        }

        // Re-map back to from/to for clarity
        const fromAccount =
          firstAccount.id === input.fromAccountId ? firstAccount : secondAccount;
        const toAccount =
          firstAccount.id === input.toAccountId ? firstAccount : secondAccount;

        const newFromBalance = money.sub(fromAccount.currentBalance, input.amount);
        const newToBalance = money.add(toAccount.currentBalance, input.amount);

        const txnDate = input.transactionDate ? new Date(input.transactionDate) : new Date();

        const [withdrawalTxn] = await tx
          .insert(bankTransactions)
          .values({
            businessId: ctx.businessId,
            bankAccountId: input.fromAccountId,
            type: "withdrawal",
            amount: input.amount,
            description: input.description ?? `Transfer to account ${input.toAccountId}`,
            referenceType: "transfer",
            referenceId: input.toAccountId,
            balanceAfter: newFromBalance,
            transactionDate: txnDate,
          })
          .returning();

        const [depositTxn] = await tx
          .insert(bankTransactions)
          .values({
            businessId: ctx.businessId,
            bankAccountId: input.toAccountId,
            type: "deposit",
            amount: input.amount,
            description: input.description ?? `Transfer from account ${input.fromAccountId}`,
            referenceType: "transfer",
            referenceId: input.fromAccountId,
            balanceAfter: newToBalance,
            transactionDate: txnDate,
          })
          .returning();

        await tx
          .update(bankAccounts)
          .set({ currentBalance: newFromBalance, updatedAt: new Date() })
          .where(eq(bankAccounts.id, input.fromAccountId));

        await tx
          .update(bankAccounts)
          .set({ currentBalance: newToBalance, updatedAt: new Date() })
          .where(eq(bankAccounts.id, input.toAccountId));

        return { withdrawal: withdrawalTxn, deposit: depositTxn };
      });
    }),

  summary: viewerProcedure.query(async ({ ctx }) => {
    const [result] = await ctx.db
      .select({
        totalBalance: sql<string>`coalesce(sum(${bankAccounts.currentBalance}::numeric), 0)::text`,
        cashInHand: sql<string>`coalesce(sum(${bankAccounts.currentBalance}::numeric) filter (where ${bankAccounts.accountType} = 'cash'), 0)::text`,
        bankBalance: sql<string>`coalesce(sum(${bankAccounts.currentBalance}::numeric) filter (where ${bankAccounts.accountType} != 'cash'), 0)::text`,
        accountCount: sql<number>`count(*)::int`,
      })
      .from(bankAccounts)
      .where(eq(bankAccounts.businessId, ctx.businessId));

    return result;
  }),
});
