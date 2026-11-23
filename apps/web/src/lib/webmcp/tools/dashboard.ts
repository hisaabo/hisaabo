/**
 * Dashboard tools — one business-wide financial summary.
 *
 * Mirrors `dashboard_summary` in `packages/mcp/src/tools/dashboard.ts`, with the
 * named periods resolved here in the browser (the tRPC procedure takes only a
 * raw `fromDate`/`toDate` range).
 */

import {
  businessYearMonth,
  businessMonthStart,
  businessMonthWindow,
  businessFinancialYearWindow,
  businessFinancialYearStartYear,
  windowToQuery,
} from "@hisaabo/shared";
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

/**
 * Resolve a named period to the `{ fromDate, toDate }` the `dashboard.summary`
 * procedure expects. An empty object means "no date filter" — the procedure
 * treats a missing range as all-time.
 *
 * Periods are calendar periods on the business calendar (IST, half-open windows whose
 * `toDate` is the last millisecond before the next one starts), see @hisaabo/shared
 * business-time. `this-fy` assumes the Indian default financial year (1 April – 31 March); it
 * is open-ended (from 1 April, no `toDate`) as before. A business configured with a different
 * `financialYearStart` still gets the server's own FY boundary echoed back as `fyStart`.
 */
export function resolvePeriod(
  period: DashboardPeriod,
  now: Date = new Date(),
): { fromDate?: string; toDate?: string } {
  const { year, month } = businessYearMonth(now);

  switch (period) {
    case "this-fy":
      return { fromDate: businessFinancialYearWindow(businessFinancialYearStartYear(now)).from.toISOString() };
    case "this-month":
      return windowToQuery(businessMonthWindow(year, month));
    case "last-month":
      return windowToQuery(businessMonthWindow(year, month - 1));
    case "this-quarter": {
      const first = Math.floor((month - 1) / 3) * 3 + 1;
      return windowToQuery({ from: businessMonthStart(year, first), before: businessMonthStart(year, first + 3) });
    }
    case "this-year":
      return windowToQuery({ from: businessMonthStart(year, 1), before: businessMonthStart(year + 1, 1) });
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
