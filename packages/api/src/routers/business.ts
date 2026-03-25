import { eq, and, sql, desc } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { businesses, bankAccounts, controlDb, tenantMembers, auditLog, parties, items, invoices, invoiceItems, payments, expenses } from "@hisaabo/db";
import { createBusinessSchema, updateBusinessSchema, updateSequenceNumberSchema } from "@hisaabo/shared";
import { router, tenantProcedure, viewerProcedure, adminProcedure } from "../trpc.js";

async function requireTenantAdmin(userId: string, tenantId: string) {
  const [membership] = await controlDb
    .select({ role: tenantMembers.role })
    .from(tenantMembers)
    .where(and(
      eq(tenantMembers.tenantId, tenantId),
      eq(tenantMembers.userId, userId),
    ))
    .limit(1);
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only admins can manage businesses" });
  }
}

export const businessRouter = router({
  list: tenantProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(businesses);
  }),

  getById: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const [biz] = await ctx.db
        .select()
        .from(businesses)
        .where(eq(businesses.id, input.id))
        .limit(1);
      return biz ?? null;
    }),

  create: tenantProcedure.input(createBusinessSchema).mutation(async ({ input, ctx }) => {
    await requireTenantAdmin(ctx.user.id, ctx.tenantId!);
    const [biz] = await ctx.db.insert(businesses).values({
      ...input,
      createdByUserId: ctx.user.id,
    }).returning();

    // Auto-create a Cash account for every new business
    await ctx.db.insert(bankAccounts).values({
      businessId: biz.id,
      accountName: "Cash",
      accountType: "cash",
      openingBalance: "0",
      currentBalance: "0",
      isDefault: false,
    });

    return biz;
  }),

  update: tenantProcedure
    .input(z.object({ id: z.string().uuid(), data: updateBusinessSchema }))
    .mutation(async ({ input, ctx }) => {
      await requireTenantAdmin(ctx.user.id, ctx.tenantId!);
      const [biz] = await ctx.db
        .update(businesses)
        .set({ ...input.data, updatedAt: new Date() })
        .where(eq(businesses.id, input.id))
        .returning();
      return biz;
    }),

  updateSequenceNumber: tenantProcedure
    .input(z.object({ businessId: z.string().uuid(), ...updateSequenceNumberSchema.shape }))
    .mutation(async ({ input, ctx }) => {
      await requireTenantAdmin(ctx.user.id, ctx.tenantId!);

      // Map documentType to the correct counter column
      const counterColumns: Record<string, string> = {
        invoice: "next_invoice_number",
        payment: "next_payment_number",
        quotation: "next_quotation_number",
        credit_note: "next_credit_note_number",
        delivery_challan: "next_delivery_challan_number",
        proforma: "next_proforma_number",
      };

      const column = counterColumns[input.documentType];
      if (!column) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid document type" });

      // Verify new number >= current number (can't go backwards)
      const [biz] = await ctx.db
        .select()
        .from(businesses)
        .where(eq(businesses.id, input.businessId))
        .limit(1);

      if (!biz) throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });

      const currentNumber = (biz as any)[column.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] as number;

      if (input.newNumber < currentNumber) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `New number (${input.newNumber}) cannot be less than current (${currentNumber})`,
        });
      }

      // Update using raw SQL for dynamic column name
      await ctx.db.execute(
        sql`UPDATE businesses SET ${sql.identifier(column)} = ${input.newNumber} WHERE id = ${input.businessId}`
      );

      return { success: true, previousNumber: currentNumber, newNumber: input.newNumber };
    }),

  auditTrail: viewerProcedure
    .input(z.object({
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(50),
    }))
    .query(async ({ input, ctx }) => {
      const offset = (input.page - 1) * input.limit;
      const data = await ctx.db.select()
        .from(auditLog)
        .where(eq(auditLog.businessId, ctx.businessId))
        .orderBy(desc(auditLog.createdAt))
        .limit(input.limit)
        .offset(offset);
      return { data, page: input.page, limit: input.limit };
    }),

  exportData: adminProcedure.mutation(async ({ ctx }) => {
    const [partiesData, itemsData, invoicesData, lineItemsData, paymentsData, expensesData] = await Promise.all([
      ctx.db.select().from(parties).where(eq(parties.businessId, ctx.businessId)),
      ctx.db.select().from(items).where(eq(items.businessId, ctx.businessId)),
      ctx.db.select().from(invoices).where(eq(invoices.businessId, ctx.businessId)).orderBy(invoices.invoiceDate),
      ctx.db
        .select({ invoice_items: invoiceItems })
        .from(invoiceItems)
        .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
        .where(eq(invoices.businessId, ctx.businessId)),
      ctx.db.select().from(payments).where(eq(payments.businessId, ctx.businessId)).orderBy(payments.paymentDate),
      ctx.db.select().from(expenses).where(eq(expenses.businessId, ctx.businessId)).orderBy(expenses.expenseDate),
    ]);

    return {
      parties: toCsv(partiesData, ["name", "type", "phone", "email", "gstin", "billingAddress", "city", "state", "pincode", "openingBalance", "category"]),
      items: toCsv(itemsData, ["name", "itemType", "unit", "salePrice", "purchasePrice", "taxPercent", "hsn", "sku", "stockQuantity", "category"]),
      invoices: toCsv(invoicesData, ["invoiceNumber", "type", "documentType", "invoiceDate", "dueDate", "status", "subtotal", "taxAmount", "discountAmount", "totalAmount", "amountPaid", "notes"]),
      lineItems: toCsv(lineItemsData.map(r => r.invoice_items), ["invoiceId", "description", "quantity", "unitPrice", "taxPercent", "taxAmount", "discountPercent", "totalAmount"]),
      payments: toCsv(paymentsData, ["paymentNumber", "paymentDate", "amount", "mode", "referenceNumber", "notes"]),
      expenses: toCsv(expensesData, ["category", "description", "amount", "mode", "expenseDate", "referenceNumber"]),
    };
  }),
});

function toCsv<T extends Record<string, unknown>>(data: T[], fields: string[]): string {
  const header = fields.join(",");
  const rows = data.map(row =>
    fields.map(f => {
      const val = row[f];
      if (val === null || val === undefined) return "";
      const str = val instanceof Date ? val.toISOString() : String(val);
      return str.includes(",") || str.includes('"') || str.includes("\n")
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    }).join(",")
  );
  return [header, ...rows].join("\n");
}
