import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure } from "../../../trpc.js";
import { requireCan } from "../../../lib/permissions.js";
import { getAdapter } from "../adapters/registry.js";
import { canonicalInvoiceSchema } from "../types.js";
import { runInvoicesImport } from "../engine/invoices.js";

export const importInvoices = adminProcedure
  .input(z.object({
    source: z.string().default("mybillbook"),
    autoCreatePayments: z.boolean().default(false),
    defaultPaymentMode: z.enum(["cash", "bank", "upi", "cheque", "other"]).default("cash"),
    invoices: z.array(z.object({
      invoiceNumber: z.string().min(1),
      invoiceDate: z.string(),
      dueDate: z.string().optional(),
      partyName: z.string().min(1),
      type: z.enum(["sale", "purchase"]).default("sale"),
      status: z.enum(["draft", "sent", "paid", "partial", "overdue", "cancelled"]).default("sent"),
      subtotal: z.string().default("0"),
      taxAmount: z.string().default("0"),
      discountAmount: z.string().default("0"),
      totalAmount: z.string(),
      amountPaid: z.string().default("0"),
      charges: z.array(z.object({ label: z.string(), amount: z.string() })).optional(),
      paymentMode: z.string().optional(),
      notes: z.string().optional(),
      createdByName: z.string().optional(),
      lineItems: z.array(z.object({
        itemName: z.string().optional(),
        description: z.string(),
        quantity: z.string().default("1"),
        unit: z.string().optional(),
        conversionFactor: z.string().optional(),
        unitPrice: z.string(),
        taxPercent: z.string().default("0"),
        discountPercent: z.string().default("0"),
      })).optional(),
    })).max(5000),
  }))
  .mutation(async ({ input, ctx }) => {
    requireCan(ctx.ability, "manage", "Import");

    const adapter = getAdapter(input.source);

    const canonicalErrors: string[] = [];
    const canonicalInvoices = input.invoices
      .map((raw, idx) => {
        const transformed = adapter.transformInvoice(raw as Record<string, unknown>);
        if (!transformed) return null;
        const result = canonicalInvoiceSchema.safeParse(transformed);
        if (!result.success) {
          canonicalErrors.push(
            `Invoice ${(raw as { invoiceNumber?: string }).invoiceNumber || `row ${idx + 1}`}: ${result.error.issues.map(i => i.message).join("; ")}`
          );
          return null;
        }
        return result.data;
      })
      .filter(Boolean) as NonNullable<ReturnType<typeof canonicalInvoiceSchema.parse>>[];

    if (canonicalErrors.length > 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Validation errors:\n${canonicalErrors.join("\n")}`,
      });
    }

    return runInvoicesImport(
      ctx.db,
      ctx.businessId,
      ctx.user!,
      input.source,
      canonicalInvoices,
      {
        autoCreatePayments: input.autoCreatePayments,
        defaultPaymentMode: input.defaultPaymentMode,
      },
    );
  });
