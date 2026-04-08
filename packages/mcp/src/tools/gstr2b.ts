/**
 * GSTR-2B reconciliation tools.
 *
 * Tools registered:
 *   gstr2b_upload            — list GSTR-2B uploads by period
 *   gstr2b_uploads           — alias for gstr2b_upload (same as above)
 *   gstr2b_records           — get parsed GSTR-2B records for a period
 *   gstr2b_summary           — reconciliation summary for a period
 *   gstr2b_missing_in_books  — invoices in GSTR-2B not found in purchase register
 *   gstr2b_missing_in_2b     — purchase invoices not present in GSTR-2B
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HisaaboClient } from "../client.js";
import { wrapTool } from "../lib/errors.js";

export function registerGstr2bTools(server: McpServer, client: HisaaboClient) {

  server.tool(
    "gstr2b_uploads",
    [
      "List GSTR-2B uploads by return period.",
      "Returns each upload with its period (e.g. '032024' for March 2024), upload date, and record count.",
      "Use gstr2b_summary with a period to see reconciliation status.",
    ].join(" "),
    {
      financial_year: z.string().optional()
        .describe("Financial year filter, e.g. '2023-24'."),
    },
    wrapTool(async (input) => {
      const result = await client.gstr2b.uploads({ financialYear: input.financial_year });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    })
  );

  server.tool(
    "gstr2b_records",
    [
      "Get all GSTR-2B records for a specific return period.",
      "Returns supplier invoices as reported by suppliers in their GSTR-1.",
      "Use this to see what ITC the GST portal expects you to claim.",
    ].join(" "),
    {
      period: z.string().regex(/^\d{6}$/)
        .describe("Return period in MMYYYY format, e.g. '032024' for March 2024."),
      page: z.number().int().min(1).default(1)
        .describe("Page number."),
      limit: z.number().int().min(1).max(100).default(50)
        .describe("Results per page."),
    },
    wrapTool(async (input) => {
      const result = await client.gstr2b.records({
        period: input.period,
        page: input.page,
        limit: input.limit,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    })
  );

  server.tool(
    "gstr2b_summary",
    [
      "Get GSTR-2B reconciliation summary for a return period.",
      "Shows total matched invoices, mismatches, and ITC amounts from both GSTR-2B and purchase books.",
    ].join(" "),
    {
      period: z.string().regex(/^\d{6}$/)
        .describe("Return period in MMYYYY format, e.g. '032024' for March 2024."),
    },
    wrapTool(async (input) => {
      const result = await client.gstr2b.summary({ period: input.period });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    })
  );

  server.tool(
    "gstr2b_missing_in_books",
    [
      "Find invoices present in GSTR-2B (supplier-filed) but missing from your purchase register.",
      "These are invoices where you have not recorded the purchase — you may be missing ITC.",
    ].join(" "),
    {
      period: z.string().regex(/^\d{6}$/)
        .describe("Return period in MMYYYY format, e.g. '032024' for March 2024."),
      page: z.number().int().min(1).default(1)
        .describe("Page number."),
      limit: z.number().int().min(1).max(100).default(50)
        .describe("Results per page."),
    },
    wrapTool(async (input) => {
      const result = await client.gstr2b.missingInBooks({
        period: input.period,
        page: input.page,
        limit: input.limit,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    })
  );

  server.tool(
    "gstr2b_missing_in_2b",
    [
      "Find purchase invoices in your books not present in GSTR-2B.",
      "These are purchase invoices where the supplier has not filed their GSTR-1 yet.",
      "ITC on these invoices cannot be claimed until the supplier files.",
    ].join(" "),
    {
      period: z.string().regex(/^\d{6}$/)
        .describe("Return period in MMYYYY format, e.g. '032024' for March 2024."),
      page: z.number().int().min(1).default(1)
        .describe("Page number."),
      limit: z.number().int().min(1).max(100).default(50)
        .describe("Results per page."),
    },
    wrapTool(async (input) => {
      const result = await client.gstr2b.missingIn2B({
        period: input.period,
        page: input.page,
        limit: input.limit,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    })
  );
}
