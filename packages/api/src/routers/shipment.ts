import { z } from "zod";
import { eq, and, desc, sql } from "drizzle-orm";
import { shipments, invoices, parties } from "@hisaabo/db";
import { router, memberProcedure, viewerProcedure, adminProcedure } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";
import { logAudit } from "../lib/audit.js";

// Known carriers with auto-generated tracking URLs
const CARRIER_TRACKING_URLS: Record<string, (trackingNumber: string) => string> = {
  delhivery: (t) => `https://www.delhivery.com/track/package/${t}`,
  bluedart: (t) => `https://www.bluedart.com/tracking/${t}`,
  dtdc: (t) => `https://www.dtdc.in/tracking/shipment-tracking.asp?strCnno=${t}`,
  ecom_express: (t) => `https://ecomexpress.in/tracking/?awb_field=${t}`,
  india_post: (t) => `https://www.indiapost.gov.in/_layouts/15/DOP.Portal.Tracking/TrackConsignment.aspx?ConsignmentNumber=${t}`,
  shadowfax: (t) => `https://tracker.shadowfax.in/#/track/${t}`,
  xpressbees: (t) => `https://www.xpressbees.com/shipment/tracking?awbNo=${t}`,
};

function buildTrackingUrl(carrier: string | null, trackingNumber: string | null): string | null {
  if (!carrier || !trackingNumber) return null;
  const key = carrier.toLowerCase().replace(/[\s-]/g, "_");
  const builder = CARRIER_TRACKING_URLS[key];
  return builder ? builder(trackingNumber) : null;
}

export const shipmentRouter = router({
  list: viewerProcedure
    .input(z.object({
      status: z.enum(["pending", "shipped", "in_transit", "delivered", "returned"]).nullish(),
      invoiceId: z.string().uuid().nullish(),
      partyId: z.string().uuid().nullish(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Invoice");
      const conditions = [eq(shipments.businessId, ctx.businessId)];
      if (input.status) conditions.push(eq(shipments.status, input.status));
      if (input.invoiceId) conditions.push(eq(shipments.invoiceId, input.invoiceId));
      if (input.partyId) conditions.push(eq(shipments.partyId, input.partyId));

      const offset = (input.page - 1) * input.limit;
      const [data, [{ count }]] = await Promise.all([
        ctx.db.select({
          id: shipments.id,
          invoiceId: shipments.invoiceId,
          partyId: shipments.partyId,
          carrier: shipments.carrier,
          mode: shipments.mode,
          trackingNumber: shipments.trackingNumber,
          trackingUrl: shipments.trackingUrl,
          cost: shipments.cost,
          weight: shipments.weight,
          status: shipments.status,
          shipmentDate: shipments.shipmentDate,
          estimatedDelivery: shipments.estimatedDelivery,
          actualDelivery: shipments.actualDelivery,
          notes: shipments.notes,
          createdAt: shipments.createdAt,
          invoiceNumber: invoices.invoiceNumber,
          partyName: parties.name,
        })
          .from(shipments)
          .leftJoin(invoices, eq(invoices.id, shipments.invoiceId))
          .leftJoin(parties, eq(parties.id, shipments.partyId))
          .where(and(...conditions))
          .orderBy(desc(shipments.createdAt))
          .limit(input.limit)
          .offset(offset),
        ctx.db.select({ count: sql<number>`count(*)::int` }).from(shipments)
          .where(and(...conditions)),
      ]);

      return { data, total: count, page: input.page, limit: input.limit };
    }),

  getById: viewerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Invoice");
      const [row] = await ctx.db.select({
        id: shipments.id,
        businessId: shipments.businessId,
        invoiceId: shipments.invoiceId,
        partyId: shipments.partyId,
        carrier: shipments.carrier,
        mode: shipments.mode,
        trackingNumber: shipments.trackingNumber,
        trackingUrl: shipments.trackingUrl,
        cost: shipments.cost,
        weight: shipments.weight,
        shippingAddress: shipments.shippingAddress,
        shippingCity: shipments.shippingCity,
        shippingPincode: shipments.shippingPincode,
        status: shipments.status,
        shipmentDate: shipments.shipmentDate,
        estimatedDelivery: shipments.estimatedDelivery,
        actualDelivery: shipments.actualDelivery,
        notes: shipments.notes,
        createdAt: shipments.createdAt,
        updatedAt: shipments.updatedAt,
        invoiceNumber: invoices.invoiceNumber,
        partyName: parties.name,
      })
        .from(shipments)
        .leftJoin(invoices, eq(invoices.id, shipments.invoiceId))
        .leftJoin(parties, eq(parties.id, shipments.partyId))
        .where(and(eq(shipments.id, input.id), eq(shipments.businessId, ctx.businessId)))
        .limit(1);
      return row ?? null;
    }),

  create: memberProcedure
    .input(z.object({
      invoiceId: z.string().uuid().optional(),
      partyId: z.string().uuid().optional(),
      carrier: z.string().max(100).optional(),
      mode: z.string().max(50).optional(),
      trackingNumber: z.string().max(200).optional(),
      trackingUrl: z.string().max(500).optional(),
      cost: z.string().regex(/^\d+(\.\d{1,2})?$/).default("0"),
      weight: z.string().regex(/^\d+(\.\d{1,3})?$/).optional(),
      shippingAddress: z.string().optional(),
      shippingCity: z.string().optional(),
      shippingPincode: z.string().optional(),
      status: z.enum(["pending", "shipped", "in_transit", "delivered", "returned"]).default("pending"),
      shipmentDate: z.string().datetime().optional(),
      estimatedDelivery: z.string().datetime().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "create", "Invoice");

      // Auto-generate tracking URL if carrier is recognized
      const autoUrl = buildTrackingUrl(input.carrier || null, input.trackingNumber || null);

      const [shipment] = await ctx.db.insert(shipments).values({
        businessId: ctx.businessId,
        invoiceId: input.invoiceId || null,
        partyId: input.partyId || null,
        carrier: input.carrier || null,
        mode: input.mode || null,
        trackingNumber: input.trackingNumber || null,
        trackingUrl: input.trackingUrl || autoUrl || null,
        cost: input.cost,
        weight: input.weight || null,
        shippingAddress: input.shippingAddress || null,
        shippingCity: input.shippingCity || null,
        shippingPincode: input.shippingPincode || null,
        status: input.status,
        shipmentDate: input.shipmentDate ? new Date(input.shipmentDate) : null,
        estimatedDelivery: input.estimatedDelivery ? new Date(input.estimatedDelivery) : null,
        notes: input.notes || null,
      }).returning();

      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user.id,
        action: "shipment.create",
        entityType: "shipment",
        entityId: shipment.id,
        metadata: { trackingNumber: input.trackingNumber || null },
        ipAddress: ctx.req.headers.get("x-forwarded-for"),
      });

      return shipment;
    }),

  update: memberProcedure
    .input(z.object({
      id: z.string().uuid(),
      carrier: z.string().max(100).optional(),
      mode: z.string().max(50).optional(),
      trackingNumber: z.string().max(200).optional(),
      trackingUrl: z.string().max(500).optional(),
      cost: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
      weight: z.string().regex(/^\d+(\.\d{1,3})?$/).optional(),
      status: z.enum(["pending", "shipped", "in_transit", "delivered", "returned"]).optional(),
      shipmentDate: z.string().datetime().optional(),
      estimatedDelivery: z.string().datetime().optional(),
      actualDelivery: z.string().datetime().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Invoice");

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.carrier !== undefined) updates.carrier = input.carrier || null;
      if (input.mode !== undefined) updates.mode = input.mode || null;
      if (input.trackingNumber !== undefined) {
        updates.trackingNumber = input.trackingNumber || null;
        // Re-generate tracking URL if tracking number changed
        if (input.trackingNumber && input.carrier) {
          const autoUrl = buildTrackingUrl(input.carrier, input.trackingNumber);
          if (autoUrl) updates.trackingUrl = autoUrl;
        }
      }
      if (input.trackingUrl !== undefined) updates.trackingUrl = input.trackingUrl || null;
      if (input.cost !== undefined) updates.cost = input.cost;
      if (input.weight !== undefined) updates.weight = input.weight || null;
      if (input.status !== undefined) {
        updates.status = input.status;
        if (input.status === "delivered" && !input.actualDelivery) {
          updates.actualDelivery = new Date();
        }
      }
      if (input.shipmentDate !== undefined) updates.shipmentDate = new Date(input.shipmentDate);
      if (input.estimatedDelivery !== undefined) updates.estimatedDelivery = new Date(input.estimatedDelivery);
      if (input.actualDelivery !== undefined) updates.actualDelivery = new Date(input.actualDelivery);
      if (input.notes !== undefined) updates.notes = input.notes || null;

      const [shipment] = await ctx.db.update(shipments)
        .set(updates)
        .where(and(eq(shipments.id, input.id), eq(shipments.businessId, ctx.businessId)))
        .returning();

      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user.id,
        action: "shipment.update",
        entityType: "shipment",
        entityId: input.id,
        metadata: { shipmentId: input.id },
        ipAddress: ctx.req.headers.get("x-forwarded-for"),
      });

      return shipment;
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "delete", "Invoice");
      await ctx.db.delete(shipments)
        .where(and(eq(shipments.id, input.id), eq(shipments.businessId, ctx.businessId)));

      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user.id,
        action: "shipment.delete",
        entityType: "shipment",
        entityId: input.id,
        metadata: { shipmentId: input.id },
        ipAddress: ctx.req.headers.get("x-forwarded-for"),
      });

      return { success: true };
    }),
});
