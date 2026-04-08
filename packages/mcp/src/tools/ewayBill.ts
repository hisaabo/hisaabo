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
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HisaaboClient } from "../client.js";
import { wrapTool } from "../lib/errors.js";

export function registerEwayBillTools(server: McpServer, client: HisaaboClient) {

  server.tool(
    "eway_bill_dashboard",
    [
      "Get e-way bill summary dashboard.",
      "Returns counts of generated, active, cancelled, and expired e-way bills.",
    ].join(" "),
    {
      from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
        .describe("Start date in YYYY-MM-DD format."),
      to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
        .describe("End date in YYYY-MM-DD format."),
    },
    wrapTool(async (input) => {
      const result = await client.ewayBill.dashboard({ fromDate: input.from_date, toDate: input.to_date });
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
      vehicle_number: z.string().optional()
        .describe("Vehicle registration number (e.g. 'MH12AB1234')."),
      transport_mode: z.enum(["road", "rail", "air", "ship"]).default("road").optional()
        .describe("Mode of transport."),
    },
    wrapTool(async (input) => {
      const result = await client.ewayBill.generate({
        invoiceId: input.invoice_id,
        transporterId: input.transporter_id,
        vehicleNumber: input.vehicle_number,
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
        invoiceId: input.invoice_id,
        cancelReason: input.cancel_reason,
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
      reason: z.number().int().min(1).max(4).default(1)
        .describe("Reason for update: 1=Due to Break Down, 2=Due to Trans Shipment, 3=Others."),
    },
    wrapTool(async (input) => {
      const result = await client.ewayBill.updateVehicle({
        invoiceId: input.invoice_id,
        vehicleNumber: input.vehicle_number,
        reason: input.reason,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    })
  );

  server.tool(
    "eway_bill_expiring",
    [
      "List e-way bills expiring within the next N days.",
      "E-way bills have a validity period based on distance — expired bills cannot be used for transport.",
      "Use this to identify bills that need to be extended before goods reach destination.",
    ].join(" "),
    {
      within_days: z.number().int().min(1).max(10).default(3)
        .describe("Show bills expiring within this many days (default 3)."),
    },
    wrapTool(async (input) => {
      const result = await client.ewayBill.expiringList({ withinDays: input.within_days });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    })
  );
}
