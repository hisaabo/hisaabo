/**
 * Expense tools — track business expenses.
 *
 * Tools registered:
 *   expense_create — record a business expense
 *   expense_list   — list expenses with filtering
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HisaaboClient } from "../client.js";
import { wrapTool } from "../lib/errors.js";
import { MAX_PAGE_SIZE, withPaginationMeta } from "../lib/pagination.js";

const PAYMENT_MODES = ["cash", "bank", "upi", "cheque", "other"] as const;

export function registerExpenseTools(server: McpServer, client: HisaaboClient) {

  server.tool(
    "expense_create",
    [
      "Record a business expense (operating cost, overhead, etc.).",
      "Category is a free-form label — use consistent names like 'Rent', 'Utilities', 'Salaries', 'Travel'.",
      "Expenses appear in the dashboard summary's 'totalExpenses' and affect the P&L.",
    ].join(" "),
    {
      category: z.string().min(1).max(100)
        .describe("Expense category, e.g. 'Rent', 'Electricity', 'Office Supplies', 'Travel'."),
      amount: z.string().regex(/^\d+(\.\d{1,2})?$/)
        .describe("Expense amount as decimal string, e.g. '12000.00'."),
      mode: z.enum(PAYMENT_MODES)
        .describe("Payment method used: 'cash', 'bank', 'upi', 'cheque', or 'other'."),
      description: z.string().max(500).optional()
        .describe("Additional details, e.g. 'Office rent for March 2024'."),
      expense_date: z.string().datetime().optional()
        .describe("Date of the expense (ISO 8601). Defaults to today."),
      reference_number: z.string().max(100).optional()
        .describe("Bill number, receipt number, or transaction ID."),
    },
    wrapTool(async (input) => {
      const expense = await client.expense.create({
        category: input.category,
        amount: input.amount,
        mode: input.mode,
        description: input.description,
        expenseDate: input.expense_date,
        referenceNumber: input.reference_number,
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(expense, null, 2),
        }],
      };
    })
  );

  server.tool(
    "expense_list",
    [
      "List business expenses, optionally filtered by category or date range.",
      "Use this to answer 'How much did we spend on rent this year?' or 'Show me all expenses in March'.",
    ].join(" "),
    {
      category: z.string().max(100).optional()
        .describe("Filter by expense category (exact match)."),
      from_date: z.string().datetime().optional()
        .describe("Start date (ISO 8601)."),
      to_date: z.string().datetime().optional()
        .describe("End date (ISO 8601)."),
      search: z.string().max(200).optional()
        .describe("Search by description or reference number."),
      page: z.number().int().min(1).default(1)
        .describe("Page number for pagination."),
    },
    wrapTool(async (input) => {
      const result = await client.expense.list({
        category: input.category,
        fromDate: input.from_date,
        toDate: input.to_date,
        search: input.search,
        page: input.page,
        limit: MAX_PAGE_SIZE,
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(withPaginationMeta(result), null, 2),
        }],
      };
    })
  );
}
