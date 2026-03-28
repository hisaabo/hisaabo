/**
 * Dashboard tools — business-level summaries and analytics.
 *
 * Tools registered:
 *   dashboard_summary — P&L summary, receivables, payables, cash position
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HisaaboClient } from "../client.js";
import { wrapTool } from "../lib/errors.js";

/** Resolve a named period to ISO 8601 date strings for the API. */
function resolvePeriod(period: string | undefined): { fromDate?: string; toDate?: string } {
  const now = new Date();

  if (!period || period === "this-fy") {
    // Financial year logic: April-start default. API computes FY dates server-side when no date range given.
    return {};
  }

  if (period === "this-month") {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return { fromDate: from.toISOString(), toDate: to.toISOString() };
  }

  if (period === "last-month") {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    return { fromDate: from.toISOString(), toDate: to.toISOString() };
  }

  if (period === "this-quarter") {
    const quarter = Math.floor(now.getMonth() / 3);
    const from = new Date(now.getFullYear(), quarter * 3, 1);
    const to = new Date(now.getFullYear(), (quarter + 1) * 3, 0, 23, 59, 59, 999);
    return { fromDate: from.toISOString(), toDate: to.toISOString() };
  }

  if (period === "this-year") {
    const from = new Date(now.getFullYear(), 0, 1);
    const to = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    return { fromDate: from.toISOString(), toDate: to.toISOString() };
  }

  // "all" — no date filter
  return {};
}

export function registerDashboardTools(server: McpServer, client: HisaaboClient) {

  server.tool(
    "dashboard_summary",
    [
      "Get a financial summary for the active business: total sales, purchases, expenses, receivables, payables, and cash position.",
      "'receivable' = total amount customers owe you (outstanding invoices).",
      "'payable' = total amount you owe suppliers.",
      "'cashInHand' = cash balance across all cash/bank accounts.",
      "Use period to select the time window. Defaults to the current financial year (April–March for Indian businesses).",
      "Use this to answer questions like 'How much revenue did we make this month?' or 'What are our total outstanding receivables?'",
    ].join(" "),
    {
      period: z.enum(["this-fy", "this-month", "last-month", "this-quarter", "this-year", "custom"]).optional()
        .describe(
          "'this-fy' = current financial year (default). " +
          "'this-month' = current calendar month. " +
          "'last-month' = previous calendar month. " +
          "'this-quarter' = current calendar quarter. " +
          "'this-year' = current calendar year. " +
          "'custom' = use from_date and to_date."
        ),
      from_date: z.string().datetime().optional()
        .describe("Custom start date (ISO 8601). Only used when period='custom'."),
      to_date: z.string().datetime().optional()
        .describe("Custom end date (ISO 8601). Only used when period='custom'."),
    },
    wrapTool(async (input) => {
      let dateRange: { fromDate?: string; toDate?: string };

      if (input.period === "custom") {
        dateRange = {
          fromDate: input.from_date,
          toDate: input.to_date,
        };
      } else {
        dateRange = resolvePeriod(input.period);
      }

      const summary = await client.dashboard.summary(
        Object.keys(dateRange).length > 0 ? dateRange : undefined
      );

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(
            {
              ...summary,
              _period: input.period ?? "this-fy",
              _note: "All monetary values are decimal strings in the business's currency (default: INR).",
            },
            null,
            2
          ),
        }],
      };
    })
  );
}
