import { eq, and, sql, desc, gte, lte, notInArray } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { payments, invoices, parties, businesses, bankAccounts, bankTransactions } from "@hisaabo/db";
import { createPaymentSchema, updatePaymentSchema, paginationSchema, money } from "@hisaabo/shared";
import { router, viewerProcedure, memberProcedure, adminProcedure } from "../trpc.js";

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
      const conditions = [eq(payments.businessId, ctx.businessId)];
      if (input.partyId) conditions.push(eq(payments.partyId, input.partyId));
      if (input.invoiceId) conditions.push(eq(payments.invoiceId, input.invoiceId));
      if (input.fromDate) conditions.push(gte(payments.paymentDate, new Date(input.fromDate)));
      if (input.toDate) conditions.push(lte(payments.paymentDate, new Date(input.toDate)));
      if (input.search) {
        conditions.push(
          sql`(${payments.paymentNumber} ILIKE ${'%' + input.search + '%'} OR EXISTS (
            SELECT 1 FROM ${parties} p WHERE p.id = ${payments.partyId} AND p.name ILIKE ${'%' + input.search + '%'}
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
    .query(async ({ ctx }) => {
      // Look at the last 5 payments that have a bankAccountId
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

      // Find most common bankAccountId
      const freq: Record<string, number> = {};
      for (const p of recentPayments) {
        if (p.bankAccountId) {
          freq[p.bankAccountId] = (freq[p.bankAccountId] ?? 0) + 1;
        }
      }

      let defaultAccountId: string | null = null;
      let maxFreq = 0;
      for (const [id, count] of Object.entries(freq)) {
        if (count > maxFreq) {
          maxFreq = count;
          defaultAccountId = id;
        }
      }

      // Fall back to the isDefault account
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

      const [account] = await ctx.db.select({
        id: bankAccounts.id,
        accountName: bankAccounts.accountName,
        accountType: bankAccounts.accountType,
        currentBalance: bankAccounts.currentBalance,
        isDefault: bankAccounts.isDefault,
      })
        .from(bankAccounts)
        .where(eq(bankAccounts.id, defaultAccountId))
        .limit(1);

      return account ?? null;
    }),

  create: memberProcedure.input(createPaymentSchema).mutation(async ({ input, ctx }) => {
    return ctx.db.transaction(async (tx) => {
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
        await tx.update(invoices)
          .set({
            amountPaid: sql`${invoices.amountPaid}::numeric + ${alloc.amount}::numeric`,
            updatedAt: new Date(),
          })
          .where(and(eq(invoices.id, alloc.invoiceId), eq(invoices.businessId, ctx.businessId)));

        // Auto-update invoice status based on new amountPaid
        const [inv] = await tx.select({
          totalAmount: invoices.totalAmount,
          amountPaid: invoices.amountPaid,
        }).from(invoices).where(and(eq(invoices.id, alloc.invoiceId), eq(invoices.businessId, ctx.businessId))).limit(1);

        if (inv) {
          const total = parseFloat(inv.totalAmount);
          const paid = parseFloat(inv.amountPaid);
          const newStatus = paid >= total ? "paid" : paid > 0 ? "partial" : undefined;
          if (newStatus) {
            await tx.update(invoices)
              .set({ status: newStatus })
              .where(and(eq(invoices.id, alloc.invoiceId), eq(invoices.businessId, ctx.businessId)));
          }
        }
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
          const currentBalance = parseFloat(account.currentBalance);
          const amount = parseFloat(input.amount);

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
            txType === "deposit" ? currentBalance + amount : currentBalance - amount;

          await tx.insert(bankTransactions).values({
            businessId: ctx.businessId,
            bankAccountId: input.bankAccountId,
            type: txType,
            amount: input.amount,
            description: `Payment ${paymentNumber}`,
            referenceType: "payment",
            referenceId: payment.id,
            balanceAfter: newBalance.toFixed(2),
            transactionDate: payment.paymentDate,
          });

          await tx.update(bankAccounts)
            .set({ currentBalance: newBalance.toFixed(2), updatedAt: new Date() })
            .where(eq(bankAccounts.id, input.bankAccountId));
        }
      }

      return payment;
    });
  }),

  getById: viewerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
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

      // Find all invoices this payment was allocated to.
      // For now, the payment only stores one invoiceId (primary). In future we may add
      // a payment_allocations join table. For now, return the single linked invoice.
      const linkedInvoices: Array<{
        invoiceId: string;
        invoiceNumber: string;
        invoiceDate: Date;
        totalAmount: string;
        amountPaid: string;
        status: string;
        amount: string;
      }> = [];
      if (payment.invoiceId) {
        const [inv] = await ctx.db.select({
          id: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          invoiceDate: invoices.invoiceDate,
          totalAmount: invoices.totalAmount,
          amountPaid: invoices.amountPaid,
          status: invoices.status,
        }).from(invoices).where(eq(invoices.id, payment.invoiceId)).limit(1);
        if (inv) {
          linkedInvoices.push({
            invoiceId: inv.id,
            invoiceNumber: inv.invoiceNumber,
            invoiceDate: inv.invoiceDate,
            totalAmount: inv.totalAmount,
            amountPaid: inv.amountPaid,
            status: inv.status,
            amount: payment.amount,
          });
        }
      }

      return { ...payment, linkedInvoices };
    }),

  update: memberProcedure.input(updatePaymentSchema).mutation(async ({ input, ctx }) => {
    return ctx.db.transaction(async (tx) => {
      // 1. Fetch the existing payment
      const [existing] = await tx.select()
        .from(payments)
        .where(and(eq(payments.id, input.id), eq(payments.businessId, ctx.businessId)))
        .for("update")
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Payment not found" });
      }

      // 2. Reverse old invoice allocation
      if (existing.invoiceId) {
        await tx.update(invoices)
          .set({
            amountPaid: sql`GREATEST(${invoices.amountPaid}::numeric - ${existing.amount}::numeric, 0)`,
            updatedAt: new Date(),
          })
          .where(and(eq(invoices.id, existing.invoiceId), eq(invoices.businessId, ctx.businessId)));

        // Recompute old invoice status
        const [oldInv] = await tx.select({
          totalAmount: invoices.totalAmount,
          amountPaid: invoices.amountPaid,
        }).from(invoices).where(and(eq(invoices.id, existing.invoiceId), eq(invoices.businessId, ctx.businessId))).limit(1);
        if (oldInv) {
          const paid = parseFloat(oldInv.amountPaid);
          const total = parseFloat(oldInv.totalAmount);
          const newStatus = paid >= total ? "paid" : paid > 0 ? "partial" : "sent";
          await tx.update(invoices).set({ status: newStatus }).where(and(eq(invoices.id, existing.invoiceId), eq(invoices.businessId, ctx.businessId)));
        }
      }

      // 3. Reverse old bank transaction
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
            const bal = parseFloat(account.currentBalance);
            const amt = parseFloat(bankTxn.amount);
            const revBal = bankTxn.type === "deposit" ? bal - amt : bal + amt;
            await tx.update(bankAccounts)
              .set({ currentBalance: revBal.toFixed(2), updatedAt: new Date() })
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

      const [updated] = await tx.update(payments)
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
        .where(eq(payments.id, input.id))
        .returning();

      // 5. Apply new allocations
      const newAllocations = input.allocations?.length
        ? input.allocations
        : primaryInvoiceId
          ? [{ invoiceId: primaryInvoiceId, amount: newAmount }]
          : [];

      for (const alloc of newAllocations) {
        await tx.update(invoices)
          .set({
            amountPaid: sql`${invoices.amountPaid}::numeric + ${alloc.amount}::numeric`,
            updatedAt: new Date(),
          })
          .where(and(eq(invoices.id, alloc.invoiceId), eq(invoices.businessId, ctx.businessId)));

        const [inv] = await tx.select({
          totalAmount: invoices.totalAmount,
          amountPaid: invoices.amountPaid,
        }).from(invoices).where(and(eq(invoices.id, alloc.invoiceId), eq(invoices.businessId, ctx.businessId))).limit(1);
        if (inv) {
          const total = parseFloat(inv.totalAmount);
          const paid = parseFloat(inv.amountPaid);
          const newStatus = paid >= total ? "paid" : paid > 0 ? "partial" : undefined;
          if (newStatus) {
            await tx.update(invoices).set({ status: newStatus }).where(and(eq(invoices.id, alloc.invoiceId), eq(invoices.businessId, ctx.businessId)));
          }
        }
      }

      // 6. Create new bank transaction if bank account set
      if (newBankAccountId) {
        const [account] = await tx.select({ currentBalance: bankAccounts.currentBalance })
          .from(bankAccounts)
          .where(and(eq(bankAccounts.id, newBankAccountId), eq(bankAccounts.businessId, ctx.businessId)))
          .for("update").limit(1);

        if (account) {
          const bal = parseFloat(account.currentBalance);
          const amt = parseFloat(newAmount);
          let txType: "deposit" | "withdrawal" = "deposit";
          if (newAllocations.length > 0) {
            const [inv] = await tx.select({ type: invoices.type }).from(invoices)
              .where(eq(invoices.id, newAllocations[0].invoiceId)).limit(1);
            if (inv?.type === "purchase") txType = "withdrawal";
          }
          const newBal = txType === "deposit" ? bal + amt : bal - amt;

          await tx.insert(bankTransactions).values({
            businessId: ctx.businessId,
            bankAccountId: newBankAccountId,
            type: txType,
            amount: newAmount,
            description: `Payment ${existing.paymentNumber} (edited)`,
            referenceType: "payment",
            referenceId: existing.id,
            balanceAfter: newBal.toFixed(2),
            transactionDate: newDate,
          });

          await tx.update(bankAccounts)
            .set({ currentBalance: newBal.toFixed(2), updatedAt: new Date() })
            .where(eq(bankAccounts.id, newBankAccountId));
        }
      }

      return updated;
    });
  }),

  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.db.transaction(async (tx) => {
        const [payment] = await tx.select()
          .from(payments)
          .where(and(eq(payments.id, input.id), eq(payments.businessId, ctx.businessId)))
          .limit(1);

        if (!payment) return { success: false };

        // Reverse the invoice amount if linked
        if (payment.invoiceId) {
          await tx.update(invoices)
            .set({
              amountPaid: sql`GREATEST(${invoices.amountPaid}::numeric - ${payment.amount}::numeric, 0)`,
              updatedAt: new Date(),
            })
            .where(eq(invoices.id, payment.invoiceId));
        }

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
              const currentBalance = parseFloat(account.currentBalance);
              const amount = parseFloat(bankTxn.amount);
              // Reverse: if it was a deposit, now subtract; if withdrawal, now add
              const newBalance =
                bankTxn.type === "deposit"
                  ? currentBalance - amount
                  : currentBalance + amount;

              await tx.update(bankAccounts)
                .set({ currentBalance: newBalance.toFixed(2), updatedAt: new Date() })
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

        await tx.delete(payments).where(eq(payments.id, input.id));
        return { success: true };
      });
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
      const offset = (input.page - 1) * input.limit;

      const conditions = [
        eq(payments.businessId, ctx.businessId),
        sql`${payments.bankAccountId} IS NULL`,
      ];
      if (input.search) {
        conditions.push(
          sql`(${payments.paymentNumber} ILIKE ${'%' + input.search + '%'} OR EXISTS (
            SELECT 1 FROM ${parties} p WHERE p.id = ${payments.partyId} AND p.name ILIKE ${'%' + input.search + '%'}
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
      return ctx.db.transaction(async (tx) => {
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

        let totalDeposited = 0;

        // Resolve payment IDs — either from explicit list or by querying all matching untracked
        let paymentIds = input.paymentIds || [];
        if (input.allMatching) {
          const matchConditions = [
            eq(payments.businessId, ctx.businessId),
            sql`${payments.bankAccountId} IS NULL`,
          ];
          if (input.search) {
            matchConditions.push(
              sql`(${payments.paymentNumber} ILIKE ${'%' + input.search + '%'} OR EXISTS (
                SELECT 1 FROM ${parties} p WHERE p.id = ${payments.partyId} AND p.name ILIKE ${'%' + input.search + '%'}
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

          const amount = parseFloat(pmt.amount);
          totalDeposited += txType === "deposit" ? amount : -amount;

          // Calculate running balance after this transaction
          const currentBal = parseFloat(account.currentBalance) + totalDeposited;

          // Create bank transaction
          await tx.insert(bankTransactions).values({
            businessId: ctx.businessId,
            bankAccountId: input.bankAccountId,
            type: txType,
            amount: pmt.amount,
            description: `Payment ${pmt.paymentNumber || pmt.id} (assigned)`,
            referenceType: "payment",
            referenceId: pmt.id,
            balanceAfter: currentBal.toFixed(2),
            transactionDate: pmt.paymentDate,
          });
        }

        // Update account balance once with net change
        await tx.update(bankAccounts)
          .set({
            currentBalance: sql`${bankAccounts.currentBalance}::numeric + ${totalDeposited.toFixed(2)}::numeric`,
            updatedAt: new Date(),
          })
          .where(eq(bankAccounts.id, input.bankAccountId));

        return { assigned: paymentIds.length };
      });
    }),
});
