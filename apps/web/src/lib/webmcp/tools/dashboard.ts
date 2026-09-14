/**
 * Dashboard tools — one business-wide financial summary.
 *
 * Mirrors `dashboard_summary` in `packages/mcp/src/tools/dashboard.ts`, with the
 * named periods resolved here in the browser (the tRPC procedure takes only a
 * raw `fromDate`/`toDate` range).
 */

import type { WebMcpToolDefinition } from "../types";
import { enumOf, objectSchema, oneOf } from "./shared";

export const DASHBOARD_PERIODS = [
  "this-fy",
  "this-month",
  "last-month",
  "this-quarter",
  "this-year",
  "all",
] as const;

export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

/** End-of-day for a calendar date, so `toDate` includes the whole last day. */
function endOfDay(year: number, monthIndex: number, day: number): Date {
  return new Date(year, monthIndex, day, 23, 59, 59, 999);
}

/**
 * Resolve a named period to the `{ fromDate, toDate }` the `dashboard.summary`
 * procedure expects. An empty object means "no date filter" — the procedure
 * treats a missing range as all-time.
 *
 * `this-fy` assumes the Indian default financial year (1 April – 31 March). A
 * business configured with a different `financialYearStart` still gets the
 * server's own FY boundary echoed back as `fyStart` in the response.
 */
export function resolvePeriod(
  period: DashboardPeriod,
  now: Date = new Date(),
): { fromDate?: string; toDate?: string } {
  const year = now.getFullYear();
  const month = now.getMonth();

  switch (period) {
    case "this-fy": {
      const fyYear = month >= 3 ? year : year - 1;
      return { fromDate: new Date(fyYear, 3, 1).toISOString() };
    }
    case "this-month":
      return {
        fromDate: new Date(year, month, 1).toISOString(),
        toDate: endOfDay(year, month + 1, 0).toISOString(),
      };
    case "last-month":
      return {
        fromDate: new Date(year, month - 1, 1).toISOString(),
        toDate: endOfDay(year, month, 0).toISOString(),
      };
    case "this-quarter": {
      const q = Math.floor(month / 3);
      return {
        fromDate: new Date(year, q * 3, 1).toISOString(),
        toDate: endOfDay(year, (q + 1) * 3, 0).toISOString(),
      };
    }
    case "this-year":
      return {
        fromDate: new Date(year, 0, 1).toISOString(),
        toDate: endOfDay(year, 11, 31).toISOString(),
      };
    case "all":
      return {};
  }
}

const dashboardSummary: WebMcpToolDefinition = {
  name: "dashboard_summary",
  title: "Business summary",
  description: [
    "Get the headline financials for the active business — sales, purchases, expenses, receivables, payables and cash — for one time period. Use it for 'how are we doing', 'what did we sell this month', 'how much are we owed' questions, before drilling into invoice_list or party_list.",
    "'receivable' is what customers still owe you across open invoices; 'payable' is what you owe suppliers; 'cashInHand' is the balance across all cash and bank accounts. All amounts are decimal strings in INR, e.g. '184250.00'.",
    "'period' defaults to 'this-fy', the current Indian financial year (1 April – 31 March). 'all' removes the date filter entirely. Receivable, payable and cashInHand are point-in-time balances and are not narrowed by the period.",
    "Example: { period: 'this-month' } → { totalSales: '184250.00', totalPurchases: '92000.00', totalExpenses: '31500.00', receivable: '58900.00', payable: '12000.00', cashInHand: '74300.00', fyStart: '2026-04-01T00:00:00.000Z', recentInvoices: [...] }",
  ].join(" "),
  inputSchema: objectSchema({
    period: oneOf(
      DASHBOARD_PERIODS,
      "Time window. 'this-fy' = current Indian financial year (default). 'this-month' / 'last-month' = calendar month. 'this-quarter' = current calendar quarter. 'this-year' = current calendar year. 'all' = no date filter, since the business started.",
      "this-fy",
    ),
  }),
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  requires: { resource: "Report", action: "read" },
  execute: async (input, ctx) => {
    const period = enumOf(input.period, DASHBOARD_PERIODS) ?? "this-fy";
    const range = resolvePeriod(period);
    const summary = await ctx.client.dashboard.summary.query(
      Object.keys(range).length > 0 ? range : undefined,
    );
    return {
      ...summary,
      period,
      periodFrom: range.fromDate ?? null,
      periodTo: range.toDate ?? null,
      currency: "INR",
      note: "Monetary values are decimal strings. receivable/payable/cashInHand are current balances, not period totals.",
    };
  },
};

export const dashboardTools: WebMcpToolDefinition[] = [dashboardSummary];
