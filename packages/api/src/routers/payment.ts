import { eq, and, sql, desc, gte, lte, notInArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { payments, paymentAllocations, invoices, parties, businesses, bankAccounts, bankTransactions } from "@hisaabo/db";
import { createPaymentSchema, updatePaymentSchema, paginationSchema, money } from "@hisaabo/shared";
import { router, viewerProcedure, memberProcedure, adminProcedure } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";
import { logAudit } from "../lib/audit.js";
import { escapeLike } from "../lib/escape-like.js";
import { processGatewayPayment, reverseGatewayPayment } from "../lib/gateway.js";

export const paymentRouter = router({
  list: viewerProcedure
    .input(z.object({
      partyId: z.string().uuid().nullish(),
      invoiceId: z.string().uuid().nullish(),
      fromDate: z.string().datetime().nullish(),
      toDate: z.string().datetime().nullish(),
      search: z.string().nullish(),
      ...paginationSchema.shape,
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Payment");
      const conditions = [eq(payments.businessId, ctx.businessId), isNull(payments.deletedAt)];
      if (input.partyId) conditions.push(eq(payments.partyId, input.partyId));
      if (input.invoiceId) conditions.push(eq(payments.invoiceId, input.invoiceId));
      if (input.fromDate) conditions.push(gte(payments.paymentDate, new Date(input.fromDate)));
      if (input.toDate) conditions.push(lte(payments.paymentDate, new Date(input.toDate)));
      if (input.search) {
        conditions.push(
          sql`(${payments.paymentNumber} ILIKE ${'%' + escapeLike(input.search) + '%'} OR EXISTS (
            SELECT 1 FROM ${parties} p WHERE p.id = ${payments.partyId} AND p.name ILIKE ${'%' + escapeLike(input.search) + '%'}
          ))`
        );
      }

      const offset = (input.page - 1) * input.limit;

      const [data, [{ count }]] = await Promise.all([
        ctx.db.select({
          id: payments.id,
          paymentNumber: payments.paymentNumber,
          amount: payments.amount,
          discount: payments.discount,
          mode: payments.mode,
          paymentDate: payments.paymentDate,
          referenceNumber: payments.referenceNumber,
          notes: payments.notes,
          partyName: parties.name,
          partyId: parties.id,
          invoiceId: payments.invoiceId,
          bankAccountId: payments.bankAccountId,
        }).from(payments)
          .innerJoin(parties, eq(parties.id, payments.partyId))
          .where(and(...conditions))
          .orderBy(desc(payments.paymentDate))
          .limit(input.limit)
          .offset(offset),
        ctx.db.select({ count: sql<number>`count(*)::int` }).from(payments)
          .where(and(...conditions)),
      ]);

      return { data, total: count, page: input.page, limit: input.limit };
    }),

  // Return all unpaid/partially-paid invoices for a given party
  unpaidInvoices: viewerProcedure
    .input(z.object({ partyId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Invoice");
      const rows = await ctx.db.select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        invoiceDate: invoices.invoiceDate,
        totalAmount: invoices.totalAmount,
        amountPaid: invoices.amountPaid,
        status: invoices.status,
        type: invoices.type,
      })
        .from(invoices)
        .where(
          and(
            eq(invoices.businessId, ctx.businessId),
            eq(invoices.partyId, input.partyId),
            eq(invoices.documentType, "invoice"),
            notInArray(invoices.status, ["paid", "cancelled", "draft"]),
          )
        )
        .orderBy(invoices.invoiceDate);

      return rows.map((inv) => ({
        ...inv,
        balance: money.sub(inv.totalAmount, inv.amountPaid),
      }));
    }),

  // Return the default/most-recently-used bank account for this business
  defaultAccount: viewerProcedure
    .input(z.object({ partyId: z.string().uuid().optional() }).optional())
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "BankAccount");

      let defaultAccountId: string | null = null;

      // Priority 1: If partyId provided, check how this party has been paying
      if (input?.partyId) {
        const partyPayments = await ctx.db.select({ bankAccountId: payments.bankAccountId })
          .from(payments)
          .where(
            and(
              eq(payments.businessId, ctx.businessId),
              eq(payments.partyId, input.partyId),
              sql`${payments.bankAccountId} IS NOT NULL`,
            )
          )
          .orderBy(desc(payments.paymentDate))
          .limit(3);

        if (partyPayments.length > 0 && partyPayments[0].bankAccountId) {
          // Use the most recent payment method for this party
          defaultAccountId = partyPayments[0].bankAccountId;
        }
      }

      // Priority 2: Business-wide most common recent payment method
      if (!defaultAccountId) {
        const recentPayments = await ctx.db.select({ bankAccountId: payments.bankAccountId })
          .from(payments)
          .where(
            and(
              eq(payments.businessId, ctx.businessId),
              sql`${payments.bankAccountId} IS NOT NULL`,
            )
          )
          .orderBy(desc(payments.paymentDate))
          .limit(5);

        const freq: Record<string, number> = {};
        for (const p of recentPayments) {
          if (p.bankAccountId) {
            freq[p.bankAccountId] = (freq[p.bankAccountId] ?? 0) + 1;
          }
        }

        let maxFreq = 0;
        for (const [id, count] of Object.entries(freq)) {
          if (count > maxFreq) {
            maxFreq = count;
            defaultAccountId = id;
          }
        }
      }

      // Priority 3: Fall back to the isDefault account
      if (!defaultAccountId) {
        const [defAccount] = await ctx.db.select({ id: bankAccounts.id })
          .from(bankAccounts)
          .where(
            and(
              eq(bankAccounts.businessId, ctx.businessId),
              eq(bankAccounts.isDefault, true),
            )
          )
          .limit(1);
        defaultAccountId = defAccount?.id ?? null;
      }

      if (!defaultAccountId) return null;

      // Security: always scope the final fetch by businessId to prevent
      // returning a bank account that belongs to a different business (defence-in-depth).
      const [account] = await ctx.db.select({
        id: bankAccounts.id,
        accountName: bankAccounts.accountName,
        accountType: bankAccounts.accountType,
        currentBalance: bankAccounts.currentBalance,
        isDefault: bankAccounts.isDefault,
      })
        .from(bankAccounts)
        .where(and(
          eq(bankAccounts.id, defaultAccountId),
          eq(bankAccounts.businessId, ctx.businessId),
        ))
        .limit(1);

      return account ?? null;
    }),

  create: memberProcedure.input(createPaymentSchema).mutation(async ({ input, ctx }) => {
    requireCan(ctx.ability, "create", "Payment");
    const ipAddress = ctx.req.headers.get("x-forwarded-for") || ctx.req.headers.get("cf-connecting-ip") || null;
    const payment = await ctx.db.transaction(async (tx) => {
      // Security: validate that partyId belongs to the current business.
      const [partyCheck] = await tx.select({ id: parties.id })
        .from(parties)
        .where(and(eq(parties.id, input.partyId), eq(parties.businessId, ctx.businessId)))
        .limit(1);
      if (!partyCheck) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Party not found in this business" });
      }

      // Atomically generate payment number
      const [biz] = await tx.select({
        prefix: businesses.paymentPrefix,
        nextNum: businesses.nextPaymentNumber,
      }).from(businesses)
        .where(eq(businesses.id, ctx.businessId))
        .for("update");

      const paymentNumber = `${biz.prefix}-${String(biz.nextNum).padStart(5, "0")}`;

      await tx.update(businesses)
        .set({ nextPaymentNumber: biz.nextNum + 1 })
        .where(eq(businesses.id, ctx.businessId));

      // For multi-allocation payments, store the first invoice id as the primary reference
      // (for backward compat on the list view). For single-invoice, use input.invoiceId.
      const primaryInvoiceId = input.allocations?.length
        ? input.allocations[0].invoiceId
        : (input.invoiceId || null);

      const [payment] = await tx.insert(payments).values({
        businessId: ctx.businessId,
        partyId: input.partyId,
        invoiceId: primaryInvoiceId,
        amount: input.amount,
        discount: input.discount || "0",
        mode: input.mode,
        referenceNumber: input.referenceNumber,
        paymentDate: input.paymentDate ? new Date(input.paymentDate) : new Date(),
        notes: input.notes,
        paymentNumber,
        bankAccountId: input.bankAccountId || null,
        createdByUserId: ctx.user!.id,
        createdByName: ctx.user!.name,
      }).returning();

      // ── Invoice allocation logic ─────────────────────────────────────────
      const effectiveAllocations = input.allocations?.length
        ? input.allocations
        : input.invoiceId
          ? [{ invoiceId: input.invoiceId, amount: input.amount }]
          : [];

      for (const alloc of effectiveAllocations) {
        // Overpayment guard: lock invoice row with FOR UPDATE to prevent
        // concurrent payments from both passing the balance check
        const [invBefore] = await tx.select({
          totalAmount: invoices.totalAmount,
          amountPaid: invoices.amountPaid,
        }).from(invoices).where(and(eq(invoices.id, alloc.invoiceId), eq(invoices.businessId, ctx.businessId))).limit(1).for("update");

        if (invBefore) {
          const balance = money.sub(invBefore.totalAmount, invBefore.amountPaid);
          if (money.compare(alloc.amount, balance) > 0) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `Allocation ${alloc.amount} exceeds invoice balance ${balance}` });
          }
        }

        // Single SQL: update amountPaid and status atomically
        await tx.execute(sql`
          UPDATE invoices SET
            amount_paid = amount_paid::numeric + ${alloc.amount}::numeric,
            status = CASE
              WHEN (amount_paid::numeric + ${alloc.amount}::numeric) >= total_amount::numeric THEN 'paid'
              WHEN (amount_paid::numeric + ${alloc.amount}::numeric) > 0 THEN 'partial'
              ELSE status
            END,
            updated_at = NOW()
          WHERE id = ${alloc.invoiceId} AND business_id = ${ctx.businessId}
        `);
      }

      // ── Write payment allocations to junction table ──────────────────────
      if (effectiveAllocations.length > 0) {
        await tx.insert(paymentAllocations).values(
          effectiveAllocations.map((alloc) => ({
            paymentId: payment.id,
            invoiceId: alloc.invoiceId,
            amount: alloc.amount,
          }))
        );
      }

      // ── Bank account transaction ─────────────────────────────────────────
      if (input.bankAccountId) {
        const [account] = await tx
          .select({ currentBalance: bankAccounts.currentBalance })
          .from(bankAccounts)
          .where(
            and(
              eq(bankAccounts.id, input.bankAccountId),
              eq(bankAccounts.businessId, ctx.businessId)
            )
          )
          .for("update")
          .limit(1);

        if (account) {
          // Determine direction: sale payments are deposits, purchase payments are withdrawals.
          // Check the type of the first linked invoice if any.
          let txType: "deposit" | "withdrawal" = "deposit";
          if (effectiveAllocations.length > 0) {
            const [inv] = await tx.select({ type: invoices.type })
              .from(invoices)
              .where(eq(invoices.id, effectiveAllocations[0].invoiceId))
              .limit(1);
            if (inv?.type === "purchase") txType = "withdrawal";
          }

          const newBalance =
            txType === "deposit"
              ? money.add(account.currentBalance, input.amount)
              : money.sub(account.currentBalance, input.amount);

          await tx.insert(bankTransactions).values({
            businessId: ctx.businessId,
            bankAccountId: input.bankAccountId,
            type: txType,
            amount: input.amount,
            description: `Payment ${paymentNumber}`,
            referenceType: "payment",
            referenceId: payment.id,

            transactionDate: payment.paymentDate,
          });

          await tx.update(bankAccounts)
            .set({ currentBalance: newBalance, updatedAt: new Date() })
            .where(eq(bankAccounts.id, input.bankAccountId));
        }
      }

      // ── Gateway charge + settlement ─────────────────────────────────
      if (input.bankAccountId) {
        const [gwAccount] = await tx
          .select({ accountType: bankAccounts.accountType })
          .from(bankAccounts)
          .where(eq(bankAccounts.id, input.bankAccountId))
          .limit(1);

        if (gwAccount?.accountType === "payment_gateway") {
          await processGatewayPayment(tx, {
            businessId: ctx.businessId,
            paymentId: payment.id,
            paymentNumber: payment.paymentNumber ?? payment.id,
            bankAccountId: input.bankAccountId,
            amount: input.amount,
            mode: input.mode,
            paymentDate: payment.paymentDate,
          });
        }
      }

      return payment;
    });

    await logAudit(ctx.db, {
      businessId: ctx.businessId,
      userId: ctx.user!.id,
      action: "payment.create",
      entityType: "payment",
      entityId: payment.id,
      metadata: { paymentNumber: payment.paymentNumber, amount: payment.amount, mode: payment.mode },
      ipAddress,
    });

    return payment;
  }),

  getById: viewerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Payment");
      const [payment] = await ctx.db.select({
        id: payments.id,
        paymentNumber: payments.paymentNumber,
        amount: payments.amount,
        discount: payments.discount,
        mode: payments.mode,
        paymentDate: payments.paymentDate,
        referenceNumber: payments.referenceNumber,
        notes: payments.notes,
        partyId: payments.partyId,
        partyName: parties.name,
        invoiceId: payments.invoiceId,
        bankAccountId: payments.bankAccountId,
      }).from(payments)
        .innerJoin(parties, eq(parties.id, payments.partyId))
        .where(and(eq(payments.id, input.id), eq(payments.businessId, ctx.businessId)))
        .limit(1);

      if (!payment) return null;

      // Find all invoices this payment was allocated to via the allocations table
      const allocations = await ctx.db
        .select({
          invoiceId: paymentAllocations.invoiceId,
          allocAmount: paymentAllocations.amount,
          invoiceNumber: invoices.invoiceNumber,
          invoiceDate: invoices.invoiceDate,
          totalAmount: invoices.totalAmount,
          amountPaid: invoices.amountPaid,
          status: invoices.status,
        })
        .from(paymentAllocations)
        .innerJoin(invoices, eq(invoices.id, paymentAllocations.invoiceId))
        .where(eq(paymentAllocations.paymentId, input.id));

      // Fall back to single invoice_id if no allocations exist (legacy payments)
      let linkedInvoices = allocations.map(a => ({
        invoiceId: a.invoiceId,
        invoiceNumber: a.invoiceNumber,
        invoiceDate: a.invoiceDate,
        totalAmount: a.totalAmount,
        amountPaid: a.amountPaid,
        status: a.status,
        amount: a.allocAmount,
      }));

      if (linkedInvoices.length === 0 && payment.invoiceId) {
        const [inv] = await ctx.db.select({
          id: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          invoiceDate: invoices.invoiceDate,
          totalAmount: invoices.totalAmount,
          amountPaid: invoices.amountPaid,
          status: invoices.status,
        }).from(invoices).where(and(eq(invoices.id, payment.invoiceId), eq(invoices.businessId, ctx.businessId))).limit(1);
        if (inv) {
          linkedInvoices = [{
            invoiceId: inv.id,
            invoiceNumber: inv.invoiceNumber,
            invoiceDate: inv.invoiceDate,
            totalAmount: inv.totalAmount,
            amountPaid: inv.amountPaid,
            status: inv.status,
            amount: payment.amount,
          }];
        }
      }

      return { ...payment, linkedInvoices };
    }),

  update: memberProcedure.input(updatePaymentSchema).mutation(async ({ input, ctx }) => {
    requireCan(ctx.ability, "update", "Payment");
    const updated = await ctx.db.transaction(async (tx) => {
      // 1. Fetch the existing payment
      const [existing] = await tx.select()
        .from(payments)
        .where(and(eq(payments.id, input.id), eq(payments.businessId, ctx.businessId)))
        .for("update")
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Payment not found" });
      }

      // 2. Reverse old invoice allocations (per-allocation for multi-invoice payments)
      const existingAllocations = await tx.select({
        invoiceId: paymentAllocations.invoiceId,
        amount: paymentAllocations.amount,
      }).from(paymentAllocations).where(eq(paymentAllocations.paymentId, existing.id));

      if (existingAllocations.length > 0) {
        for (const alloc of existingAllocations) {
          await tx.execute(sql`
            UPDATE invoices SET
              amount_paid = GREATEST(amount_paid::numeric - ${alloc.amount}::numeric, 0),
              status = CASE
                WHEN GREATEST(amount_paid::numeric - ${alloc.amount}::numeric, 0) >= total_amount::numeric THEN 'paid'::invoice_status
                WHEN GREATEST(amount_paid::numeric - ${alloc.amount}::numeric, 0) > 0 THEN 'partial'::invoice_status
                ELSE 'sent'::invoice_status
              END,
              updated_at = NOW()
            WHERE id = ${alloc.invoiceId} AND business_id = ${ctx.businessId}
          `);
        }
        await tx.delete(paymentAllocations).where(eq(paymentAllocations.paymentId, existing.id));
      } else if (existing.invoiceId) {
        // Legacy fallback: no allocation rows, reverse full amount on single invoice
        await tx.execute(sql`
          UPDATE invoices SET
            amount_paid = GREATEST(amount_paid::numeric - ${existing.amount}::numeric, 0),
            status = CASE
              WHEN GREATEST(amount_paid::numeric - ${existing.amount}::numeric, 0) >= total_amount::numeric THEN 'paid'::invoice_status
              WHEN GREATEST(amount_paid::numeric - ${existing.amount}::numeric, 0) > 0 THEN 'partial'::invoice_status
              ELSE 'sent'::invoice_status
            END,
            updated_at = NOW()
          WHERE id = ${existing.invoiceId} AND business_id = ${ctx.businessId}
        `);
      }

      // 3a. Reverse old gateway operations (before reversing the main bank txn)
      await reverseGatewayPayment(tx, {
        businessId: ctx.businessId,
        paymentId: existing.id,
      });

      // 3b. Reverse old bank transaction
      if (existing.bankAccountId) {
        const [bankTxn] = await tx.select({ type: bankTransactions.type, amount: bankTransactions.amount })
          .from(bankTransactions)
          .where(and(
            eq(bankTransactions.referenceType, "payment"),
            eq(bankTransactions.referenceId, existing.id)
          ))
          .limit(1);

        if (bankTxn) {
          const [account] = await tx.select({ currentBalance: bankAccounts.currentBalance })
            .from(bankAccounts)
            .where(eq(bankAccounts.id, existing.bankAccountId))
            .for("update").limit(1);

          if (account) {
            const revBal = bankTxn.type === "deposit"
              ? money.sub(account.currentBalance, bankTxn.amount)
              : money.add(account.currentBalance, bankTxn.amount);
            await tx.update(bankAccounts)
              .set({ currentBalance: revBal, updatedAt: new Date() })
              .where(eq(bankAccounts.id, existing.bankAccountId));
          }

          await tx.delete(bankTransactions).where(and(
            eq(bankTransactions.referenceType, "payment"),
            eq(bankTransactions.referenceId, existing.id)
          ));
        }
      }

      // 4. Update payment record
      const newAmount = input.amount ?? existing.amount;
      const newMode = input.mode ?? existing.mode;
      const newBankAccountId = input.bankAccountId === null ? null : (input.bankAccountId ?? existing.bankAccountId);
      const newDate = input.paymentDate ? new Date(input.paymentDate) : existing.paymentDate;

      const primaryInvoiceId = input.allocations?.length
        ? input.allocations[0].invoiceId
        : existing.invoiceId;

      const [result] = await tx.update(payments)
        .set({
          amount: newAmount,
          discount: input.discount ?? existing.discount,
          mode: newMode,
          referenceNumber: input.referenceNumber === null ? null : (input.referenceNumber ?? existing.referenceNumber),
          notes: input.notes === null ? null : (input.notes ?? existing.notes),
          bankAccountId: newBankAccountId,
          paymentDate: newDate,
          invoiceId: primaryInvoiceId,
        })
        .where(and(eq(payments.id, input.id), eq(payments.businessId, ctx.businessId)))
        .returning();

      // 5. Apply new allocations
      const newAllocations = input.allocations?.length
        ? input.allocations
        : primaryInvoiceId
          ? [{ invoiceId: primaryInvoiceId, amount: newAmount }]
          : [];

      for (const alloc of newAllocations) {
        // Overpayment guard: lock invoice row with FOR UPDATE to prevent
        // concurrent payment updates from both passing the balance check
        const [invBefore] = await tx.select({
          totalAmount: invoices.totalAmount,
          amountPaid: invoices.amountPaid,
        }).from(invoices).where(and(eq(invoices.id, alloc.invoiceId), eq(invoices.businessId, ctx.businessId))).limit(1).for("update");

        if (invBefore) {
          const balance = money.sub(invBefore.totalAmount, invBefore.amountPaid);
          if (money.compare(alloc.amount, balance) > 0) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `Allocation ${alloc.amount} exceeds invoice balance ${balance}` });
          }
        }

        // Single SQL: update amountPaid and status atomically
        await tx.execute(sql`
          UPDATE invoices SET
            amount_paid = amount_paid::numeric + ${alloc.amount}::numeric,
            status = CASE
              WHEN (amount_paid::numeric + ${alloc.amount}::numeric) >= total_amount::numeric THEN 'paid'
              WHEN (amount_paid::numeric + ${alloc.amount}::numeric) > 0 THEN 'partial'
              ELSE status
            END,
            updated_at = NOW()
          WHERE id = ${alloc.invoiceId} AND business_id = ${ctx.businessId}
        `);
      }

      // Write new payment allocations to junction table
      if (newAllocations.length > 0) {
        await tx.insert(paymentAllocations).values(
          newAllocations.map((alloc) => ({
            paymentId: existing.id,
            invoiceId: alloc.invoiceId,
            amount: alloc.amount,
          }))
        );
      }

      // 6. Create new bank transaction if bank account set
      if (newBankAccountId) {
        const [account] = await tx.select({ currentBalance: bankAccounts.currentBalance })
          .from(bankAccounts)
          .where(and(eq(bankAccounts.id, newBankAccountId), eq(bankAccounts.businessId, ctx.businessId)))
          .for("update").limit(1);

        if (account) {
          let txType: "deposit" | "withdrawal" = "deposit";
          if (newAllocations.length > 0) {
            const [inv] = await tx.select({ type: invoices.type }).from(invoices)
              .where(eq(invoices.id, newAllocations[0].invoiceId)).limit(1);
            if (inv?.type === "purchase") txType = "withdrawal";
          }
          const newBal = txType === "deposit"
            ? money.add(account.currentBalance, newAmount)
            : money.sub(account.currentBalance, newAmount);

          await tx.insert(bankTransactions).values({
            businessId: ctx.businessId,
            bankAccountId: newBankAccountId,
            type: txType,
            amount: newAmount,
            description: `Payment ${existing.paymentNumber} (edited)`,
            referenceType: "payment",
            referenceId: existing.id,

            transactionDate: newDate,
          });

          await tx.update(bankAccounts)
            .set({ currentBalance: newBal, updatedAt: new Date() })
            .where(eq(bankAccounts.id, newBankAccountId));
        }
      }

      // 7. Process new gateway charge + settlement if the (new) account is a gateway
      if (newBankAccountId) {
        const [gwAccount] = await tx
          .select({ accountType: bankAccounts.accountType })
          .from(bankAccounts)
          .where(eq(bankAccounts.id, newBankAccountId))
          .limit(1);

        if (gwAccount?.accountType === "payment_gateway") {
          await processGatewayPayment(tx, {
            businessId: ctx.businessId,
            paymentId: existing.id,
            paymentNumber: existing.paymentNumber ?? existing.id,
            bankAccountId: newBankAccountId,
            amount: newAmount,
            mode: newMode,
            paymentDate: newDate,
          });
        }
      }

      return result;
    });

    logAudit(ctx.db, {
      businessId: ctx.businessId,
      userId: ctx.user!.id,
      action: "payment.update",
      entityType: "payment",
      entityId: updated.id,
      metadata: { paymentNumber: updated.paymentNumber },
      ipAddress: ctx.req.headers.get("x-forwarded-for"),
    });

    return updated;
  }),

  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "delete", "Payment");
      const ipAddress = ctx.req.headers.get("x-forwarded-for") || ctx.req.headers.get("cf-connecting-ip") || null;
      const result = await ctx.db.transaction(async (tx) => {
        const [payment] = await tx.select()
          .from(payments)
          .where(and(eq(payments.id, input.id), eq(payments.businessId, ctx.businessId)))
          .limit(1);

        if (!payment) return { success: false, payment: null };

        // Already soft-deleted — return early
        if (payment.deletedAt) return { success: true, payment: null };

        // Reverse invoice allocations (per-allocation for multi-invoice payments)
        const existingAllocations = await tx.select({
          invoiceId: paymentAllocations.invoiceId,
          amount: paymentAllocations.amount,
        }).from(paymentAllocations).where(eq(paymentAllocations.paymentId, payment.id));

        if (existingAllocations.length > 0) {
          for (const alloc of existingAllocations) {
            await tx.execute(sql`
              UPDATE invoices SET
                amount_paid = GREATEST(amount_paid::numeric - ${alloc.amount}::numeric, 0),
                status = CASE
                  WHEN GREATEST(amount_paid::numeric - ${alloc.amount}::numeric, 0) >= total_amount::numeric THEN 'paid'::invoice_status
                  WHEN GREATEST(amount_paid::numeric - ${alloc.amount}::numeric, 0) > 0 THEN 'partial'::invoice_status
                  ELSE 'sent'::invoice_status
                END,
                updated_at = NOW()
              WHERE id = ${alloc.invoiceId} AND business_id = ${ctx.businessId}
            `);
          }
          await tx.delete(paymentAllocations).where(eq(paymentAllocations.paymentId, payment.id));
        } else if (payment.invoiceId) {
          // Legacy fallback: no allocation rows, reverse full amount on single invoice
          await tx.execute(sql`
            UPDATE invoices SET
              amount_paid = GREATEST(amount_paid::numeric - ${payment.amount}::numeric, 0),
              status = CASE
                WHEN GREATEST(amount_paid::numeric - ${payment.amount}::numeric, 0) >= total_amount::numeric THEN 'paid'::invoice_status
                WHEN GREATEST(amount_paid::numeric - ${payment.amount}::numeric, 0) > 0 THEN 'partial'::invoice_status
                ELSE 'sent'::invoice_status
              END,
              updated_at = NOW()
            WHERE id = ${payment.invoiceId} AND business_id = ${ctx.businessId}
          `);
        }

        // Reverse gateway operations before the main bank txn reversal
        await reverseGatewayPayment(tx, {
          businessId: ctx.businessId,
          paymentId: payment.id,
        });

        // Reverse the bank transaction if applicable
        if (payment.bankAccountId) {
          const [account] = await tx
            .select({ currentBalance: bankAccounts.currentBalance })
            .from(bankAccounts)
            .where(eq(bankAccounts.id, payment.bankAccountId))
            .for("update")
            .limit(1);

          if (account) {
            // Find the original bank transaction for this payment
            const [bankTxn] = await tx
              .select({ type: bankTransactions.type, amount: bankTransactions.amount })
              .from(bankTransactions)
              .where(
                and(
                  eq(bankTransactions.referenceType, "payment"),
                  eq(bankTransactions.referenceId, payment.id)
                )
              )
              .limit(1);

            if (bankTxn) {
              // Reverse: if it was a deposit, now subtract; if withdrawal, now add
              const newBalance = bankTxn.type === "deposit"
                ? money.sub(account.currentBalance, bankTxn.amount)
                : money.add(account.currentBalance, bankTxn.amount);

              await tx.update(bankAccounts)
                .set({ currentBalance: newBalance, updatedAt: new Date() })
                .where(eq(bankAccounts.id, payment.bankAccountId));

              // Delete the associated bank transaction
              await tx.delete(bankTransactions).where(
                and(
                  eq(bankTransactions.referenceType, "payment"),
                  eq(bankTransactions.referenceId, payment.id)
                )
              );
            }
          }
        }

        // Soft delete: set deletedAt timestamp
        await tx.update(payments)
          .set({ deletedAt: new Date() })
          .where(eq(payments.id, input.id));
        return { success: true, payment };
      });

      if (result.success && result.payment) {
        await logAudit(ctx.db, {
          businessId: ctx.businessId,
          userId: ctx.user!.id,
          action: "payment.delete",
          entityType: "payment",
          entityId: input.id,
          metadata: { paymentNumber: result.payment.paymentNumber, amount: result.payment.amount },
          ipAddress,
        });
      }

      return { success: result.success };
    }),

  // Payments with no bank account assigned
  untrackedPayments: viewerProcedure
    .input(z.object({
      search: z.string().nullish(),
      mode: z.enum(["cash", "bank", "upi", "cheque", "other"]).nullish(),
      fromDate: z.string().datetime().nullish(),
      toDate: z.string().datetime().nullish(),
      ...paginationSchema.shape,
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Payment");
      const offset = (input.page - 1) * input.limit;

      const conditions = [
        eq(payments.businessId, ctx.businessId),
        sql`${payments.bankAccountId} IS NULL`,
      ];
      if (input.search) {
        conditions.push(
          sql`(${payments.paymentNumber} ILIKE ${'%' + escapeLike(input.search) + '%'} OR EXISTS (
            SELECT 1 FROM ${parties} p WHERE p.id = ${payments.partyId} AND p.name ILIKE ${'%' + escapeLike(input.search) + '%'}
          ))`
        );
      }
      if (input.mode) conditions.push(eq(payments.mode, input.mode));
      if (input.fromDate) conditions.push(gte(payments.paymentDate, new Date(input.fromDate)));
      if (input.toDate) conditions.push(lte(payments.paymentDate, new Date(input.toDate)));

      const [data, [{ count }]] = await Promise.all([
        ctx.db.select({
          id: payments.id,
          paymentNumber: payments.paymentNumber,
          amount: payments.amount,
          mode: payments.mode,
          paymentDate: payments.paymentDate,
          referenceNumber: payments.referenceNumber,
          partyName: parties.name,
          partyId: parties.id,
        }).from(payments)
          .innerJoin(parties, eq(parties.id, payments.partyId))
          .where(and(...conditions))
          .orderBy(desc(payments.paymentDate))
          .limit(input.limit)
          .offset(offset),
        ctx.db.select({ count: sql<number>`count(*)::int` }).from(payments)
          .where(and(...conditions)),
      ]);

      return { data, total: count, page: input.page, limit: input.limit };
    }),

  // Assign a bank account to untracked payments — by specific IDs or by filter (bulk all matching)
  assignAccount: memberProcedure
    .input(z.object({
      paymentIds: z.array(z.string().uuid()).optional(), // specific IDs
      allMatching: z.boolean().optional(), // true = assign ALL untracked matching filters
      search: z.string().nullish(),
      mode: z.enum(["cash", "bank", "upi", "cheque", "other"]).nullish(),
      bankAccountId: z.string().uuid(),
    }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Payment");
      const result = await ctx.db.transaction(async (tx) => {
        // Verify bank account exists and belongs to this business
        const [account] = await tx.select({
          id: bankAccounts.id,
          currentBalance: bankAccounts.currentBalance,
        })
          .from(bankAccounts)
          .where(and(
            eq(bankAccounts.id, input.bankAccountId),
            eq(bankAccounts.businessId, ctx.businessId),
          ))
          .for("update")
          .limit(1);

        if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });

        let totalDeposited = "0.00";

        // Resolve payment IDs — either from explicit list or by querying all matching untracked
        let paymentIds = input.paymentIds || [];
        if (input.allMatching) {
          const matchConditions = [
            eq(payments.businessId, ctx.businessId),
            sql`${payments.bankAccountId} IS NULL`,
          ];
          if (input.search) {
            matchConditions.push(
              sql`(${payments.paymentNumber} ILIKE ${'%' + escapeLike(input.search) + '%'} OR EXISTS (
                SELECT 1 FROM ${parties} p WHERE p.id = ${payments.partyId} AND p.name ILIKE ${'%' + escapeLike(input.search) + '%'}
              ))`
            );
          }
          if (input.mode) matchConditions.push(eq(payments.mode, input.mode));

          const allMatching = await tx.select({ id: payments.id })
            .from(payments)
            .where(and(...matchConditions));
          paymentIds = allMatching.map(p => p.id);
        }

        if (paymentIds.length === 0) return { assigned: 0 };

        for (const paymentId of paymentIds) {
          // Get the payment (only if untracked and owned by this business)
          const [pmt] = await tx.select({
            id: payments.id,
            amount: payments.amount,
            paymentDate: payments.paymentDate,
            paymentNumber: payments.paymentNumber,
            invoiceId: payments.invoiceId,
          }).from(payments)
            .where(and(
              eq(payments.id, paymentId),
              eq(payments.businessId, ctx.businessId),
              sql`${payments.bankAccountId} IS NULL`,
            ))
            .limit(1);

          if (!pmt) continue; // already assigned or not found

          // Update payment with bank account
          await tx.update(payments)
            .set({ bankAccountId: input.bankAccountId })
            .where(eq(payments.id, paymentId));

          // Determine deposit/withdrawal based on linked invoice type
          let txType: "deposit" | "withdrawal" = "deposit";
          if (pmt.invoiceId) {
            const [inv] = await tx.select({ type: invoices.type })
              .from(invoices)
              .where(eq(invoices.id, pmt.invoiceId))
              .limit(1);
            if (inv?.type === "purchase") txType = "withdrawal";
          }

          totalDeposited = txType === "deposit"
            ? money.add(totalDeposited, pmt.amount)
            : money.sub(totalDeposited, pmt.amount);

          // Calculate running balance after this transaction
          const _currentBal = money.add(account.currentBalance, totalDeposited);

          // Create bank transaction
          await tx.insert(bankTransactions).values({
            businessId: ctx.businessId,
            bankAccountId: input.bankAccountId,
            type: txType,
            amount: pmt.amount,
            description: `Payment ${pmt.paymentNumber || pmt.id} (assigned)`,
            referenceType: "payment",
            referenceId: pmt.id,

            transactionDate: pmt.paymentDate,
          });
        }

        // Update account balance once with net change
        await tx.update(bankAccounts)
          .set({
            currentBalance: sql`${bankAccounts.currentBalance}::numeric + ${totalDeposited}::numeric`,
            updatedAt: new Date(),
          })
          .where(eq(bankAccounts.id, input.bankAccountId));

        return { assigned: paymentIds.length, paymentIds };
      });

      if (result.assigned > 0 && result.paymentIds?.length) {
        logAudit(ctx.db, {
          businessId: ctx.businessId,
          userId: ctx.user!.id,
          action: "payment.reassignBankAccount",
          entityType: "payment",
          entityId: result.paymentIds[0],
          metadata: { paymentId: result.paymentIds[0], bankAccountId: input.bankAccountId, totalAssigned: result.assigned },
          ipAddress: ctx.req.headers.get("x-forwarded-for"),
        });
      }

      return { assigned: result.assigned };
    }),
});
