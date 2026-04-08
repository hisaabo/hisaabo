/**
 * ewayBill.ts — tRPC router for E-Way Bill management.
 *
 * WHY THIS FILE EXISTS:
 * E-Way Bill (EWB) is a mandatory GST compliance document for goods
 * movements above ₹50,000 in India. This router handles:
 *
 *   generate     — Create a new EWB for a goods invoice > ₹50,000
 *   cancel       — Cancel within 24h of generation
 *   updateVehicle — Part-B vehicle update (transhipment / breakdown)
 *   extend       — Extend validity within 8h of expiry
 *   getByInvoice — Fetch EWB details for a specific invoice
 *   dashboard    — Paginated list with status/validity filters
 *   expiringList — EWBs expiring within 24h
 *
 * All mutations require EWayBill:manage (admin/superadmin only).
 * All queries require EWayBill:read (admin + accountant).
 *
 * The EWBClient is created per-request using NIC credentials stored in
 * environment variables:
 *   NIC_EWB_CLIENT_ID, NIC_EWB_CLIENT_SECRET
 *   NIC_EWB_USERNAME, NIC_EWB_PASSWORD
 *   NIC_EWB_SANDBOX (set to "false" in production)
 *
 * If NIC credentials are not configured, mutations throw PRECONDITION_FAILED.
 * The sandbox is used by default so no accidental production calls occur in dev.
 */

import { eq, and, desc, gte, lte, sql, isNull } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  ewayBills,
  ewayBillVehicleUpdates,
  invoices,
  invoiceItems,
  items,
  parties,
  businesses,
} from "@hisaabo/db";
import {
  generateEwayBillSchema,
  cancelEwayBillSchema,
  updateEwbVehicleSchema,
} from "@hisaabo/shared";
import { router, viewerProcedure, adminProcedure } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";
import { EWBClient, computeValidUpto } from "../lib/ewb-client.js";
import { mapInvoiceToEWB } from "../lib/invoice-to-ewb.js";
import type { TransportDetails, InvoiceForEWB, LineItemForEWB } from "../lib/invoice-to-ewb.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const EWB_MIN_VALUE = 50000; // ₹50,000 threshold for mandatory EWB

/**
 * Build an EWBClient from environment variables.
 * Returns null if credentials are not configured.
 */
function getEWBClient(): EWBClient | null {
  const clientId = process.env.NIC_EWB_CLIENT_ID;
  const clientSecret = process.env.NIC_EWB_CLIENT_SECRET;
  const username = process.env.NIC_EWB_USERNAME;
  const password = process.env.NIC_EWB_PASSWORD;

  if (!clientId || !clientSecret || !username || !password) {
    return null;
  }

  const sandbox = process.env.NIC_EWB_SANDBOX !== "false";

  return new EWBClient({
    clientId,
    clientSecret,
    username,
    password,
    gstin: "", // filled per-call with business GSTIN
    sandbox,
  });
}

/**
 * Assert that the EWB client is available, throw PRECONDITION_FAILED if not.
 */
function requireEWBClient(): EWBClient {
  const client = getEWBClient();
  if (!client) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "E-Way Bill API credentials are not configured. Contact your administrator.",
    });
  }
  return client;
}

// ── Router ────────────────────────────────────────────────────────────────────

export const ewayBillRouter = router({

  /**
   * Generate a new E-Way Bill for a goods invoice.
   *
   * Validates:
   *   - Invoice belongs to the business
   *   - Invoice is a goods invoice (at least one product item)
   *   - Invoice total > ₹50,000
   *   - No existing active/generated EWB for this invoice
   */
  generate: adminProcedure
    .input(generateEwayBillSchema)
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "manage", "EWayBill");

      // ── 1. Fetch invoice ─────────────────────────────────────────────────────
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

      if (invoice.status === "cancelled") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot generate EWB for a cancelled invoice" });
      }

      // ── 2. Fetch line items with item master data ──────────────────────────
      const lineItemRows = await ctx.db
        .select({
          id: invoiceItems.id,
          description: invoiceItems.description,
          quantity: invoiceItems.quantity,
          unitPrice: invoiceItems.unitPrice,
          taxPercent: invoiceItems.taxPercent,
          taxAmount: invoiceItems.taxAmount,
          totalAmount: invoiceItems.totalAmount,
          hsn: items.hsn,
          unit: items.unit,
          itemType: items.itemType,
        })
        .from(invoiceItems)
        .leftJoin(items, eq(invoiceItems.itemId, items.id))
        .where(eq(invoiceItems.invoiceId, invoice.id));

      if (!lineItemRows.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invoice has no line items" });
      }

      // ── 3. Validate goods invoice ──────────────────────────────────────────
      const hasGoods = lineItemRows.some(
        (li) => !li.itemType || li.itemType === "product",
      );
      if (!hasGoods) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "E-Way Bill can only be generated for invoices containing goods (not service-only)",
        });
      }

      // ── 4. Validate ₹50,000 threshold ────────────────────────────────────
      const total = parseFloat(invoice.totalAmount) || 0;
      if (total < EWB_MIN_VALUE) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Invoice total (₹${total.toFixed(2)}) is below the ₹50,000 threshold for E-Way Bill`,
        });
      }

      // ── 5. Check for existing active EWB ──────────────────────────────────
      const [existingEwb] = await ctx.db
        .select({ id: ewayBills.id, status: ewayBills.status })
        .from(ewayBills)
        .where(
          and(
            eq(ewayBills.businessId, ctx.businessId),
            eq(ewayBills.invoiceId, invoice.id),
          ),
        )
        .limit(1);

      if (existingEwb && (existingEwb.status === "generated" || existingEwb.status === "active")) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An active E-Way Bill already exists for this invoice",
        });
      }

      // ── 6. Fetch party and business ───────────────────────────────────────
      const [party] = await ctx.db
        .select()
        .from(parties)
        .where(eq(parties.id, invoice.partyId))
        .limit(1);

      if (!party) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Party not found" });
      }

      const [business] = await ctx.db
        .select()
        .from(businesses)
        .where(eq(businesses.id, ctx.businessId))
        .limit(1);

      if (!business) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });
      }

      // ── 7. Build EWB payload ──────────────────────────────────────────────
      const invoiceForEWB: InvoiceForEWB = {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        type: invoice.type,
        documentType: invoice.documentType,
        subtotal: invoice.subtotal,
        taxAmount: invoice.taxAmount,
        totalAmount: invoice.totalAmount,
        isReverseCharge: invoice.isReverseCharge,
        partyGstin: party.gstin,
        partyName: party.name,
        partyAddress: party.billingAddress,
        partyCity: party.city,
        partyPincode: party.pincode,
        partyStateCode: party.stateCode,
        businessGstin: business.gstin,
        businessName: business.name,
        businessAddress: business.address,
        businessCity: business.city,
        businessPincode: business.pincode,
        businessStateCode: business.stateCode,
      };

      const lineItemsForEWB: LineItemForEWB[] = lineItemRows.map((li) => ({
        description: li.description,
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        taxPercent: li.taxPercent,
        taxAmount: li.taxAmount,
        totalAmount: li.totalAmount,
        hsn: li.hsn ?? null,
        unit: li.unit ?? null,
        itemType: li.itemType ?? null,
      }));

      const transportDetails: TransportDetails = {
        transporterId:   input.transporterId,
        transporterName: input.transporterName,
        vehicleNumber:   input.vehicleNumber,
        vehicleType:     input.vehicleType,
        transportMode:   input.transportMode,
        distance:        input.distance,
        fromAddress:     input.fromAddress,
        fromPincode:     input.fromPincode,
        toAddress:       input.toAddress,
        toPincode:       input.toPincode,
      };

      const ewbPayload = mapInvoiceToEWB(invoiceForEWB, lineItemsForEWB, transportDetails);

      // Override GSTIN in the client with the actual business GSTIN
      const ewbClient = requireEWBClient();
      ewbClient.config.gstin = business.gstin ?? "";

      // ── 8. Call NIC EWB API ───────────────────────────────────────────────
      const apiResponse = await ewbClient.generateEWB(ctx.businessId, ewbPayload);

      // ── 9. Compute validity and persist ───────────────────────────────────
      const generatedAt = new Date();
      const validUpto = computeValidUpto(
        generatedAt,
        input.distance,
        input.vehicleType,
      );

      const [newEwb] = await ctx.db
        .insert(ewayBills)
        .values({
          businessId: ctx.businessId,
          invoiceId: invoice.id,
          ewbNumber: apiResponse.ewayBillNo,
          ewbDate: generatedAt,
          validUpto,
          status: "generated",
          transporterId: input.transporterId ?? null,
          transporterName: input.transporterName ?? null,
          vehicleNumber: input.vehicleNumber,
          vehicleType: input.vehicleType,
          transportMode: input.transportMode,
          distance: input.distance,
          fromAddress: input.fromAddress ?? null,
          fromPincode: input.fromPincode ?? null,
          fromState: business.stateCode ?? null,
          toAddress: input.toAddress ?? null,
          toPincode: input.toPincode ?? null,
          toState: party.stateCode ?? null,
          apiResponse: (apiResponse as unknown) as Record<string, unknown>,
          createdByUserId: ctx.user.id,
        })
        .returning();

      return newEwb!;
    }),

  /**
   * Cancel an E-Way Bill.
   * Must be within 24 hours of generation.
   */
  cancel: adminProcedure
    .input(cancelEwayBillSchema)
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "manage", "EWayBill");

      const [ewb] = await ctx.db
        .select()
        .from(ewayBills)
        .where(
          and(
            eq(ewayBills.id, input.ewayBillId),
            eq(ewayBills.businessId, ctx.businessId),
          ),
        )
        .limit(1);

      if (!ewb) {
        throw new TRPCError({ code: "NOT_FOUND", message: "E-Way Bill not found" });
      }

      if (ewb.status === "cancelled") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "E-Way Bill is already cancelled" });
      }

      // Check 24-hour cancellation window
      if (ewb.ewbDate) {
        const hoursSinceGeneration = (Date.now() - ewb.ewbDate.getTime()) / (1000 * 60 * 60);
        if (hoursSinceGeneration > 24) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "E-Way Bill cannot be cancelled after 24 hours of generation",
          });
        }
      }

      if (!ewb.ewbNumber) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "E-Way Bill number not found" });
      }

      const ewbClient = requireEWBClient();

      // Fetch business GSTIN
      const [business] = await ctx.db
        .select({ gstin: businesses.gstin })
        .from(businesses)
        .where(eq(businesses.id, ctx.businessId))
        .limit(1);

      ewbClient.config.gstin = business?.gstin ?? "";

      await ewbClient.cancelEWB(ctx.businessId, ewb.ewbNumber, input.cancelReason);

      const [updated] = await ctx.db
        .update(ewayBills)
        .set({
          status: "cancelled",
          cancelReason: input.cancelReason,
          updatedAt: new Date(),
        })
        .where(eq(ewayBills.id, ewb.id))
        .returning();

      return updated!;
    }),

  /**
   * Update vehicle number (Part-B update).
   * Records history in ewayBillVehicleUpdates.
   */
  updateVehicle: adminProcedure
    .input(updateEwbVehicleSchema)
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "manage", "EWayBill");

      const [ewb] = await ctx.db
        .select()
        .from(ewayBills)
        .where(
          and(
            eq(ewayBills.id, input.ewayBillId),
            eq(ewayBills.businessId, ctx.businessId),
          ),
        )
        .limit(1);

      if (!ewb) {
        throw new TRPCError({ code: "NOT_FOUND", message: "E-Way Bill not found" });
      }

      if (ewb.status === "cancelled" || ewb.status === "expired") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot update vehicle for a ${ewb.status} E-Way Bill`,
        });
      }

      if (!ewb.ewbNumber) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "E-Way Bill number not found" });
      }

      const ewbClient = requireEWBClient();

      const [business] = await ctx.db
        .select({ gstin: businesses.gstin, stateCode: businesses.stateCode })
        .from(businesses)
        .where(eq(businesses.id, ctx.businessId))
        .limit(1);

      ewbClient.config.gstin = business?.gstin ?? "";

      const fromStateCode = parseInt(business?.stateCode ?? "0", 10);

      const apiResponse = await ewbClient.updateVehicle(
        ctx.businessId,
        ewb.ewbNumber,
        input.vehicleNumber,
        input.fromPlace ?? "",
        fromStateCode,
        input.reason,
      );

      // Compute new validity if API returns it
      let newValidUpto = ewb.validUpto;
      if (apiResponse.validUpto) {
        // NIC returns validUpto as string; parse best-effort
        const parsed = new Date(apiResponse.validUpto);
        if (!isNaN(parsed.getTime())) {
          newValidUpto = parsed;
        }
      }

      // Persist vehicle update history
      await ctx.db.insert(ewayBillVehicleUpdates).values({
        ewayBillId: ewb.id,
        vehicleNumber: input.vehicleNumber,
        fromPlace: input.fromPlace ?? null,
        reason: input.reason,
      });

      const [updated] = await ctx.db
        .update(ewayBills)
        .set({
          vehicleNumber: input.vehicleNumber,
          validUpto: newValidUpto,
          updatedAt: new Date(),
        })
        .where(eq(ewayBills.id, ewb.id))
        .returning();

      return updated!;
    }),

  /**
   * Extend EWB validity.
   * Can only be called within 8 hours before/after expiry.
   */
  extend: adminProcedure
    .input(
      z.object({
        ewayBillId: z.string().uuid(),
        vehicleNumber: z.string().max(20),
        fromPlace: z.string().max(200),
        fromPincode: z.number().int(),
        remainingDistance: z.number().int().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "manage", "EWayBill");

      const [ewb] = await ctx.db
        .select()
        .from(ewayBills)
        .where(
          and(
            eq(ewayBills.id, input.ewayBillId),
            eq(ewayBills.businessId, ctx.businessId),
          ),
        )
        .limit(1);

      if (!ewb) {
        throw new TRPCError({ code: "NOT_FOUND", message: "E-Way Bill not found" });
      }

      if (!ewb.validUpto) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "E-Way Bill has no expiry date" });
      }

      // Validate 8-hour window (8 hours before or after expiry)
      const hoursFromExpiry = (ewb.validUpto.getTime() - Date.now()) / (1000 * 60 * 60);
      if (hoursFromExpiry < -8) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Validity can only be extended within 8 hours after expiry",
        });
      }
      if (hoursFromExpiry > 8) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Validity can only be extended within 8 hours before expiry",
        });
      }

      if (!ewb.ewbNumber) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "E-Way Bill number not found" });
      }

      const ewbClient = requireEWBClient();

      const [business] = await ctx.db
        .select({ gstin: businesses.gstin, stateCode: businesses.stateCode })
        .from(businesses)
        .where(eq(businesses.id, ctx.businessId))
        .limit(1);

      ewbClient.config.gstin = business?.gstin ?? "";

      const fromStateCode = parseInt(business?.stateCode ?? "0", 10);

      const apiResponse = await ewbClient.extendValidity(
        ctx.businessId,
        ewb.ewbNumber,
        input.vehicleNumber,
        input.fromPlace,
        fromStateCode,
        input.fromPincode,
        input.remainingDistance,
      );

      let newValidUpto = ewb.validUpto;
      if (apiResponse.validUpto) {
        const parsed = new Date(apiResponse.validUpto);
        if (!isNaN(parsed.getTime())) {
          newValidUpto = parsed;
        }
      }

      const [updated] = await ctx.db
        .update(ewayBills)
        .set({
          validUpto: newValidUpto,
          status: "active",
          updatedAt: new Date(),
        })
        .where(eq(ewayBills.id, ewb.id))
        .returning();

      return updated!;
    }),

  /**
   * Get E-Way Bill details for a specific invoice.
   */
  getByInvoice: viewerProcedure
    .input(z.object({ invoiceId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "EWayBill");

      const rows = await ctx.db
        .select()
        .from(ewayBills)
        .where(
          and(
            eq(ewayBills.invoiceId, input.invoiceId),
            eq(ewayBills.businessId, ctx.businessId),
          ),
        )
        .orderBy(desc(ewayBills.createdAt));

      if (!rows.length) return null;

      const ewb = rows[0]!;

      // Fetch vehicle update history
      const vehicleHistory = await ctx.db
        .select()
        .from(ewayBillVehicleUpdates)
        .where(eq(ewayBillVehicleUpdates.ewayBillId, ewb.id))
        .orderBy(desc(ewayBillVehicleUpdates.updatedAt));

      return { ...ewb, vehicleHistory };
    }),

  /**
   * Dashboard: paginated list of EWBs with optional status and validity filters.
   */
  dashboard: viewerProcedure
    .input(
      z.object({
        status: z
          .enum(["generated", "active", "cancelled", "expired"])
          .optional(),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(20),
      }),
    )
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "EWayBill");

      const conditions = [eq(ewayBills.businessId, ctx.businessId)];
      if (input.status) {
        conditions.push(eq(ewayBills.status, input.status));
      }

      const offset = (input.page - 1) * input.limit;

      const [countResult] = await ctx.db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(ewayBills)
        .where(and(...conditions));

      const total = countResult?.count ?? 0;

      const rows = await ctx.db
        .select({
          id: ewayBills.id,
          ewbNumber: ewayBills.ewbNumber,
          ewbDate: ewayBills.ewbDate,
          validUpto: ewayBills.validUpto,
          status: ewayBills.status,
          transportMode: ewayBills.transportMode,
          vehicleNumber: ewayBills.vehicleNumber,
          distance: ewayBills.distance,
          fromState: ewayBills.fromState,
          toState: ewayBills.toState,
          cancelReason: ewayBills.cancelReason,
          createdAt: ewayBills.createdAt,
          invoiceId: ewayBills.invoiceId,
          invoiceNumber: invoices.invoiceNumber,
          invoiceDate: invoices.invoiceDate,
          partyName: parties.name,
        })
        .from(ewayBills)
        .leftJoin(invoices, eq(ewayBills.invoiceId, invoices.id))
        .leftJoin(parties, eq(invoices.partyId, parties.id))
        .where(and(...conditions))
        .orderBy(desc(ewayBills.createdAt))
        .limit(input.limit)
        .offset(offset);

      // Status summary counts
      const summaryRows = await ctx.db
        .select({
          status: ewayBills.status,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(ewayBills)
        .where(eq(ewayBills.businessId, ctx.businessId))
        .groupBy(ewayBills.status);

      const summary: Record<string, number> = {};
      for (const row of summaryRows) {
        summary[row.status] = row.count;
      }

      return { data: rows, total, page: input.page, limit: input.limit, summary };
    }),

  /**
   * EWBs expiring within the next 24 hours (excludes already expired/cancelled).
   */
  expiringList: viewerProcedure
    .query(async ({ ctx }) => {
      requireCan(ctx.ability, "read", "EWayBill");

      const now = new Date();
      const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const rows = await ctx.db
        .select({
          id: ewayBills.id,
          ewbNumber: ewayBills.ewbNumber,
          ewbDate: ewayBills.ewbDate,
          validUpto: ewayBills.validUpto,
          status: ewayBills.status,
          vehicleNumber: ewayBills.vehicleNumber,
          transportMode: ewayBills.transportMode,
          distance: ewayBills.distance,
          invoiceId: ewayBills.invoiceId,
          invoiceNumber: invoices.invoiceNumber,
          partyName: parties.name,
        })
        .from(ewayBills)
        .leftJoin(invoices, eq(ewayBills.invoiceId, invoices.id))
        .leftJoin(parties, eq(invoices.partyId, parties.id))
        .where(
          and(
            eq(ewayBills.businessId, ctx.businessId),
            // Active or generated EWBs only
            sql`${ewayBills.status} IN ('generated', 'active')`,
            // Valid upto is in the future but within 24h
            gte(ewayBills.validUpto, now),
            lte(ewayBills.validUpto, in24h),
          ),
        )
        .orderBy(ewayBills.validUpto);

      return rows;
    }),
});
