import { eq, and, sql, desc, gte, lte, inArray, count } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { businesses, bankAccounts, controlDb, tenants, tenantMembers, auditLog, parties, items, invoices, invoiceItems, payments, expenses, users } from "@hisaabo/db";
import { createBusinessSchema, updateBusinessSchema, updateSequenceNumberSchema } from "@hisaabo/shared";
import { router, tenantProcedure, viewerProcedure, adminProcedure } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";
import { logAudit } from "../lib/audit.js";
import { enforceBusinessLimit, enforceDataExport, getLimits } from "../lib/plan-limits.js";
import { seedChartOfAccounts } from "../lib/coa-seed.js";
import { encryptCarrierCredentials, decryptCarrierCredentials } from "../lib/field-encryption.js";

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
    // Security: ctx.db is already scoped to the caller's tenant DB, so this
    // returns only businesses within the caller's tenant — no cross-tenant
    // access is possible. All businesses within a tenant are visible to every
    // tenant member so that they can switch between businesses.
    const rows = await ctx.db.select().from(businesses);
    return rows.map((biz) => ({
      ...biz,
      carrierCredentials: decryptCarrierCredentials(biz.carrierCredentials),
    }));
  }),

  // Check if more businesses can be created in this tenant (plan limit).
  canCreate: tenantProcedure.query(async ({ ctx }) => {
    const [row] = await controlDb.select({ plan: tenants.plan }).from(tenants).where(eq(tenants.id, ctx.tenantId)).limit(1);
    const limits = getLimits(row?.plan ?? "free");
    if (limits.maxBusinesses === Infinity) return true;
    const [{ count: bizCount }] = await ctx.db.select({ count: count() }).from(businesses);
    return bizCount < limits.maxBusinesses;
  }),

  getById: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      // Security: ctx.db is scoped to the caller's tenant. The WHERE on
      // businesses.id is sufficient because the DB itself is tenant-isolated.
      const [biz] = await ctx.db
        .select()
        .from(businesses)
        .where(eq(businesses.id, input.id))
        .limit(1);
      if (!biz) return null;
      // Decrypt carrier credentials if present
      return {
        ...biz,
        carrierCredentials: decryptCarrierCredentials(biz.carrierCredentials),
      };
    }),

  create: tenantProcedure.input(createBusinessSchema).mutation(async ({ input, ctx }) => {
    await requireTenantAdmin(ctx.user.id, ctx.tenantId!);
    await enforceBusinessLimit(ctx.tenantId!, ctx.db);
    const biz = await ctx.db.transaction(async (tx) => {
      const [biz] = await tx.insert(businesses).values({
        ...input,
        createdByUserId: ctx.user.id,
      }).returning();

      // Auto-create a Cash account for every new business — must be atomic with
      // business creation so a failed account insert never leaves a business
      // without its default Cash account.
      await tx.insert(bankAccounts).values({
        businessId: biz.id,
        accountName: "Cash",
        accountType: "cash",
        openingBalance: "0",
        currentBalance: "0",
        isDefault: false,
      });

      // Seed the default Chart of Accounts for this business — must be inside
      // the same transaction so a partial failure rolls back cleanly.
      await seedChartOfAccounts(tx, biz.id);

      return biz;
    });

    logAudit(ctx.db, {
      businessId: biz.id,
      userId: ctx.user.id,
      action: "business.create",
      entityType: "business",
      entityId: biz.id,
      metadata: { name: biz.name },
      ipAddress: ctx.req.headers.get("x-forwarded-for"),
    });

    return biz;
  }),

  update: tenantProcedure
    .input(z.object({ id: z.string().uuid(), data: updateBusinessSchema }))
    .mutation(async ({ input, ctx }) => {
      await requireTenantAdmin(ctx.user.id, ctx.tenantId!);

      // Encrypt carrier credentials if present in the update payload
      const data = { ...input.data } as Record<string, unknown>;
      if ("carrierCredentials" in data && data.carrierCredentials) {
        data.carrierCredentials = encryptCarrierCredentials(
          data.carrierCredentials as Parameters<typeof encryptCarrierCredentials>[0],
        );
      }

      const [biz] = await ctx.db
        .update(businesses)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(businesses.id, input.id))
        .returning();

      logAudit(ctx.db, {
        businessId: biz.id,
        userId: ctx.user.id,
        action: "business.update",
        entityType: "business",
        entityId: biz.id,
        metadata: { name: biz.name },
        ipAddress: ctx.req.headers.get("x-forwarded-for"),
      });

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

      logAudit(ctx.db, {
        businessId: input.businessId,
        userId: ctx.user.id,
        action: "business.updateSequenceNumber",
        entityType: "business",
        entityId: input.businessId,
        metadata: { field: input.documentType, value: input.newNumber },
        ipAddress: ctx.req.headers.get("x-forwarded-for"),
      });

      return { success: true, previousNumber: currentNumber, newNumber: input.newNumber };
    }),

  auditTrail: viewerProcedure
    .input(z.object({
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(50),
      fromDate: z.string().datetime().nullish(),
      toDate: z.string().datetime().nullish(),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");
      const offset = (input.page - 1) * input.limit;

      const conditions = [eq(auditLog.businessId, ctx.businessId)];
      if (input.fromDate) conditions.push(gte(auditLog.createdAt, new Date(input.fromDate)));
      if (input.toDate) conditions.push(lte(auditLog.createdAt, new Date(input.toDate)));

      const [data, [totalRow]] = await Promise.all([
        ctx.db.select()
          .from(auditLog)
          .where(and(...conditions))
          .orderBy(desc(auditLog.createdAt))
          .limit(input.limit)
          .offset(offset),
        ctx.db.select({ count: count() })
          .from(auditLog)
          .where(and(...conditions)),
      ]);

      // Resolve userIds → names via control DB (can't JOIN across DBs in cloud mode)
      const userIds = [...new Set(data.map((e) => e.userId))];
      const userRows = userIds.length > 0
        ? await controlDb
            .select({ id: users.id, name: users.name, email: users.email })
            .from(users)
            .where(inArray(users.id, userIds))
        : [];
      const userMap = new Map(userRows.map((u) => [u.id, u.name || u.email]));

      return {
        data: data.map((entry) => ({
          ...entry,
          userName: userMap.get(entry.userId) ?? "Unknown user",
        })),
        total: totalRow?.count ?? 0,
        page: input.page,
        limit: input.limit,
      };
    }),

  exportData: adminProcedure.mutation(async ({ ctx }) => {
    requireCan(ctx.ability, "manage", "Business");
    await enforceDataExport(ctx.tenantId!);
    const [partiesData, itemsData, invoicesData, lineItemsData, paymentsData, expensesData] = await Promise.all([
      ctx.db.select().from(parties).where(eq(parties.businessId, ctx.businessId)),
      // Historical export — include soft-deleted items so the user's
      // backup is a complete record of what ever lived in their catalog.
      // A soft-deleted row still carries its `deletedAt` column, which
      // the CSV schema ignores today (columns explicitly listed below);
      // callers that need it can reach into the raw rows directly.
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
      lineItems: toCsv(lineItemsData.map(r => r.invoice_items), ["invoiceId", "itemName", "description", "quantity", "unitPrice", "taxPercent", "taxAmount", "discountPercent", "totalAmount"]),
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
