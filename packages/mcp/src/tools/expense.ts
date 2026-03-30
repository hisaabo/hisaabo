/**
 * Expense tools — track business expenses.
 *
 * Tools registered:
 *   expense_create     — record a business expense
 *   expense_list       — list expenses with filtering
 *   expense_update     — update an existing expense record
 *   expense_delete     — soft-delete an expense
 *   expense_categories — list all distinct expense categories
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
    "expense_update",
    [
      "Update an existing expense record.",
      "Only provide fields you want to change — all other fields remain unchanged.",
    ].join(" "),
    {
      expense_id: z.string().uuid()
        .describe("Expense UUID to update."),
      category: z.string().min(1).max(100).optional()
        .describe("Updated expense category."),
      amount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional()
        .describe("Updated expense amount as decimal string."),
      mode: z.enum(PAYMENT_MODES).optional()
        .describe("Updated payment method."),
      description: z.string().max(500).optional()
        .describe("Updated description."),
      expense_date: z.string().datetime().optional()
        .describe("Updated expense date (ISO 8601)."),
      reference_number: z.string().max(100).optional()
        .describe("Updated bill number or receipt number."),
    },
    wrapTool(async (input) => {
      const expense = await client.expense.update(input.expense_id, {
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
    "expense_delete",
    [
      "Soft-delete an expense record. Requires admin role.",
      "The expense is hidden from all lists and reports after deletion.",
    ].join(" "),
    {
      expense_id: z.string().uuid()
        .describe("Expense UUID to delete."),
    },
    wrapTool(async (input) => {
      const result = await client.expense.delete(input.expense_id);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  server.tool(
    "expense_categories",
    [
      "Get a list of all distinct expense categories used in the business.",
      "Use this to discover existing category names before filtering expense_list or creating new expenses with consistent categories.",
    ].join(" "),
    {},
    wrapTool(async (_input) => {
      const categories = await client.expense.categories();
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(categories, null, 2),
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
