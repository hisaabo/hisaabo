/**
 * eInvoice.ts — tRPC router for E-Invoicing (IRP) operations.
 *
 * WHY THIS FILE EXISTS:
 * Indian GST law mandates e-invoicing for businesses above the threshold
 * turnover. This router handles the complete e-invoice lifecycle:
 *   - Configure IRP credentials per business
 *   - Generate IRN (Invoice Reference Number) by submitting to NIC IRP
 *   - Cancel IRN within the 24-hour cancellation window
 *   - Dashboard with e-invoice status tracking and filtering
 *
 * Permission model:
 *   - EInvoice:manage → admin/superadmin only (configure, generate, cancel)
 *   - EInvoice:read → accountants can view dashboard and status
 */

import { eq, and, sql, desc, isNull, isNotNull, inArray } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  eInvoiceConfigs,
  invoices,
  invoiceItems,
  parties,
  businesses,
  items,
} from "@hisaabo/db";
import {
  eInvoiceConfigSchema,
  cancelEInvoiceSchema,
  paginationSchema,
} from "@hisaabo/shared";
import { router, viewerProcedure, adminProcedure } from "../trpc.js";
import type { TenantDatabase } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";
import { escapeLike } from "../lib/escape-like.js";
import { IRPClient, IRPError } from "../lib/irp-client.js";
import { mapInvoiceToIRP } from "../lib/invoice-to-irp.js";
import { encryptEInvoiceConfig, decryptEInvoiceConfig } from "../lib/field-encryption.js";

// ── Shared helper ─────────────────────────────────────────────────────────────

/**
 * Shared logic for generating an IRN. Used by both `generate` and `retryFailed`.
 * Fetches all needed data, maps to IRP JSON, submits, and updates the invoice.
 */
async function generateIRNForInvoice(
  invoiceId: string,
  businessId: string,
  db: TenantDatabase,
) {
  const [rawConfig] = await db
    .select()
    .from(eInvoiceConfigs)
    .where(and(eq(eInvoiceConfigs.businessId, businessId), eq(eInvoiceConfigs.isEnabled, true)))
    .limit(1);

  if (!rawConfig) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "E-invoicing is not enabled for this business. Configure it in Settings.",
    });
  }

  const config = decryptEInvoiceConfig(rawConfig);

  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.businessId, businessId), isNull(invoices.deletedAt)))
    .limit(1);

  if (!invoice) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });

  const [party] = await db.select().from(parties).where(eq(parties.id, invoice.partyId)).limit(1);
  if (!party?.gstin) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "E-invoicing requires the customer to have a GSTIN (B2B only)",
    });
  }

  const [business] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!business) throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });

  // Historical join — IRP e-invoice submission for an existing invoice
  // must include HSN/itemType for every line. Soft-deleted items stay
  // joined so the IRP payload is complete for legacy invoices.
  const lineItemRows = await db
    .select({
      itemName: invoiceItems.itemName,
      description: invoiceItems.description,
      quantity: invoiceItems.quantity,
      unitPrice: invoiceItems.unitPrice,
      taxPercent: invoiceItems.taxPercent,
      taxAmount: invoiceItems.taxAmount,
      discountPercent: invoiceItems.discountPercent,
      totalAmount: invoiceItems.totalAmount,
      selectedUnit: invoiceItems.selectedUnit,
      itemType: items.itemType,
      itemHsn: items.hsn,
    })
    .from(invoiceItems)
    .leftJoin(items, eq(items.id, invoiceItems.itemId))
    .where(eq(invoiceItems.invoiceId, invoiceId))
    .orderBy(invoiceItems.sortOrder);

  const irpJson = mapInvoiceToIRP(
    {
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate,
      type: invoice.type,
      documentType: invoice.documentType,
      subtotal: invoice.subtotal,
      taxAmount: invoice.taxAmount,
      discountAmount: invoice.discountAmount,
      additionalCharges: invoice.additionalCharges,
      roundOff: invoice.roundOff,
      totalAmount: invoice.totalAmount,
      isReverseCharge: invoice.isReverseCharge ?? false,
    },
    lineItemRows.map((li) => ({
      itemName: li.itemName,
      description: li.description,
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      taxPercent: li.taxPercent,
      taxAmount: li.taxAmount,
      discountPercent: li.discountPercent,
      totalAmount: li.totalAmount,
      selectedUnit: li.selectedUnit,
      itemType: li.itemType,
      itemHsn: li.itemHsn,
    })),
    {
      gstin: party.gstin,
      name: party.name,
      billingAddress: party.billingAddress,
      city: party.city,
      state: party.state,
      stateCode: party.stateCode,
      pincode: party.pincode,
      phone: party.phone,
      email: party.email,
    },
    {
      gstin: business.gstin,
      legalName: business.legalName,
      name: business.name,
      address: business.address,
      city: business.city,
      state: business.state,
      stateCode: business.stateCode,
      pincode: business.pincode,
      phone: business.phone,
      email: business.email,
    },
  );

  // Mark as pending before calling IRP
  await db
    .update(invoices)
    .set({ eInvoiceStatus: "pending", eInvoiceError: null, updatedAt: new Date() })
    .where(eq(invoices.id, invoiceId));

  try {
    const client = new IRPClient(config, db);
    const result = await client.generateIRN(irpJson);

    const [updated] = await db
      .update(invoices)
      .set({
        irn: result.irn,
        irnAckNumber: result.ackNo,
        irnAckDate: result.ackDt,
        signedQrCode: result.signedQrCode,
        signedInvoice: { signedInvoice: result.signedInvoice },
        eInvoiceStatus: "generated",
        eInvoiceError: null,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, invoiceId))
      .returning();

    return updated!;
  } catch (err) {
    const isRetryable = err instanceof IRPError && err.isRetryable;
    const errorMsg = err instanceof IRPError ? err.message : "Unknown IRP error";
    const retryCount = (invoice.eInvoiceRetryCount ?? 0) + 1;

    await db
      .update(invoices)
      .set({
        eInvoiceStatus: isRetryable ? "pending" : "failed",
        eInvoiceError: errorMsg,
        eInvoiceRetryCount: retryCount,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, invoiceId));

    throw new TRPCError({
      code: isRetryable ? "INTERNAL_SERVER_ERROR" : "BAD_REQUEST",
      message: `IRP submission failed: ${errorMsg}`,
    });
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

export const eInvoiceRouter = router({
  /**
   * Save IRP credentials for this business. Creates or replaces the config.
   */
  configure: adminProcedure
    .input(eInvoiceConfigSchema)
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "manage", "EInvoice");

      const existing = await ctx.db
        .select({ id: eInvoiceConfigs.id })
        .from(eInvoiceConfigs)
        .where(eq(eInvoiceConfigs.businessId, ctx.businessId))
        .limit(1);

      // Encrypt sensitive fields before persisting
      const encrypted = encryptEInvoiceConfig({
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        username: input.username,
        password: input.password,
      });

      if (existing.length > 0) {
        const [updated] = await ctx.db
          .update(eInvoiceConfigs)
          .set({
            gstin: input.gstin,
            clientId: encrypted.clientId,
            clientSecret: encrypted.clientSecret,
            username: encrypted.username,
            password: encrypted.password,
            isSandbox: input.isSandbox,
            isEnabled: input.isEnabled,
            thresholdCrore: input.thresholdCrore,
            // Clear cached token on credential change
            authToken: null,
            tokenExpiresAt: null,
            updatedAt: new Date(),
          })
          .where(eq(eInvoiceConfigs.businessId, ctx.businessId))
          .returning();
        return decryptEInvoiceConfig(updated!);
      }

      const [created] = await ctx.db
        .insert(eInvoiceConfigs)
        .values({
          businessId: ctx.businessId,
          gstin: input.gstin,
          clientId: encrypted.clientId,
          clientSecret: encrypted.clientSecret,
          username: encrypted.username,
          password: encrypted.password,
          isSandbox: input.isSandbox,
          isEnabled: input.isEnabled,
          thresholdCrore: input.thresholdCrore,
        })
        .returning();
      return decryptEInvoiceConfig(created!);
    }),

  /**
   * Get IRP config for this business (masks password).
   */
  getConfig: adminProcedure.query(async ({ ctx }) => {
    requireCan(ctx.ability, "manage", "EInvoice");

    const [rawConfig] = await ctx.db
      .select()
      .from(eInvoiceConfigs)
      .where(eq(eInvoiceConfigs.businessId, ctx.businessId))
      .limit(1);

    if (!rawConfig) return null;

    const config = decryptEInvoiceConfig(rawConfig);
    return {
      ...config,
      password: "••••••••", // Mask password in response
      clientSecret: config.clientSecret.slice(0, 4) + "••••••••",
    };
  }),

  /**
   * Test connection to IRP sandbox by attempting authentication.
   */
  testConnection: adminProcedure.mutation(async ({ ctx }) => {
    requireCan(ctx.ability, "manage", "EInvoice");

    const [rawConfig] = await ctx.db
      .select()
      .from(eInvoiceConfigs)
      .where(eq(eInvoiceConfigs.businessId, ctx.businessId))
      .limit(1);

    if (!rawConfig) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "E-invoice configuration not found. Please configure first.",
      });
    }

    try {
      const config = decryptEInvoiceConfig(rawConfig);
      const client = new IRPClient(config, ctx.db);
      await client.authenticate();
      return { success: true, message: "Successfully connected to IRP" };
    } catch (err) {
      const message = err instanceof IRPError ? err.message : "Connection failed";
      return { success: false, message };
    }
  }),

  /**
   * Submit invoice to IRP and get IRN. Updates invoice with IRN/QR data.
   */
  generate: adminProcedure
    .input(z.object({ invoiceId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "manage", "EInvoice");

      // Pre-validate status before delegating to shared helper
      const [invoice] = await ctx.db
        .select({ eInvoiceStatus: invoices.eInvoiceStatus })
        .from(invoices)
        .where(and(eq(invoices.id, input.invoiceId), eq(invoices.businessId, ctx.businessId)))
        .limit(1);

      if (!invoice) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
      }
      if (invoice.eInvoiceStatus === "generated") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "IRN already generated for this invoice" });
      }
      if (invoice.eInvoiceStatus === "cancelled") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot regenerate IRN for a cancelled e-invoice" });
      }

      return generateIRNForInvoice(input.invoiceId, ctx.businessId, ctx.db);
    }),

  /**
   * Cancel an IRN. Only valid within 24 hours of generation.
   */
  cancel: adminProcedure
    .input(cancelEInvoiceSchema)
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "manage", "EInvoice");

      // Fetch config and decrypt credentials
      const [rawConfig] = await ctx.db
        .select()
        .from(eInvoiceConfigs)
        .where(eq(eInvoiceConfigs.businessId, ctx.businessId))
        .limit(1);

      if (!rawConfig) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "E-invoice configuration not found",
        });
      }

      const config = decryptEInvoiceConfig(rawConfig);

      // Fetch invoice
      const [invoice] = await ctx.db
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.id, input.invoiceId),
            eq(invoices.businessId, ctx.businessId),
          ),
        )
        .limit(1);

      if (!invoice) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
      }

      if (!invoice.irn) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This invoice does not have an IRN to cancel",
        });
      }

      if (invoice.eInvoiceStatus === "cancelled") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "IRN is already cancelled",
        });
      }

      // Enforce 24-hour cancellation window
      if (invoice.irnAckDate) {
        const ackAge = Date.now() - new Date(invoice.irnAckDate).getTime();
        const twentyFourHoursMs = 24 * 60 * 60 * 1000;
        if (ackAge > twentyFourHoursMs) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "IRN can only be cancelled within 24 hours of generation. Please contact GST authorities for late cancellation.",
          });
        }
      }

      // Submit cancellation to IRP
      const client = new IRPClient(config, ctx.db);
      await client.cancelIRN(
        invoice.irn,
        input.cancelReason,
        input.cancelRemarks,
      );

      // Update invoice status
      const [updated] = await ctx.db
        .update(invoices)
        .set({
          eInvoiceStatus: "cancelled",
          eInvoiceCancelReason: input.cancelReason,
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, invoice.id))
        .returning();

      return updated;
    }),

  /**
   * Retry a failed e-invoice submission.
   * Validates status, then re-runs the full generate flow.
   */
  retryFailed: adminProcedure
    .input(z.object({ invoiceId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "manage", "EInvoice");

      const [invoice] = await ctx.db
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.id, input.invoiceId),
            eq(invoices.businessId, ctx.businessId),
            isNull(invoices.deletedAt),
          ),
        )
        .limit(1);

      if (!invoice) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
      }

      if (invoice.eInvoiceStatus !== "failed" && invoice.eInvoiceStatus !== "pending") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Can only retry invoices with failed or pending e-invoice status",
        });
      }

      // Run the generate logic inline (reuse same helper)
      return generateIRNForInvoice(invoice.id, ctx.businessId, ctx.db);
    }),

  /**
   * Dashboard: list invoices with e-invoice status, counts, filters.
   */
  dashboard: viewerProcedure
    .input(
      z.object({
        status: z
          .enum(["pending", "generated", "failed", "cancelled"])
          .nullish(),
        fromDate: z.string().datetime().nullish(),
        toDate: z.string().datetime().nullish(),
        search: z.string().max(200).nullish(),
        ...paginationSchema.shape,
      }),
    )
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "EInvoice");

      // Status counts
      const countRows = await ctx.db
        .select({
          status: invoices.eInvoiceStatus,
          count: sql<number>`count(*)::int`,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.businessId, ctx.businessId),
            isNull(invoices.deletedAt),
            isNotNull(invoices.eInvoiceStatus),
          ),
        )
        .groupBy(invoices.eInvoiceStatus);

      const counts = {
        generated: 0,
        pending: 0,
        failed: 0,
        cancelled: 0,
      };
      for (const row of countRows) {
        if (row.status && row.status in counts) {
          counts[row.status as keyof typeof counts] = row.count;
        }
      }

      // Invoice list with filters
      const conditions = [
        eq(invoices.businessId, ctx.businessId),
        isNull(invoices.deletedAt),
        isNotNull(invoices.eInvoiceStatus),
      ];

      if (input.status) {
        conditions.push(eq(invoices.eInvoiceStatus, input.status));
      }
      if (input.fromDate) {
        conditions.push(sql`${invoices.invoiceDate} >= ${new Date(input.fromDate)}`);
      }
      if (input.toDate) {
        conditions.push(sql`${invoices.invoiceDate} <= ${new Date(input.toDate)}`);
      }
      if (input.search) {
        const term = `%${escapeLike(input.search)}%`;
        conditions.push(
          sql`(${invoices.invoiceNumber} ILIKE ${term} OR EXISTS (
            SELECT 1 FROM ${parties}
            WHERE ${parties.id} = ${invoices.partyId}
            AND ${parties.name} ILIKE ${term}
          ))`,
        );
      }

      const offset = (input.page - 1) * input.limit;

      const [data, [{ total }]] = await Promise.all([
        ctx.db
          .select({
            id: invoices.id,
            invoiceNumber: invoices.invoiceNumber,
            invoiceDate: invoices.invoiceDate,
            totalAmount: invoices.totalAmount,
            eInvoiceStatus: invoices.eInvoiceStatus,
            eInvoiceError: invoices.eInvoiceError,
            eInvoiceRetryCount: invoices.eInvoiceRetryCount,
            irn: invoices.irn,
            irnAckDate: invoices.irnAckDate,
            partyName: parties.name,
            partyId: parties.id,
          })
          .from(invoices)
          .innerJoin(parties, eq(parties.id, invoices.partyId))
          .where(and(...conditions))
          .orderBy(desc(invoices.invoiceDate))
          .limit(input.limit)
          .offset(offset),
        ctx.db
          .select({ total: sql<number>`count(*)::int` })
          .from(invoices)
          .where(and(...conditions)),
      ]);

      return {
        data,
        total,
        page: input.page,
        limit: input.limit,
        counts,
      };
    }),

  /**
   * Get e-invoice status for a specific invoice.
   */
  getStatus: viewerProcedure
    .input(z.object({ invoiceId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "EInvoice");

      const [invoice] = await ctx.db
        .select({
          id: invoices.id,
          irn: invoices.irn,
          irnAckNumber: invoices.irnAckNumber,
          irnAckDate: invoices.irnAckDate,
          signedQrCode: invoices.signedQrCode,
          eInvoiceStatus: invoices.eInvoiceStatus,
          eInvoiceError: invoices.eInvoiceError,
          eInvoiceRetryCount: invoices.eInvoiceRetryCount,
          eInvoiceCancelReason: invoices.eInvoiceCancelReason,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.id, input.invoiceId),
            eq(invoices.businessId, ctx.businessId),
          ),
        )
        .limit(1);

      if (!invoice) return null;

      return invoice;
    }),

  /**
   * Bulk retry all failed/pending invoices (up to 50 at a time).
   */
  bulkRetry: adminProcedure.mutation(async ({ ctx }) => {
    requireCan(ctx.ability, "manage", "EInvoice");

    // Check e-invoicing is enabled before fetching invoices
    const [config] = await ctx.db
      .select({ id: eInvoiceConfigs.id })
      .from(eInvoiceConfigs)
      .where(and(eq(eInvoiceConfigs.businessId, ctx.businessId), eq(eInvoiceConfigs.isEnabled, true)))
      .limit(1);

    if (!config) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "E-invoicing is not enabled" });
    }

    const failedInvoices = await ctx.db
      .select({ id: invoices.id })
      .from(invoices)
      .where(
        and(
          eq(invoices.businessId, ctx.businessId),
          isNull(invoices.deletedAt),
          inArray(invoices.eInvoiceStatus, ["failed", "pending"]),
        ),
      )
      .limit(50);

    const results = { attempted: failedInvoices.length, succeeded: 0, failed: 0 };

    for (const inv of failedInvoices) {
      try {
        await generateIRNForInvoice(inv.id, ctx.businessId, ctx.db);
        results.succeeded++;
      } catch {
        results.failed++;
      }
    }

    return results;
  }),
});
