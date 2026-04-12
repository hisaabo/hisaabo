import { eq, and, sql, desc, gte, lte, asc } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { bankAccounts, bankTransactions, paymentGatewayConfigs } from "@hisaabo/db";
import {
  createBankAccountSchema,
  updateBankAccountSchema,
  createBankTransactionSchema,
  bankTransferSchema,
  paginationSchema,
  createPaymentGatewayConfigSchema,
  money,
} from "@hisaabo/shared";
import { router, viewerProcedure, memberProcedure, adminProcedure } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";
import { logAudit } from "../lib/audit.js";

export const bankAccountRouter = router({
  // ── Accounts ────────────────────────────────────────────────

  list: viewerProcedure.query(async ({ ctx }) => {
    requireCan(ctx.ability, "read", "BankAccount");
    return ctx.db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.businessId, ctx.businessId))
      .orderBy(desc(bankAccounts.isDefault), asc(bankAccounts.accountName));
  }),

  getById: viewerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "BankAccount");
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
      requireCan(ctx.ability, "create", "BankAccount");
      const account = await ctx.db.transaction(async (tx) => {
        // If new account is default, clear existing defaults
        if (input.isDefault) {
          await tx
            .update(bankAccounts)
            .set({ isDefault: false, updatedAt: new Date() })
            .where(eq(bankAccounts.businessId, ctx.businessId));
        }

        const [result] = await tx
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

        return result;
      });

      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user!.id,
        action: "bankAccount.create",
        entityType: "bankAccount",
        entityId: account.id,
        metadata: { accountName: account.accountName },
        ipAddress: ctx.ipAddress,
      });

      return account;
    }),

  update: memberProcedure
    .input(z.object({ id: z.string().uuid(), data: updateBankAccountSchema }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "BankAccount");
      const account = await ctx.db.transaction(async (tx) => {
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

        const [result] = await tx
          .update(bankAccounts)
          .set({ ...input.data, updatedAt: new Date() })
          .where(
            and(
              eq(bankAccounts.id, input.id),
              eq(bankAccounts.businessId, ctx.businessId)
            )
          )
          .returning();

        return result;
      });

      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user!.id,
        action: "bankAccount.update",
        entityType: "bankAccount",
        entityId: account.id,
        metadata: { accountName: account.accountName },
        ipAddress: ctx.ipAddress,
      });

      return account;
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "delete", "BankAccount");
      const result = await ctx.db.transaction(async (tx) => {
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

      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user!.id,
        action: "bankAccount.delete",
        entityType: "bankAccount",
        entityId: input.id,
        metadata: { accountId: input.id },
        ipAddress: ctx.ipAddress,
      });

      return result;
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
      requireCan(ctx.ability, "read", "BankTransaction");
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

      // Get the opening balance for running total calculation
      const [acct] = await ctx.db
        .select({ openingBalance: bankAccounts.openingBalance })
        .from(bankAccounts)
        .where(eq(bankAccounts.id, input.bankAccountId))
        .limit(1);

      const [data, [{ count }]] = await Promise.all([
        ctx.db
          .select({
            id: bankTransactions.id,
            businessId: bankTransactions.businessId,
            bankAccountId: bankTransactions.bankAccountId,
            type: bankTransactions.type,
            amount: bankTransactions.amount,
            description: bankTransactions.description,
            referenceType: bankTransactions.referenceType,
            referenceId: bankTransactions.referenceId,
            transactionDate: bankTransactions.transactionDate,
            createdAt: bankTransactions.createdAt,
            // Running balance: opening_balance + cumulative deposits - cumulative withdrawals
            balanceAfter: sql<string>`(
              ${acct.openingBalance}::numeric + SUM(
                CASE WHEN ${bankTransactions.type} = 'deposit' THEN ${bankTransactions.amount}::numeric
                     ELSE -${bankTransactions.amount}::numeric END
              ) OVER (
                ORDER BY ${bankTransactions.transactionDate} ASC, ${bankTransactions.createdAt} ASC
                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
              )
            )::text`.as("balance_after"),
          })
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
      requireCan(ctx.ability, "create", "BankTransaction");
      const txn = await ctx.db.transaction(async (tx) => {
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

        const [result] = await tx
          .insert(bankTransactions)
          .values({
            businessId: ctx.businessId,
            bankAccountId: input.bankAccountId,
            type: input.type,
            amount: input.amount,
            description: input.description,
            referenceType: input.referenceType,
            referenceId: input.referenceId,

            transactionDate: input.transactionDate
              ? new Date(input.transactionDate)
              : new Date(),
          })
          .returning();

        await tx
          .update(bankAccounts)
          .set({ currentBalance: newBalance, updatedAt: new Date() })
          .where(eq(bankAccounts.id, input.bankAccountId));

        return result;
      });

      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user!.id,
        action: "bankTransaction.create",
        entityType: "bankTransaction",
        entityId: txn.id,
        metadata: { amount: txn.amount, type: txn.type },
        ipAddress: ctx.ipAddress,
      });

      return txn;
    }),

  transfer: memberProcedure
    .input(bankTransferSchema)
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "create", "BankTransaction");
      if (input.fromAccountId === input.toAccountId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot transfer to the same account",
        });
      }

      const transferResult = await ctx.db.transaction(async (tx) => {
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

      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user!.id,
        action: "bankTransaction.transfer",
        entityType: "bankTransaction",
        entityId: transferResult.withdrawal.id,
        metadata: { amount: input.amount, fromAccountId: input.fromAccountId, toAccountId: input.toAccountId },
        ipAddress: ctx.ipAddress,
      });

      return transferResult;
    }),

  summary: viewerProcedure.query(async ({ ctx }) => {
    requireCan(ctx.ability, "read", "BankAccount");
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

  // ── Gateway Config ──────────────────────────────────────────

  getGatewayConfig: viewerProcedure
    .input(z.object({ bankAccountId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "BankAccount");
      const [config] = await ctx.db
        .select()
        .from(paymentGatewayConfigs)
        .where(
          and(
            eq(paymentGatewayConfigs.bankAccountId, input.bankAccountId),
            eq(paymentGatewayConfigs.businessId, ctx.businessId),
          )
        )
        .limit(1);

      return config ?? null;
    }),

  upsertGatewayConfig: memberProcedure
    .input(createPaymentGatewayConfigSchema)
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "BankAccount");

      // Validate bankAccountId is a payment_gateway type
      const [gatewayAccount] = await ctx.db
        .select({ id: bankAccounts.id, accountType: bankAccounts.accountType })
        .from(bankAccounts)
        .where(
          and(
            eq(bankAccounts.id, input.bankAccountId),
            eq(bankAccounts.businessId, ctx.businessId),
          )
        )
        .limit(1);

      if (!gatewayAccount) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Bank account not found" });
      }
      if (gatewayAccount.accountType !== "payment_gateway") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Gateway config can only be set on payment_gateway accounts",
        });
      }

      // Validate settlementAccountId is NOT a payment_gateway and belongs to same business
      const [settlementAccount] = await ctx.db
        .select({ id: bankAccounts.id, accountType: bankAccounts.accountType })
        .from(bankAccounts)
        .where(
          and(
            eq(bankAccounts.id, input.settlementAccountId),
            eq(bankAccounts.businessId, ctx.businessId),
          )
        )
        .limit(1);

      if (!settlementAccount) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Settlement account not found" });
      }
      if (settlementAccount.accountType === "payment_gateway") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Settlement account cannot be a payment_gateway account",
        });
      }

      // Upsert: insert or update on conflict (unique index on bankAccountId)
      const [config] = await ctx.db
        .insert(paymentGatewayConfigs)
        .values({
          businessId: ctx.businessId,
          bankAccountId: input.bankAccountId,
          settlementAccountId: input.settlementAccountId,
          chargeConfig: input.chargeConfig,
          expenseCategory: input.expenseCategory,
          autoSettle: input.autoSettle,
        })
        .onConflictDoUpdate({
          target: paymentGatewayConfigs.bankAccountId,
          set: {
            settlementAccountId: input.settlementAccountId,
            chargeConfig: input.chargeConfig,
            expenseCategory: input.expenseCategory,
            autoSettle: input.autoSettle,
            updatedAt: new Date(),
          },
        })
        .returning();

      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user!.id,
        action: "gatewayConfig.upsert",
        entityType: "paymentGatewayConfig",
        entityId: config.id,
        metadata: { bankAccountId: input.bankAccountId },
        ipAddress: ctx.ipAddress,
      });

      return config;
    }),

  deleteGatewayConfig: adminProcedure
    .input(z.object({ bankAccountId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "delete", "BankAccount");

      const [existing] = await ctx.db
        .select({ id: paymentGatewayConfigs.id })
        .from(paymentGatewayConfigs)
        .where(
          and(
            eq(paymentGatewayConfigs.bankAccountId, input.bankAccountId),
            eq(paymentGatewayConfigs.businessId, ctx.businessId),
          )
        )
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Gateway config not found" });
      }

      await ctx.db
        .delete(paymentGatewayConfigs)
        .where(
          and(
            eq(paymentGatewayConfigs.bankAccountId, input.bankAccountId),
            eq(paymentGatewayConfigs.businessId, ctx.businessId),
          )
        );

      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user!.id,
        action: "gatewayConfig.delete",
        entityType: "paymentGatewayConfig",
        entityId: existing.id,
        metadata: { bankAccountId: input.bankAccountId },
        ipAddress: ctx.ipAddress,
      });

      return { success: true };
    }),
});
