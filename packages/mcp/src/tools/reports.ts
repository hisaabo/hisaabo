/**
 * Business report tools — financial analysis and summaries.
 *
 * Tools registered:
 *   report_daybook         — daily transaction log (invoices + payments + expenses)
 *   report_outstanding     — outstanding receivables/payables with aging buckets
 *   report_tax_summary     — tax collected/paid summary by rate
 *   report_item_sales      — item-wise sales analysis with revenue and quantity
 *   report_stock_summary   — current stock levels and values
 *   report_party_statement — party balance statement with transaction history
 *   report_payment_summary — payment trends by mode and type
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HisaaboClient } from "../client.js";
import { wrapTool } from "../lib/errors.js";

export function registerReportTools(server: McpServer, client: HisaaboClient) {

  server.tool(
    "report_daybook",
    [
      "Get the daybook (daily transaction log) for a date range.",
      "Returns all invoices, payments, and expenses in chronological order with debit/credit columns.",
      "Use type_filter to narrow to only invoices, payments, or expenses.",
      "The summary shows totals: sales invoiced, purchases invoiced, payments received, payments made, expenses, and net cash movement.",
      "Dates are plain date strings (YYYY-MM-DD), not ISO datetime.",
    ].join(" "),
    {
      from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
        .describe("Start date in YYYY-MM-DD format, e.g. '2024-04-01'."),
      to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
        .describe("End date in YYYY-MM-DD format, e.g. '2024-04-30'."),
      type_filter: z.enum(["all", "invoices", "payments", "expenses"]).default("all")
        .describe("'all' = everything, 'invoices' = only invoice entries, 'payments' = only payment entries, 'expenses' = only expense entries."),
    },
    wrapTool(async (input) => {
      const result = await client.reports.daybook({
        fromDate: input.from_date,
        toDate: input.to_date,
        typeFilter: input.type_filter,
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  server.tool(
    "report_outstanding",
    [
      "Get outstanding receivables (what customers owe you) and/or payables (what you owe suppliers).",
      "Results are grouped by party with aging buckets: current (0-30 days), 31-60 days, 61-90 days, 90+ days.",
      "Use type='receivable' for unpaid customer invoices, 'payable' for unpaid supplier bills, 'both' for all.",
      "as_of_date lets you see outstanding amounts as of a specific past date.",
    ].join(" "),
    {
      type: z.enum(["receivable", "payable", "both"]).default("receivable")
        .describe("'receivable' = unpaid customer invoices, 'payable' = unpaid supplier bills, 'both' = all outstanding."),
      as_of_date: z.string().datetime().optional()
        .describe("Calculate outstanding as of this date (ISO 8601). Defaults to today."),
    },
    wrapTool(async (input) => {
      const result = await client.reports.outstanding({
        type: input.type,
        asOfDate: input.as_of_date,
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  server.tool(
    "report_tax_summary",
    [
      "Get a tax summary (GST collected/paid) for a date range, broken down by tax rate.",
      "Use this to answer 'How much GST did we collect this month?' or 'What is our total ITC (input tax credit)?'",
      "Results are grouped by tax rate (0%, 5%, 12%, 18%, 28%) showing taxable amount and tax amount.",
      "type='sales' = output tax (collected from customers), 'purchases' = input tax (ITC from suppliers).",
    ].join(" "),
    {
      from_date: z.string().datetime()
        .describe("Start date (ISO 8601)."),
      to_date: z.string().datetime()
        .describe("End date (ISO 8601)."),
      type: z.enum(["sales", "purchases", "both"]).default("both")
        .describe("'sales' = tax on outward supplies, 'purchases' = input tax credit, 'both' = combined."),
    },
    wrapTool(async (input) => {
      const result = await client.reports.taxSummary({
        fromDate: input.from_date,
        toDate: input.to_date,
        type: input.type,
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  server.tool(
    "report_item_sales",
    [
      "Get item-wise sales analysis for a date range.",
      "Returns revenue, quantity sold, invoice count, and margin for each item.",
      "Use sort_by to rank items by revenue (default), quantity, number of invoices, or profit margin.",
      "Use compare_to_previous=true to include comparison with the equivalent prior period.",
      "Use this to answer 'What were our top-selling products this quarter?' or 'Which items have the best margins?'",
    ].join(" "),
    {
      from_date: z.string().datetime()
        .describe("Start date (ISO 8601)."),
      to_date: z.string().datetime()
        .describe("End date (ISO 8601)."),
      category: z.string().max(100).optional()
        .describe("Filter by item category."),
      item_type: z.enum(["product", "service"]).optional()
        .describe("'product' for physical goods, 'service' for services."),
      sort_by: z.enum(["revenue", "quantity", "invoices", "margin"]).default("revenue")
        .describe("Sort by: 'revenue' (total sales amount), 'quantity' (units sold), 'invoices' (order count), 'margin' (profit)."),
      compare_to_previous: z.boolean().default(false)
        .describe("If true, include comparison data from the previous equivalent period."),
    },
    wrapTool(async (input) => {
      const result = await client.reports.itemSales({
        fromDate: input.from_date,
        toDate: input.to_date,
        category: input.category,
        itemType: input.item_type,
        sortBy: input.sort_by,
        compareToPrevious: input.compare_to_previous,
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  server.tool(
    "report_stock_summary",
    [
      "Get current stock levels and values for all inventory items.",
      "Returns quantity on hand, sale value, and purchase value for each product.",
      "Use category to filter by product category.",
      "Set show_zero_stock=true to include items with zero stock (useful for identifying out-of-stock items).",
      "Use this to answer 'What is the total value of our inventory?' or 'Which products are out of stock?'",
    ].join(" "),
    {
      category: z.string().max(100).optional()
        .describe("Filter by item category."),
      show_zero_stock: z.boolean().default(false)
        .describe("If true, include items with zero stock. Default false (only items with stock > 0)."),
    },
    wrapTool(async (input) => {
      const result = await client.reports.stockSummary({
        category: input.category,
        showZeroStock: input.show_zero_stock,
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  server.tool(
    "report_party_statement",
    [
      "Get a party (customer or supplier) account statement showing all transactions and running balance.",
      "Returns invoices, payments, credit notes, and other entries in chronological order.",
      "Use this to answer 'Show me the complete transaction history with Customer X' or 'What is the account statement for this supplier?'",
      "Note: for a quick balance only, use party_get instead.",
    ].join(" "),
    {
      party_id: z.string().uuid()
        .describe("Party UUID from party_list or party_get."),
      from_date: z.string().datetime().optional()
        .describe("Start date for the statement (ISO 8601). Omit for full history."),
      to_date: z.string().datetime().optional()
        .describe("End date for the statement (ISO 8601)."),
    },
    wrapTool(async (input) => {
      const result = await client.reports.partyStatement({
        partyId: input.party_id,
        fromDate: input.from_date,
        toDate: input.to_date,
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  server.tool(
    "report_payment_summary",
    [
      "Get a payment summary showing trends by payment mode (cash, UPI, bank, cheque) over a date range.",
      "Use type='received' for incoming payments from customers, 'made' for payments to suppliers, 'both' for all.",
      "Filter by bank_account_id to see payments for a specific account.",
      "Use this to answer 'How much did we receive via UPI this month?' or 'What were our total bank deposits?'",
    ].join(" "),
    {
      from_date: z.string().datetime()
        .describe("Start date (ISO 8601)."),
      to_date: z.string().datetime()
        .describe("End date (ISO 8601)."),
      type: z.enum(["received", "made", "both"]).default("both")
        .describe("'received' = payments from customers, 'made' = payments to suppliers, 'both' = all."),
      bank_account_id: z.string().uuid().optional()
        .describe("Filter to payments recorded against a specific bank/cash account."),
    },
    wrapTool(async (input) => {
      const result = await client.reports.paymentSummary({
        fromDate: input.from_date,
        toDate: input.to_date,
        type: input.type,
        bankAccountId: input.bank_account_id,
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );
}
