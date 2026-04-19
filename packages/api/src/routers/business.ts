import { eq, and, sql, desc, gte, lte, inArray, count, getTableColumns } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { businesses, bankAccounts, controlDb, tenants, tenantMembers, auditLog, parties, items, invoices, invoiceItems, payments, expenses, users } from "@hisaabo/db";
import { createBusinessSchema, updateBusinessSchema, updateSequenceNumberSchema, uploadBusinessLogoSchema } from "@hisaabo/shared";
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
    //
    // `logoData` is intentionally excluded — sending logo bytes over tRPC on
    // every list call is wasteful. Consumers fetch the logo via the dedicated
    // HTTP endpoint using logoUpdatedAt as a cache-bust key.
    const { logoData: _logoData, ...cols } = getTableColumns(businesses);
    const rows = await ctx.db.select(cols).from(businesses);
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
      //
      // logoData excluded — fetched via dedicated /api/businesses/:id/logo.
      const { logoData: _logoData, ...cols } = getTableColumns(businesses);
      const [biz] = await ctx.db
        .select(cols)
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
      ipAddress: ctx.ipAddress,
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
        ipAddress: ctx.ipAddress,
      });

      return biz;
    }),

  // Upload a business logo. Stored as bytea on the businesses row so it
  // round-trips through pg_dump, pg_basebackup, and the self-export NDJSON
  // without any extra plumbing.
  //
  // Security notes:
  // - We NEVER trust the declared MIME — magic bytes are re-checked here.
  // - Decoded size is re-asserted against the 1MB cap after base64 decode.
  // - SVG is not stored (no SVG parser surface on the server). Clients that
  //   want to upload SVG must rasterize to PNG in-browser first.
  uploadLogo: tenantProcedure
    .input(z.object({ id: z.string().uuid(), data: uploadBusinessLogoSchema }))
    .mutation(async ({ input, ctx }) => {
      await requireTenantAdmin(ctx.user.id, ctx.tenantId!);

      const match = /^data:(image\/png|image\/jpeg);base64,(.+)$/.exec(input.data.dataUrl);
      if (!match) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid image data URL" });
      }
      const declaredMime = match[1]!;
      const base64 = match[2]!;
      const bytes = Buffer.from(base64, "base64");

      if (bytes.length > 1_048_576) {
        throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "Logo must be ≤ 1MB after decoding" });
      }

      // Magic-byte check — authoritative. PNG: 89 50 4E 47 0D 0A 1A 0A.
      // JPEG: FF D8 FF.
      const isPng = bytes.length >= 8 &&
        bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
        bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
      const isJpeg = bytes.length >= 3 &&
        bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

      let actualMime: string;
      if (isPng) actualMime = "image/png";
      else if (isJpeg) actualMime = "image/jpeg";
      else throw new TRPCError({ code: "BAD_REQUEST", message: "File is not a valid PNG or JPEG" });

      if (actualMime !== declaredMime) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Declared MIME does not match file contents" });
      }

      const [biz] = await ctx.db
        .update(businesses)
        .set({
          logoData: bytes,
          logoMimeType: actualMime,
          logoWidth: input.data.width,
          logoHeight: input.data.height,
          logoUpdatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(businesses.id, input.id))
        .returning({ id: businesses.id, logoUpdatedAt: businesses.logoUpdatedAt });

      if (!biz) throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });

      logAudit(ctx.db, {
        businessId: biz.id,
        userId: ctx.user.id,
        action: "business.uploadLogo",
        entityType: "business",
        entityId: biz.id,
        metadata: { bytes: bytes.length, mime: actualMime, width: input.data.width, height: input.data.height },
        ipAddress: ctx.ipAddress,
      });

      return { logoUpdatedAt: biz.logoUpdatedAt };
    }),

  deleteLogo: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await requireTenantAdmin(ctx.user.id, ctx.tenantId!);

      const [biz] = await ctx.db
        .update(businesses)
        .set({
          logoData: null,
          logoMimeType: null,
          logoWidth: null,
          logoHeight: null,
          logoUpdatedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(businesses.id, input.id))
        .returning({ id: businesses.id });

      if (!biz) throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });

      logAudit(ctx.db, {
        businessId: biz.id,
        userId: ctx.user.id,
        action: "business.deleteLogo",
        entityType: "business",
        entityId: biz.id,
        ipAddress: ctx.ipAddress,
      });

      return { ok: true };
    }),

  updateSequenceNumber: adminProcedure
    .input(updateSequenceNumberSchema)
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "manage", "Business");

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
        .where(eq(businesses.id, ctx.businessId))
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
        sql`UPDATE businesses SET ${sql.identifier(column)} = ${input.newNumber} WHERE id = ${ctx.businessId}`
      );

      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user.id,
        action: "business.updateSequenceNumber",
        entityType: "business",
        entityId: ctx.businessId,
        metadata: { field: input.documentType, value: input.newNumber },
        ipAddress: ctx.ipAddress,
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
