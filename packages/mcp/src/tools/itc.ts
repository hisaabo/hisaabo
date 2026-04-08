/**
 * Input Tax Credit (ITC) tracking tools.
 *
 * Tools registered:
 *   itc_dashboard        — ITC summary (eligible, blocked, utilized, available)
 *   itc_ledger           — line-by-line ITC ledger from purchase invoices
 *   itc_aging_alerts     — credits at risk of reversal due to non-payment
 *   itc_mark_blocked     — mark ITC for an invoice as blocked (ineligible)
 *   itc_mark_eligible    — mark ITC for an invoice as eligible
 *   itc_gstr3b_table4    — auto-compute GSTR-3B Table 4 ITC breakdown
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HisaaboClient } from "../client.js";
import { wrapTool } from "../lib/errors.js";

export function registerItcTools(server: McpServer, client: HisaaboClient) {

  server.tool(
    "itc_dashboard",
    [
      "Get an ITC (Input Tax Credit) summary dashboard.",
      "Returns total eligible ITC, blocked ITC, utilized ITC, and available balance broken down by IGST/CGST/SGST.",
      "Use this to answer 'How much ITC do we have available?' or 'What is our total blocked credit?'",
    ].join(" "),
    {
      from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
        .describe("Start date in YYYY-MM-DD format."),
      to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
        .describe("End date in YYYY-MM-DD format."),
    },
    wrapTool(async (input) => {
      const result = await client.itc.dashboard({ fromDate: input.from_date, toDate: input.to_date });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    })
  );

  server.tool(
    "itc_ledger",
    [
      "Get a detailed ITC ledger showing all purchase invoices with credit amounts.",
      "Returns supplier name, GSTIN, invoice number, date, and IGST/CGST/SGST amounts.",
      "Use this to see the source of all ITC credits and their eligibility status.",
    ].join(" "),
    {
      from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
        .describe("Start date in YYYY-MM-DD format."),
      to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
        .describe("End date in YYYY-MM-DD format."),
      status: z.enum(["eligible", "blocked", "all"]).default("all").optional()
        .describe("Filter by ITC status."),
    },
    wrapTool(async (input) => {
      const result = await client.itc.ledger({
        fromDate: input.from_date,
        toDate: input.to_date,
        status: input.status,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    })
  );

  server.tool(
    "itc_aging_alerts",
    [
      "Get ITC aging alerts — purchase invoices with unpaid supplier payments that risk ITC reversal.",
      "Under GST rules, ITC must be reversed if the supplier invoice is unpaid for 180 days.",
      "Returns alerts grouped by days outstanding (30-90, 90-150, 150-180, 180+ days).",
    ].join(" "),
    {},
    wrapTool(async () => {
      const result = await client.itc.agingAlerts();
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    })
  );

  server.tool(
    "itc_mark_blocked",
    [
      "Mark ITC for a specific purchase invoice as blocked (ineligible).",
      "Use this for invoices where ITC is not claimable — e.g. personal expenses, Section 17(5) items.",
      "Blocked ITC is excluded from GSTR-3B Table 4 calculations.",
    ].join(" "),
    {
      invoice_id: z.string().uuid()
        .describe("Purchase invoice UUID to block ITC for."),
      reason: z.string().max(200).optional()
        .describe("Optional reason for blocking ITC."),
    },
    wrapTool(async (input) => {
      const result = await client.itc.markBlocked({ invoiceId: input.invoice_id, reason: input.reason });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    })
  );

  server.tool(
    "itc_mark_eligible",
    [
      "Mark ITC for a purchase invoice as eligible (claimable).",
      "Use this to reverse a previous block or to confirm eligibility.",
    ].join(" "),
    {
      invoice_id: z.string().uuid()
        .describe("Purchase invoice UUID to mark ITC as eligible."),
    },
    wrapTool(async (input) => {
      const result = await client.itc.markEligible({ invoiceId: input.invoice_id });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    })
  );

  server.tool(
    "itc_gstr3b_table4",
    [
      "Get auto-computed GSTR-3B Table 4 ITC breakdown for a specific month.",
      "Returns Table 4A (eligible ITC), 4B (blocked), 4D (reversals) broken down by IGST/CGST/SGST.",
      "Use this when preparing the GSTR-3B return to verify ITC figures.",
    ].join(" "),
    {
      month: z.number().int().min(1).max(12)
        .describe("Month number (1 = January, 12 = December)."),
      year: z.number().int().min(2020).max(new Date().getFullYear() + 1)
        .describe("Year, e.g. 2024."),
    },
    wrapTool(async (input) => {
      const result = await client.itc.gstr3bTable4({ month: input.month, year: input.year });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    })
  );
}
