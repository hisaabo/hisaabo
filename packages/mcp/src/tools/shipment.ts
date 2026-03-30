/**
 * Shipment tools — track outbound and inbound shipments.
 *
 * Tools registered:
 *   shipment_list    — list shipments with filters
 *   shipment_get     — get full shipment details
 *   shipment_create  — create a new shipment record
 *   shipment_update  — update status, tracking, or delivery dates
 *   shipment_delete  — delete a shipment record
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HisaaboClient } from "../client.js";
import { wrapTool } from "../lib/errors.js";
import { MAX_PAGE_SIZE, withPaginationMeta } from "../lib/pagination.js";

const SHIPMENT_STATUSES = ["pending", "shipped", "in_transit", "delivered", "returned"] as const;

export function registerShipmentTools(server: McpServer, client: HisaaboClient) {

  server.tool(
    "shipment_list",
    [
      "List shipments for the active business with optional filters.",
      "Use status='pending' to find shipments not yet dispatched, or status='in_transit' for active deliveries.",
      "Filter by invoice_id to see all shipments for a specific invoice, or by party_id for a specific customer.",
    ].join(" "),
    {
      status: z.enum(SHIPMENT_STATUSES).optional()
        .describe("Filter by shipment status: 'pending', 'shipped', 'in_transit', 'delivered', or 'returned'."),
      invoice_id: z.string().uuid().optional()
        .describe("Filter shipments linked to a specific invoice UUID."),
      party_id: z.string().uuid().optional()
        .describe("Filter shipments for a specific customer/party UUID."),
      page: z.number().int().min(1).default(1)
        .describe("Page number for pagination."),
    },
    wrapTool(async (input) => {
      const result = await client.shipment.list({
        status: input.status,
        invoiceId: input.invoice_id,
        partyId: input.party_id,
        page: input.page,
        limit: MAX_PAGE_SIZE,
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(withPaginationMeta(result), null, 2),
        }],
      };
    })
  );

  server.tool(
    "shipment_get",
    [
      "Get full details of a single shipment, including tracking info, carrier, address, and delivery dates.",
      "If the carrier is one of the 7 pre-configured Indian carriers (Delhivery, BlueDart, DTDC, Ecom Express, India Post, Shadowfax, Xpressbees), a tracking URL is auto-generated.",
    ].join(" "),
    {
      shipment_id: z.string().uuid()
        .describe("Shipment UUID from shipment_list."),
    },
    wrapTool(async (input) => {
      const shipment = await client.shipment.get(input.shipment_id);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(shipment, null, 2),
        }],
      };
    })
  );

  server.tool(
    "shipment_create",
    [
      "Create a new shipment record for an invoice or party.",
      "For known carriers (Delhivery, BlueDart, DTDC, Ecom Express, India Post, Shadowfax, Xpressbees), providing carrier + tracking_number auto-generates the tracking URL.",
      "For custom carriers, provide tracking_url manually.",
      "Cost is the shipping cost charged; weight is the parcel weight in kg.",
    ].join(" "),
    {
      invoice_id: z.string().uuid().optional()
        .describe("Link this shipment to an invoice UUID. Use shipment_list to avoid duplicates."),
      party_id: z.string().uuid().optional()
        .describe("Customer/party UUID for this shipment."),
      carrier: z.string().max(100).optional()
        .describe("Carrier name, e.g. 'Delhivery', 'BlueDart', 'DTDC'. Known carriers get auto-tracking URLs."),
      mode: z.string().max(50).optional()
        .describe("Delivery mode, e.g. 'surface', 'air', 'express'. Matches business custom shipping methods."),
      tracking_number: z.string().max(200).optional()
        .describe("AWB/tracking number from the carrier. Required for auto-generating tracking URL."),
      tracking_url: z.string().max(500).optional()
        .describe("Manual tracking URL if carrier is not in the pre-configured list."),
      cost: z.string().regex(/^\d+(\.\d{1,2})?$/).optional()
        .describe("Shipping cost as decimal string, e.g. '250.00'. Default '0'."),
      weight: z.string().regex(/^\d+(\.\d{1,3})?$/).optional()
        .describe("Parcel weight in kg as decimal string, e.g. '2.500'."),
      shipping_address: z.string().optional()
        .describe("Delivery address (street/flat/block)."),
      shipping_city: z.string().optional()
        .describe("Delivery city."),
      shipping_pincode: z.string().optional()
        .describe("Delivery PIN code."),
      status: z.enum(SHIPMENT_STATUSES).optional()
        .describe("Initial status. Default 'pending'. Set 'shipped' if already dispatched."),
      shipment_date: z.string().datetime().optional()
        .describe("Date the parcel was dispatched (ISO 8601). Defaults to today."),
      estimated_delivery: z.string().datetime().optional()
        .describe("Expected delivery date (ISO 8601)."),
      notes: z.string().optional()
        .describe("Internal notes about this shipment."),
    },
    wrapTool(async (input) => {
      const shipment = await client.shipment.create({
        invoiceId: input.invoice_id,
        partyId: input.party_id,
        carrier: input.carrier,
        mode: input.mode,
        trackingNumber: input.tracking_number,
        trackingUrl: input.tracking_url,
        cost: input.cost,
        weight: input.weight,
        shippingAddress: input.shipping_address,
        shippingCity: input.shipping_city,
        shippingPincode: input.shipping_pincode,
        status: input.status,
        shipmentDate: input.shipment_date,
        estimatedDelivery: input.estimated_delivery,
        notes: input.notes,
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(shipment, null, 2),
        }],
      };
    })
  );

  server.tool(
    "shipment_update",
    [
      "Update a shipment's status, tracking information, or delivery dates.",
      "Use this to mark a shipment as shipped (set status='shipped'), in transit, or delivered.",
      "Setting status='delivered' automatically records the actual delivery date if not provided.",
      "Update tracking_number to trigger re-generation of the carrier tracking URL.",
    ].join(" "),
    {
      shipment_id: z.string().uuid()
        .describe("Shipment UUID to update."),
      carrier: z.string().max(100).optional()
        .describe("Updated carrier name."),
      mode: z.string().max(50).optional()
        .describe("Updated delivery mode."),
      tracking_number: z.string().max(200).optional()
        .describe("Updated tracking/AWB number. Re-generates tracking URL for known carriers."),
      tracking_url: z.string().max(500).optional()
        .describe("Manual tracking URL override."),
      cost: z.string().regex(/^\d+(\.\d{1,2})?$/).optional()
        .describe("Updated shipping cost as decimal string."),
      weight: z.string().regex(/^\d+(\.\d{1,3})?$/).optional()
        .describe("Updated parcel weight in kg."),
      status: z.enum(SHIPMENT_STATUSES).optional()
        .describe("New status. 'shipped' = dispatched. 'in_transit' = en route. 'delivered' = received. 'returned' = sent back."),
      shipment_date: z.string().datetime().optional()
        .describe("Updated dispatch date (ISO 8601)."),
      estimated_delivery: z.string().datetime().optional()
        .describe("Updated estimated delivery date (ISO 8601)."),
      actual_delivery: z.string().datetime().optional()
        .describe("Actual delivery date (ISO 8601). Auto-set when status becomes 'delivered' if omitted."),
      notes: z.string().optional()
        .describe("Updated notes."),
    },
    wrapTool(async (input) => {
      const shipment = await client.shipment.update({
        id: input.shipment_id,
        carrier: input.carrier,
        mode: input.mode,
        trackingNumber: input.tracking_number,
        trackingUrl: input.tracking_url,
        cost: input.cost,
        weight: input.weight,
        status: input.status,
        shipmentDate: input.shipment_date,
        estimatedDelivery: input.estimated_delivery,
        actualDelivery: input.actual_delivery,
        notes: input.notes,
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(shipment, null, 2),
        }],
      };
    })
  );

  server.tool(
    "shipment_delete",
    [
      "Delete a shipment record. This is a hard delete — the shipment record is permanently removed.",
      "Requires admin role. Use with caution; prefer updating status to 'returned' instead of deleting.",
    ].join(" "),
    {
      shipment_id: z.string().uuid()
        .describe("Shipment UUID to delete."),
    },
    wrapTool(async (input) => {
      const result = await client.shipment.delete(input.shipment_id);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );
}
