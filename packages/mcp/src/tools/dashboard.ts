/**
 * Dashboard tools — business-level summaries and analytics.
 *
 * Tools registered:
 *   dashboard_summary — P&L summary, receivables, payables, cash position
 */

import { z } from "zod";
import type { ToolServer } from "../lib/registry.js";
import type { HisaaboClient } from "../client.js";
import { wrapTool } from "../lib/errors.js";
import {
  resolveDatePreset,
  windowToQuery,
  businessYearMonth,
  businessMonthStart,
  businessFinancialYearWindow,
  businessFinancialYearStartYear,
} from "@hisaabo/shared";

/**
 * Resolve a named period to ISO 8601 instants for the API, on the business calendar (IST): periods are
 * IST days, not the host's or UTC's, so the answer does not depend on where the MCP server runs.
 *   this-fy (default)  1 April of the current Indian financial year through the end of today
 *   this-year          the whole current Indian financial year (April-March): "year" for an Indian
 *                      business is the financial year, not January-December
 *   this-month / last-month / this-quarter   whole calendar periods
 * `this-fy` used to send no dates, which the API reads as ALL TIME.
 */
export function resolvePeriod(period: string | undefined, now: Date = new Date()): { fromDate?: string; toDate?: string } {
  const { year, month } = businessYearMonth(now);

  if (!period || period === "this-fy") return windowToQuery(resolveDatePreset("this-fy", now));
  if (period === "this-year") return windowToQuery(businessFinancialYearWindow(businessFinancialYearStartYear(now)));
  if (period === "this-month") return windowToQuery(resolveDatePreset("this-month", now));
  if (period === "last-month") return windowToQuery(resolveDatePreset("last-month", now));
  if (period === "this-quarter") {
    const first = Math.floor((month - 1) / 3) * 3 + 1;
    return windowToQuery({ from: businessMonthStart(year, first), before: businessMonthStart(year, first + 3) });
  }

  // "all" — no date filter
  return {};
}

export function registerDashboardTools(server: ToolServer, client: HisaaboClient) {

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
          "'this-fy' = current financial year to date (default). " +
          "'this-month' = current calendar month. " +
          "'last-month' = previous calendar month. " +
          "'this-quarter' = current calendar quarter. " +
          "'this-year' = the whole current financial year (April-March). " +
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
