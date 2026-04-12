import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure } from "../../../trpc.js";
import { requireCan } from "../../../lib/permissions.js";
import { getAdapter } from "../adapters/registry.js";
import { canonicalPaymentSchema } from "../types.js";
import { runPaymentsImport, runReconcileDirectPayments } from "../engine/payments.js";

export const importPayments = adminProcedure
  .input(z.object({
    source: z.string().default("mybillbook"),
    // Invoice numbers that were marked "Paid" in the source system.
    // After C&B allocation, any of these still without full payment get auto-payments.
    paidInvoiceNumbers: z.array(z.string()).max(5000).default([]),
    payments: z.array(z.object({
      paymentNumber: z.string().optional(),
      paymentDate: z.string(),
      partyName: z.string().min(1),
      amount: z.string(),
      mode: z.enum(["cash", "bank", "upi", "cheque", "other"]).default("cash"),
      referenceNumber: z.string().optional(),
      notes: z.string().optional(),
      invoiceNumbers: z.array(z.string()).optional(), // explicit invoice linkage from CSV
    })).max(5000),
  }))
  .mutation(async ({ input, ctx }) => {
    requireCan(ctx.ability, "manage", "Import");

    const adapter = getAdapter(input.source);

    const canonicalErrors: string[] = [];
    const canonicalPayments = input.payments
      .map((raw, idx) => {
        const transformed = adapter.transformPayment(raw as Record<string, unknown>);
        if (!transformed) return null;
        const result = canonicalPaymentSchema.safeParse(transformed);
        if (!result.success) {
          canonicalErrors.push(`Row ${idx + 1}: ${result.error.issues.map(i => i.message).join("; ")}`);
          return null;
        }
        return result.data;
      })
      .filter(Boolean) as NonNullable<ReturnType<typeof canonicalPaymentSchema.parse>>[];

    if (canonicalErrors.length > 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Validation errors:\n${canonicalErrors.join("\n")}`,
      });
    }

    return runPaymentsImport(
      ctx.db,
      ctx.businessId,
      ctx.user!,
      input.source,
      canonicalPayments,
      input.paidInvoiceNumbers,
    );
  });

export const reconcileDirectPayments = adminProcedure
  .input(z.object({
    source: z.string().default("mybillbook"),
    excludeInvoiceIds: z.array(z.string()).default([]),
  }))
  .mutation(async ({ input, ctx }) => {
    requireCan(ctx.ability, "manage", "Import");
    // reconcileDirectPayments reads from DB (not import data), so no adapter is needed
    return runReconcileDirectPayments(
      ctx.db,
      ctx.businessId,
      ctx.user!,
      input.source,
      input.excludeInvoiceIds,
    );
  });
