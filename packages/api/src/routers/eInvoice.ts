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
import { emitNotificationEventSafe } from "../lib/notifications/index.js";
import { logAudit } from "../lib/audit.js";
import { assertCancellable, cancelInvoiceInTx } from "../lib/invoice-cancel.js";

// ── Shared helper ─────────────────────────────────────────────────────────────

/**
 * Shared logic for generating an IRN. Used by both `generate` and `retryFailed`.
 * Fetches all needed data, maps to IRP JSON, submits, and updates the invoice.
 */
async function generateIRNForInvoice(
  invoiceId: string,
  businessId: string,
  db: TenantDatabase,
  // Who to attribute a failure notification to (notifications §2, "compliance")
  notify?: { tenantId: string | null; actorUserId: string },
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

    // A permanent failure leaves an invoice that cannot legally be shared:
    // owners and accountants are always told (locked channel, inbox + email).
    if (!isRetryable) {
      await emitNotificationEventSafe(db, {
        tenantId: notify?.tenantId ?? null,
        businessId,
        type: "einvoice.failed",
        payload: { invoiceId, invoiceNumber: invoice.invoiceNumber, error: errorMsg.slice(0, 200) },
        actorUserId: notify?.actorUserId ?? null,
        ownerUserId: invoice.createdByUserId,
        dedupeKey: `einvoice.failed:${invoiceId}:${retryCount}`,
      });
    }

    throw new TRPCError({
      code: isRetryable ? "INTERNAL_SERVER_ERROR" : "BAD_REQUEST",
      message: `IRP submission failed: ${errorMsg}`,
    });
  }
}

/** Short, user-safe text of an error raised while cancelling locally. */
function errorText(err: unknown): string {
  if (err instanceof TRPCError) return err.message;
  return "unexpected error, see the server log";
}

/** The error a caller sees when the IRN is cancelled at the IRP but the invoice could not be cancelled here. */
function localCancelFailed(cause: unknown): TRPCError {
  return new TRPCError({
    code: cause instanceof TRPCError ? cause.code : "INTERNAL_SERVER_ERROR",
    message: `The IRN was cancelled at the IRP, but the invoice could not be cancelled here (${errorText(cause)}). `
      + "The invoice is still active. Cancel the invoice from its page, or cancel the e-invoice again to finish.",
    cause,
  });
}

/**
 * The IRP has cancelled the IRN but the local cancel failed. Leave a state the
 * operator can see and finish: eInvoiceStatus "cancelled" (the IRN really is
 * cancelled, so the e-invoice must never read "generated" again) with
 * eInvoiceError saying what is left to do. That is the same shape the pre-0.10.1
 * bug left behind (IRN cancelled, invoice live), so one diagnostic and one
 * remedy cover both: cancel the invoice normally, or cancel the e-invoice
 * again, which skips the IRP and only finishes the local cancel.
 */
async function recordLocalCancelFailure(
  db: TenantDatabase,
  ctx: { businessId: string; user: { id: string }; ipAddress?: string | null },
  invoice: { id: string; invoiceNumber: string; irn: string | null },
  cancelReason: string,
  cause: unknown,
): Promise<void> {
  const reason = errorText(cause);
  console.error(`[einvoice] IRN cancelled at the IRP but the local cancel of invoice ${invoice.id} failed:`, cause);
  try {
    await db
      .update(invoices)
      .set({
        eInvoiceStatus: "cancelled",
        eInvoiceCancelReason: cancelReason,
        eInvoiceError: `IRN cancelled at the IRP, but the invoice is still active: ${reason}. Cancel the invoice, or cancel the e-invoice again to finish.`.slice(0, 500),
        updatedAt: new Date(),
      })
      .where(and(eq(invoices.id, invoice.id), eq(invoices.businessId, ctx.businessId)));
  } catch (err) {
    // Nothing more can be done from here; the audit entry below is the last trace.
    console.error(`[einvoice] could not record the half-cancelled state of invoice ${invoice.id}:`, err);
  }
  await logAudit(db, {
    businessId: ctx.businessId,
    userId: ctx.user.id,
    action: "eInvoice.cancel",
    entityType: "invoice",
    entityId: invoice.id,
    metadata: {
      invoiceNumber: invoice.invoiceNumber,
      irn: invoice.irn,
      cancelReason,
      invoiceCancelled: false,
      localCancelError: reason,
    },
    ipAddress: ctx.ipAddress,
  });
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

      return generateIRNForInvoice(input.invoiceId, ctx.businessId, ctx.db, { tenantId: ctx.tenantId, actorUserId: ctx.user.id });
    }),

  /**
   * Cancel an IRN, and with it the invoice. Only valid within 24 hours of
   * generation. Under GST an e-invoice whose IRN is cancelled is cancelled: it
   * cannot be amended, and a fresh invoice with a new number must be issued. So
   * this cancels the invoice through the same code path as a normal invoice
   * cancel (lib/invoice-cancel.ts): stock/ITC reversal, out of GSTR-1/3B, the
   * ledger and party balances.
   *
   * Order: every check that can fail for a predictable reason runs first (24h
   * window, permission, invoice state, payments allocated), then the IRP (the
   * step that can fail for reasons we cannot know), then ONE local transaction
   * that sets the IRN state and cancels the invoice together. If that local
   * transaction fails after the IRP succeeded, the IRN is cancelled and the
   * invoice is live, so the failure is recorded as a retryable state (see
   * `recordLocalCancelFailure`) and calling this again finishes the job without
   * touching the IRP.
   *
   * The reverse can also happen: the IRP cancels but the answer never arrives
   * (timeout, crash), so the record still says "generated". Whenever the IRP
   * refuses or cannot be reached, or the 24h window has passed, the IRP is asked
   * whether the IRN is in fact cancelled (read-only `isIRNCancelled`). If it is,
   * that counts as the IRP step having succeeded and the local cancel proceeds,
   * which also lets the loser of a double click succeed. If it is not, the
   * original error stands.
   */
  cancel: adminProcedure
    .input(cancelEInvoiceSchema)
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "manage", "EInvoice");
      const actor = { businessId: ctx.businessId, role: ctx.role, ability: ctx.ability };

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

      if (!invoice.irn) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This invoice does not have an IRN to cancel",
        });
      }

      // IRN already cancelled at the IRP while the invoice is still live: a
      // previous call (or a release before 0.10.1) stopped half way. Finish the
      // local cancel; the IRP is not called again.
      const resumeLocalCancel = invoice.eInvoiceStatus === "cancelled" && invoice.status !== "cancelled";

      if (invoice.eInvoiceStatus === "cancelled" && !resumeLocalCancel) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "IRN is already cancelled",
        });
      }

      // The IRP client is only built when the IRP has to be asked something.
      let irp: IRPClient | null = null;
      const irpClient = async (): Promise<IRPClient> => {
        if (irp) return irp;
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
        irp = new IRPClient(decryptEInvoiceConfig(rawConfig), ctx.db);
        return irp;
      };

      // The IRP is the authority on whether the IRN is cancelled. A cancel it
      // accepted may never have been recorded here (the answer was lost to a
      // timeout, the process died, a second click raced the first), and then our
      // record says "generated" for an IRN that is gone. Asking is read-only, and
      // any failure to find out counts as "not cancelled".
      const irpSaysCancelled = async (): Promise<boolean> => {
        try {
          return await (await irpClient()).isIRNCancelled(invoice.irn!);
        } catch {
          return false;
        }
      };
      // True once the IRP has confirmed a cancel that our record did not have.
      let reconciledWithIrp = false;
      let irpCancelCalled = false;

      // Enforce 24-hour cancellation window. After it the IRP refuses a new cancel,
      // but one sent inside the window may have gone through unseen: ask before refusing.
      if (!resumeLocalCancel && invoice.irnAckDate) {
        const ackAge = Date.now() - new Date(invoice.irnAckDate).getTime();
        const twentyFourHoursMs = 24 * 60 * 60 * 1000;
        if (ackAge > twentyFourHoursMs) {
          if (!(await irpSaysCancelled())) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "IRN can only be cancelled within 24 hours of generation. Please contact GST authorities for late cancellation.",
            });
          }
          reconciledWithIrp = true;
        }
      }

      // The invoice is cancelled together with its IRN: refuse now, before the
      // IRP is asked to cancel, whatever would make that local cancel fail
      // (payments allocated, wrong status, role rule).
      if (invoice.status !== "cancelled") {
        try {
          await assertCancellable(ctx.db, actor, invoice, { irnCancelled: true });
        } catch (err) {
          if (!(err instanceof TRPCError)) throw err;
          if (reconciledWithIrp) {
            // The IRN is cancelled at the IRP after all: make the record say so.
            await recordLocalCancelFailure(ctx.db, ctx, invoice, input.cancelReason, err);
            throw localCancelFailed(err);
          }
          throw new TRPCError({
            code: err.code,
            message: `${resumeLocalCancel ? "The invoice was not cancelled" : "The IRN was not cancelled"}. Cancelling an e-invoice also cancels the invoice, which is not possible right now: ${err.message}`,
            cause: err,
          });
        }
      }

      if (!resumeLocalCancel && !reconciledWithIrp) {
        // Submit cancellation to IRP. If it fails and the IRP does not say the IRN
        // is cancelled, nothing has changed anywhere and the original error stands.
        try {
          irpCancelCalled = true;
          await (await irpClient()).cancelIRN(
            invoice.irn,
            input.cancelReason,
            input.cancelRemarks,
          );
        } catch (err) {
          if (!(await irpSaysCancelled())) throw err;
          reconciledWithIrp = true;
        }
      }

      // The IRN is cancelled at the IRP from here on. Set the IRN state and
      // cancel the invoice in one transaction so they cannot diverge.
      const cancelReason = resumeLocalCancel ? (invoice.eInvoiceCancelReason ?? input.cancelReason) : input.cancelReason;
      let result: Awaited<ReturnType<typeof cancelInvoiceInTx>>;
      try {
        result = await ctx.db.transaction((tx) =>
          cancelInvoiceInTx(tx, actor, invoice.id, {
            irnCancelled: true,
            extra: { eInvoiceStatus: "cancelled", eInvoiceCancelReason: cancelReason, eInvoiceError: null },
          }),
        );
      } catch (err) {
        await recordLocalCancelFailure(ctx.db, ctx, invoice, cancelReason, err);
        throw localCancelFailed(err);
      }

      await logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user.id,
        action: "eInvoice.cancel",
        entityType: "invoice",
        entityId: invoice.id,
        metadata: {
          invoiceNumber: invoice.invoiceNumber,
          irn: invoice.irn,
          cancelReason,
          invoiceCancelled: result.changed,
          irpCalled: irpCancelCalled,
          irpReconciled: reconciledWithIrp,
        },
        ipAddress: ctx.ipAddress,
      });
      if (result.changed) {
        // Same audit entry a normal cancel writes, so the trail reads the same.
        await logAudit(ctx.db, {
          businessId: ctx.businessId,
          userId: ctx.user.id,
          action: `${invoice.documentType}.updateStatus`,
          entityType: invoice.documentType,
          entityId: invoice.id,
          metadata: {
            invoiceNumber: invoice.invoiceNumber,
            fromStatus: result.fromStatus,
            toStatus: "cancelled",
            via: "eInvoice.cancel",
          },
          ipAddress: ctx.ipAddress,
        });
      }

      return result.invoice;
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
      return generateIRNForInvoice(invoice.id, ctx.businessId, ctx.db, { tenantId: ctx.tenantId, actorUserId: ctx.user.id });
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

      // IRN cancelled but the invoice still live: the cancel was never finished (a
      // release before 0.10.1, or a failure after the IRP succeeded, see `cancel`).
      const [{ unfinishedCancellations }] = await ctx.db
        .select({ unfinishedCancellations: sql<number>`count(*)::int` })
        .from(invoices)
        .where(
          and(
            eq(invoices.businessId, ctx.businessId),
            isNull(invoices.deletedAt),
            eq(invoices.eInvoiceStatus, "cancelled"),
            sql`${invoices.status} <> 'cancelled'`,
          ),
        );

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
            // The invoice's own status: "cancelled" e-invoice + live invoice means the
            // local cancel is unfinished (see `cancel`).
            invoiceStatus: invoices.status,
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
          .orderBy(desc(invoices.invoiceDate), desc(invoices.id))
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
        unfinishedCancellations,
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
          invoiceStatus: invoices.status,
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
        await generateIRNForInvoice(inv.id, ctx.businessId, ctx.db, { tenantId: ctx.tenantId, actorUserId: ctx.user.id });
        results.succeeded++;
      } catch {
        results.failed++;
      }
    }

    return results;
  }),
});
