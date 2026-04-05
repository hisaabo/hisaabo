/**
 * MCP Prompt templates — guided workflows for common business tasks.
 *
 * Prompts registered:
 *   morning_briefing     — daily business summary
 *   party_deep_dive      — complete analysis of a single party
 *   gst_filing_prep      — GST return preparation checklist
 *   collection_follow_up — overdue invoice collection list
 *   inventory_health     — stock health check
 *   month_close          — month-end close checklist
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerPrompts(server: McpServer): void {
  server.prompt(
    "morning_briefing",
    "Daily business summary: sales, receivables, payables, cash position, and action items.",
    {},
    async () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              "Give me a morning briefing for my business. Follow these steps:",
              "",
              "1. Call `dashboard_summary` with period='this-month' to get the current month's financials.",
              "2. Call `invoice_list` with status='overdue' to find overdue invoices.",
              "3. Call `invoice_list` with status='draft' to find invoices that haven't been sent yet.",
              "4. Call `report_outstanding` to get the aging breakdown of receivables and payables.",
              "5. Call `bank_account_summary` to get the total cash position across all accounts.",
              "",
              "Summarize the results in a concise morning briefing with these sections:",
              "- Financial snapshot (sales, expenses, profit for the month so far)",
              "- Cash position (total across all bank and cash accounts)",
              "- Receivables and payables summary with aging buckets",
              "- Action items: overdue invoices that need follow-up, draft invoices to send",
              "- Any other observations or red flags",
            ].join("\n"),
          },
        },
      ],
    })
  );

  server.prompt(
    "party_deep_dive",
    "Complete analysis of a customer or supplier: transactions, outstanding balance, top items, and payment history.",
    {
      party_name: z.string().describe("Name (or partial name) of the customer or supplier to analyze."),
    },
    async ({ party_name }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Run a deep-dive analysis on the party "${party_name}". Follow these steps:`,
              "",
              `1. Call \`party_list\` with search='${party_name}' to find the party and get their UUID and outstanding balance.`,
              "2. Call `party_get` with the party UUID to get full details (GSTIN, address, credit limit, etc.).",
              "3. Call `party_get_stats` with the party UUID to get invoice and payment counts.",
              "4. Call `party_top_items` with the party UUID to see which items they buy/sell most.",
              "5. Call `party_ledger` with the party UUID to get their full transaction history.",
              "6. Call `invoice_list` with party_id set to the UUID and status='overdue' to find overdue invoices.",
              "",
              "Compile the results into a comprehensive party profile with these sections:",
              "- Party details (name, type, GSTIN, contact info, credit terms)",
              "- Financial summary (total invoiced, total paid, outstanding balance)",
              "- Transaction history highlights (recent invoices and payments)",
              "- Top items transacted (by revenue or quantity)",
              "- Outstanding and overdue invoices with amounts and dates",
              "- Recommendations (credit risk assessment, follow-up actions)",
            ].join("\n"),
          },
        },
      ],
    })
  );

  server.prompt(
    "gst_filing_prep",
    "GST return preparation: generate GSTR-1/3B data, validate totals, and flag issues for a given month.",
    {
      month: z.string().describe("Month number (1-12, e.g. '3' for March)."),
      year: z.string().describe("Four-digit year (e.g. '2025')."),
    },
    async ({ month, year }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Prepare GST filing data for ${month}/${year}. Follow these steps:`,
              "",
              `1. Call \`gst_report\` with month=${month} and year=${year} and report_type='gstr1' to get the GSTR-1 summary.`,
              `2. Call \`gst_report\` with month=${month} and year=${year} and report_type='gstr3b' to get the GSTR-3B summary.`,
              `3. Call \`report_tax_summary\` for the same period to cross-check tax collected and paid by rate.`,
              `4. Call \`invoice_list\` with type='sale' and the date range for ${month}/${year} to verify invoice count.`,
              `5. Call \`invoice_list\` with type='purchase' and the date range for ${month}/${year} to verify purchase count.`,
              "",
              "Compile the results into a GST filing prep report with these sections:",
              "- GSTR-1 summary: B2B, B2C, credit notes, debit notes, HSN summary",
              "- GSTR-3B summary: outward supplies, inward supplies eligible for ITC, tax payable",
              "- Tax reconciliation: compare tax collected (output) vs tax paid (input), net liability",
              "- Data quality checks: invoices missing GSTIN, invoices with zero tax that should have GST",
              "- Counts: total sale invoices, purchase bills, credit notes, debit notes for the period",
              "- Any discrepancies or flags that need manual review before filing",
            ].join("\n"),
          },
        },
      ],
    })
  );

  server.prompt(
    "collection_follow_up",
    "Generate a prioritized list of overdue invoices with party contact details for collection follow-up.",
    {},
    async () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              "Generate a collection follow-up list for overdue invoices. Follow these steps:",
              "",
              "1. Call `invoice_list` with status='overdue' and type='sale' to get all overdue sale invoices.",
              "2. Call `report_outstanding` to get the aging breakdown (current, 1-30, 31-60, 61-90, 90+ days).",
              "3. For the top overdue parties (by amount), call `party_get` to retrieve contact details.",
              "4. Call `party_ledger` for the largest debtors to see their recent payment history.",
              "",
              "Compile the results into a collection action list with these sections:",
              "- Summary: total overdue amount, number of overdue invoices, number of parties",
              "- Aging breakdown: amounts in each bucket (1-30, 31-60, 61-90, 90+ days)",
              "- Priority list: parties sorted by overdue amount (highest first), each with:",
              "  - Party name and contact information",
              "  - Total overdue amount and oldest invoice date",
              "  - List of overdue invoice numbers with amounts and days overdue",
              "  - Last payment date and amount (to gauge payment pattern)",
              "- Suggested actions for each party (call, email, send reminder, escalate)",
            ].join("\n"),
          },
        },
      ],
    })
  );

  server.prompt(
    "inventory_health",
    "Stock health check: low stock alerts, dead stock, fast movers, and stock valuation summary.",
    {},
    async () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              "Run an inventory health check. Follow these steps:",
              "",
              "1. Call `report_stock_summary` to get current stock levels and values for all items.",
              "2. Call `item_low_stock_count` to check how many items are below their low-stock threshold.",
              "3. Call `item_list` with sort_by='stock' and sort_dir='asc' to find items with the lowest stock.",
              "4. Call `report_item_sales` for the last 3 months to identify fast-moving and slow-moving items.",
              "5. Call `item_categories` to see the category breakdown.",
              "",
              "Compile the results into an inventory health report with these sections:",
              "- Stock valuation: total inventory value across all items",
              "- Low stock alerts: items below their reorder threshold with current quantity vs threshold",
              "- Out of stock: items with zero quantity that had sales in the last 3 months",
              "- Fast movers: top 10 items by quantity sold (may need restocking soon)",
              "- Slow movers / dead stock: items with stock on hand but zero or minimal sales in 3 months",
              "- Category breakdown: stock value and item count by category",
              "- Recommendations: reorder suggestions, dead stock disposal candidates",
            ].join("\n"),
          },
        },
      ],
    })
  );

  server.prompt(
    "month_close",
    "Month-end close checklist: reconcile sales, expenses, payments, and bank balances for a given month.",
    {
      month: z.string().describe("Month number (1-12, e.g. '3' for March)."),
      year: z.string().describe("Four-digit year (e.g. '2025')."),
    },
    async ({ month, year }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Run the month-end close checklist for ${month}/${year}. Follow these steps:`,
              "",
              `1. Call \`report_daybook\` with the full date range for ${month}/${year} to get all transactions.`,
              `2. Call \`dashboard_summary\` with period='custom' and the date range for ${month}/${year}.`,
              `3. Call \`invoice_list\` with status='draft' and the date range to find unsent invoices.`,
              `4. Call \`report_outstanding\` to check receivables and payables at month-end.`,
              `5. Call \`expense_list\` with the date range for ${month}/${year} to review all expenses.`,
              "6. Call `bank_account_summary` to get current bank and cash balances.",
              `7. Call \`report_payment_summary\` for ${month}/${year} to see payment trends by mode.`,
              "",
              "Compile the results into a month-end close report with these sections:",
              "- Revenue summary: total sales invoiced, by type (sale vs purchase)",
              "- Expense summary: total expenses by category",
              "- Profit & loss: revenue minus expenses for the month",
              "- Payment summary: collections received, payments made, broken down by mode",
              "- Outstanding items: receivables and payables at month-end",
              "- Open issues:",
              "  - Draft invoices that were never sent",
              "  - Payments not linked to bank accounts (untracked)",
              "  - Large discrepancies between invoiced amount and collected amount",
              "- Bank reconciliation: compare bank account balances with expected totals",
              "- Action items: things to resolve before closing the month",
            ].join("\n"),
          },
        },
      ],
    })
  );
}
