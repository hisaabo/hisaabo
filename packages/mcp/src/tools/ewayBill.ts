/**
 * E-Way Bill tools.
 *
 * Tools registered:
 *   eway_bill_dashboard       — e-way bill summary dashboard
 *   eway_bill_generate        — generate an e-way bill for an invoice
 *   eway_bill_cancel          — cancel a generated e-way bill
 *   eway_bill_update_vehicle  — update vehicle number on an active e-way bill
 *   eway_bill_expiring        — list e-way bills expiring soon
 */

import { z } from "zod";
import type { ToolServer } from "../lib/registry.js";
import type { HisaaboClient } from "../client.js";
import { wrapTool } from "../lib/errors.js";

/** The server cancels / updates by e-way bill id, so resolve it from the invoice first. */
async function ewayBillIdForInvoice(client: HisaaboClient, invoiceId: string): Promise<string> {
  const ewb = await client.ewayBill.getByInvoice(invoiceId);
  if (!ewb) throw new Error(`No e-way bill found for invoice ${invoiceId}.`);
  return ewb.id;
}

const CANCEL_REASONS = { 1: "Duplicate", 2: "Order Cancelled", 3: "Data Entry Mistake", 4: "Others" } as const;
const VEHICLE_UPDATE_REASONS = { 1: "breakdown", 2: "transshipment", 3: "others" } as const;

export function registerEwayBillTools(server: ToolServer, client: HisaaboClient) {

  server.tool(
    "eway_bill_dashboard",
    [
      "Get e-way bill summary dashboard.",
      "Returns a paginated list of e-way bills, optionally filtered by status.",
    ].join(" "),
    {
      status: z.enum(["generated", "active", "cancelled", "expired"]).optional()
        .describe("Only list e-way bills with this status."),
      page: z.number().int().min(1).optional()
        .describe("Page number (default 1)."),
      limit: z.number().int().min(1).max(100).optional()
        .describe("Results per page (default 20)."),
    },
    wrapTool(async (input) => {
      const result = await client.ewayBill.dashboard({ status: input.status, page: input.page, limit: input.limit });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    })
  );

  server.tool(
    "eway_bill_generate",
    [
      "Generate an e-way bill for a sales/purchase invoice.",
      "Returns the e-way bill number and validity date.",
      "Required for goods movement above ₹50,000 inter-state, or as per state rules for intra-state.",
    ].join(" "),
    {
      invoice_id: z.string().uuid()
        .describe("Invoice UUID to generate e-way bill for."),
      transporter_id: z.string().optional()
        .describe("GSTIN of the transporter (if goods are handed to a transporter)."),
      vehicle_number: z.string().max(20)
        .describe("Vehicle registration number (e.g. 'MH12AB1234')."),
      distance: z.number().int().min(1).max(4000)
        .describe("Approximate distance of transport in km (1-4000)."),
      transport_mode: z.enum(["road", "rail", "air", "ship"]).default("road").optional()
        .describe("Mode of transport."),
    },
    wrapTool(async (input) => {
      const result = await client.ewayBill.generate({
        invoiceId: input.invoice_id,
        transporterId: input.transporter_id,
        vehicleNumber: input.vehicle_number,
        distance: input.distance,
        transportMode: input.transport_mode,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    })
  );

  server.tool(
    "eway_bill_cancel",
    [
      "Cancel an active e-way bill.",
      "E-way bills can only be cancelled within 24 hours of generation.",
    ].join(" "),
    {
      invoice_id: z.string().uuid()
        .describe("Invoice UUID whose e-way bill should be cancelled."),
      cancel_reason: z.number().int().min(1).max(4).default(1)
        .describe("Cancel reason: 1=Duplicate, 2=Order Cancelled, 3=Data Entry Mistake, 4=Others."),
    },
    wrapTool(async (input) => {
      const result = await client.ewayBill.cancel({
        ewayBillId: await ewayBillIdForInvoice(client, input.invoice_id),
        cancelReason: CANCEL_REASONS[input.cancel_reason as keyof typeof CANCEL_REASONS],
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    })
  );

  server.tool(
    "eway_bill_update_vehicle",
    [
      "Update the vehicle number on an active e-way bill.",
      "Use this when the goods are transferred to a different vehicle mid-transit.",
    ].join(" "),
    {
      invoice_id: z.string().uuid()
        .describe("Invoice UUID whose e-way bill vehicle should be updated."),
      vehicle_number: z.string().min(1)
        .describe("New vehicle registration number (e.g. 'MH12AB1234')."),
      reason: z.number().int().min(1).max(3).default(1)
        .describe("Reason for update: 1=Due to Break Down, 2=Due to Trans Shipment, 3=Others."),
    },
    wrapTool(async (input) => {
      const result = await client.ewayBill.updateVehicle({
        ewayBillId: await ewayBillIdForInvoice(client, input.invoice_id),
        vehicleNumber: input.vehicle_number,
        reason: VEHICLE_UPDATE_REASONS[input.reason as keyof typeof VEHICLE_UPDATE_REASONS],
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    })
  );

  server.tool(
    "eway_bill_expiring",
    [
      "List active e-way bills expiring within the next 24 hours.",
      "E-way bills have a validity period based on distance — expired bills cannot be used for transport.",
      "Use this to identify bills that need to be extended before goods reach destination.",
    ].join(" "),
    {},
    wrapTool(async () => {
      const result = await client.ewayBill.expiringList();
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    })
  );
}
