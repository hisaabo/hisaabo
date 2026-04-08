/**
 * E-Invoice (IRP) tools.
 *
 * Tools registered:
 *   einvoice_dashboard  — e-invoice generation summary
 *   einvoice_generate   — generate e-invoice (get IRN) for an invoice
 *   einvoice_cancel     — cancel a generated e-invoice
 *   einvoice_retry      — retry a failed e-invoice generation
 *   einvoice_status     — get current e-invoice status for an invoice
 *
 * Note: configure, getConfig, testConnection are excluded (credential
 * management is not suited for MCP agents).
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HisaaboClient } from "../client.js";
import { wrapTool } from "../lib/errors.js";

export function registerEInvoiceTools(server: McpServer, client: HisaaboClient) {

  server.tool(
    "einvoice_dashboard",
    [
      "Get e-invoice generation summary dashboard.",
      "Returns counts of generated, cancelled, failed, and pending e-invoices.",
      "Use this to monitor e-invoice compliance status.",
    ].join(" "),
    {
      from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
        .describe("Start date in YYYY-MM-DD format."),
      to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
        .describe("End date in YYYY-MM-DD format."),
    },
    wrapTool(async (input) => {
      const result = await client.eInvoice.dashboard({ fromDate: input.from_date, toDate: input.to_date });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    })
  );

  server.tool(
    "einvoice_generate",
    [
      "Generate an e-invoice for a sales invoice by submitting it to the IRP (Invoice Registration Portal).",
      "Returns the IRN (Invoice Reference Number) and acknowledgement number on success.",
      "The invoice must be finalized and not already have an IRN.",
    ].join(" "),
    {
      invoice_id: z.string().uuid()
        .describe("Invoice UUID to generate e-invoice for."),
    },
    wrapTool(async (input) => {
      const result = await client.eInvoice.generate({ invoiceId: input.invoice_id });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    })
  );

  server.tool(
    "einvoice_cancel",
    [
      "Cancel a generated e-invoice on the IRP.",
      "E-invoices can only be cancelled within 24 hours of generation.",
      "Cancel reason codes: 1 = Duplicate, 2 = Data Entry Mistake, 3 = Order Cancelled, 4 = Others.",
    ].join(" "),
    {
      invoice_id: z.string().uuid()
        .describe("Invoice UUID whose e-invoice should be cancelled."),
      cancel_reason: z.enum(["1", "2", "3", "4"]).default("1")
        .describe("Cancel reason code: 1=Duplicate, 2=Data Entry Mistake, 3=Order Cancelled, 4=Others."),
    },
    wrapTool(async (input) => {
      const result = await client.eInvoice.cancel({
        invoiceId: input.invoice_id,
        cancelReason: input.cancel_reason,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    })
  );

  server.tool(
    "einvoice_retry",
    [
      "Retry a failed e-invoice generation for an invoice.",
      "Use this when the previous attempt failed due to a network error or IRP downtime.",
    ].join(" "),
    {
      invoice_id: z.string().uuid()
        .describe("Invoice UUID to retry e-invoice generation for."),
    },
    wrapTool(async (input) => {
      const result = await client.eInvoice.retryFailed({ invoiceId: input.invoice_id });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    })
  );

  server.tool(
    "einvoice_status",
    [
      "Get the current e-invoice status for an invoice.",
      "Returns whether an IRN has been generated, cancelled, or is pending.",
    ].join(" "),
    {
      invoice_id: z.string().uuid()
        .describe("Invoice UUID to check e-invoice status for."),
    },
    wrapTool(async (input) => {
      const result = await client.eInvoice.getStatus(input.invoice_id);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    })
  );
}
