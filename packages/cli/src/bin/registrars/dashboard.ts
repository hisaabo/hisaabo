import { Command } from "commander";

export function registerDashboardCommands(program: Command): void {
  const dash = program
    .command("dashboard")
    .alias("dash")
    .description("Business dashboard & analytics");

  // ── summary ──────────────────────────────────────────────────────────────
  dash
    .command("summary")
    .description("Financial summary overview (FY to date)")
    .option("--json", "JSON output")
    .action(async (opts) => {
      const { dashboardCommand } = await import("../../commands/dashboard/summary.js");
      await dashboardCommand({ json: opts.json });
    });

  // ── sales-trend ──────────────────────────────────────────────────────────
  dash
    .command("sales-trend")
    .description("Sales trend over time")
    .option("--months <n>",       "Number of months to show", (v) => parseInt(v, 10))
    .option("--from <date>",      "Start date (YYYY-MM-DD)")
    .option("--to <date>",        "End date (YYYY-MM-DD)")
    .option("--granularity <g>",  "daily | weekly | monthly")
    .option("--json",             "JSON output")
    .option("--format <format>",  "table | tsv | csv")
    .action(async (opts) => {
      const { dashboardSalesTrendCommand } = await import("../../commands/dashboard/sales-trend.js");
      await dashboardSalesTrendCommand(opts);
    });

  // ── top-outstanding ───────────────────────────────────────────────────────
  dash
    .command("top-outstanding")
    .description("Parties with highest outstanding balances")
    .option("--limit <n>",        "Max rows to show", (v) => parseInt(v, 10))
    .option("--json",             "JSON output")
    .option("--format <format>",  "table | tsv | csv")
    .action(async (opts) => {
      const { dashboardTopOutstandingCommand } = await import("../../commands/dashboard/top-outstanding.js");
      await dashboardTopOutstandingCommand(opts);
    });

  // ── top-customers ─────────────────────────────────────────────────────────
  dash
    .command("top-customers")
    .description("Top customers by revenue")
    .option("--limit <n>",        "Max rows to show", (v) => parseInt(v, 10))
    .option("--from <date>",      "Start date (YYYY-MM-DD)")
    .option("--to <date>",        "End date (YYYY-MM-DD)")
    .option("--this-month",       "Filter to current calendar month")
    .option("--this-fy",          "Filter to current financial year")
    .option("--json",             "JSON output")
    .option("--format <format>",  "table | tsv | csv")
    .action(async (opts) => {
      const { dashboardTopCustomersCommand } = await import("../../commands/dashboard/top-customers.js");
      await dashboardTopCustomersCommand({
        limit:     opts.limit,
        from:      opts.from,
        to:        opts.to,
        thisMonth: opts.thisMonth,
        thisFy:    opts.thisFy,
        json:      opts.json,
        format:    opts.format,
      });
    });

  // ── top-items ─────────────────────────────────────────────────────────────
  dash
    .command("top-items")
    .description("Top selling items by revenue and quantity")
    .option("--limit <n>",        "Max rows to show", (v) => parseInt(v, 10))
    .option("--type <type>",      "Item type filter (product | service)")
    .option("--from <date>",      "Start date (YYYY-MM-DD)")
    .option("--to <date>",        "End date (YYYY-MM-DD)")
    .option("--this-month",       "Filter to current calendar month")
    .option("--this-fy",          "Filter to current financial year")
    .option("--json",             "JSON output")
    .option("--format <format>",  "table | tsv | csv")
    .action(async (opts) => {
      const { dashboardTopItemsCommand } = await import("../../commands/dashboard/top-items.js");
      await dashboardTopItemsCommand({
        limit:     opts.limit,
        type:      opts.type,
        from:      opts.from,
        to:        opts.to,
        thisMonth: opts.thisMonth,
        thisFy:    opts.thisFy,
        json:      opts.json,
        format:    opts.format,
      });
    });

  // ── expenses (alias: expenses-by-category) ───────────────────────────────
  const expensesCmd = dash
    .command("expenses")
    .description("Expenses broken down by category")
    .option("--from <date>",      "Start date (YYYY-MM-DD)")
    .option("--to <date>",        "End date (YYYY-MM-DD)")
    .option("--this-month",       "Filter to current calendar month")
    .option("--this-fy",          "Filter to current financial year")
    .option("--json",             "JSON output")
    .option("--format <format>",  "table | tsv | csv")
    .action(async (opts) => {
      const { dashboardExpensesCommand } = await import("../../commands/dashboard/expenses.js");
      await dashboardExpensesCommand({
        from:      opts.from,
        to:        opts.to,
        thisMonth: opts.thisMonth,
        thisFy:    opts.thisFy,
        json:      opts.json,
        format:    opts.format,
      });
    });
  expensesCmd.alias("expenses-by-category");

  // ── invoice-breakdown ─────────────────────────────────────────────────────
  dash
    .command("invoice-breakdown")
    .description("Invoice count and amounts by status")
    .option("--from <date>",      "Start date (YYYY-MM-DD)")
    .option("--to <date>",        "End date (YYYY-MM-DD)")
    .option("--this-month",       "Filter to current calendar month")
    .option("--this-fy",          "Filter to current financial year")
    .option("--json",             "JSON output")
    .action(async (opts) => {
      const { dashboardInvoiceBreakdownCommand } = await import("../../commands/dashboard/invoice-breakdown.js");
      await dashboardInvoiceBreakdownCommand({
        from:      opts.from,
        to:        opts.to,
        thisMonth: opts.thisMonth,
        thisFy:    opts.thisFy,
        json:      opts.json,
      });
    });

  // ── profit-loss (alias: pl) ───────────────────────────────────────────────
  const plCmd = dash
    .command("profit-loss")
    .description("Profit & Loss statement")
    .option("--from <date>",      "Start date (YYYY-MM-DD, default: FY start)")
    .option("--to <date>",        "End date (YYYY-MM-DD, default: today)")
    .option("--this-month",       "Scope to current calendar month")
    .option("--this-fy",          "Scope to current financial year")
    .option("--json",             "JSON output")
    .action(async (opts) => {
      const { dashboardProfitLossCommand } = await import("../../commands/dashboard/profit-loss.js");
      await dashboardProfitLossCommand({
        from:      opts.from,
        to:        opts.to,
        thisMonth: opts.thisMonth,
        thisFy:    opts.thisFy,
        json:      opts.json,
      });
    });
  plCmd.alias("pl");

  // ── receivables-aging ─────────────────────────────────────────────────────
  dash
    .command("receivables-aging")
    .description("Receivables aging buckets (current / 1-30 / 31-60 / 61-90 / 90+)")
    .option("--json",             "JSON output")
    .option("--format <format>",  "table | tsv | csv")
    .action(async (opts) => {
      const { dashboardReceivablesAgingCommand } = await import("../../commands/dashboard/receivables-aging.js");
      await dashboardReceivablesAgingCommand({ json: opts.json, format: opts.format });
    });

  // ── payment-modes ─────────────────────────────────────────────────────────
  dash
    .command("payment-modes")
    .description("Payment mode breakdown (cash / UPI / bank transfer / etc.)")
    .option("--from <date>",      "Start date (YYYY-MM-DD)")
    .option("--to <date>",        "End date (YYYY-MM-DD)")
    .option("--this-month",       "Filter to current calendar month")
    .option("--this-fy",          "Filter to current financial year")
    .option("--json",             "JSON output")
    .option("--format <format>",  "table | tsv | csv")
    .action(async (opts) => {
      const { dashboardPaymentModesCommand } = await import("../../commands/dashboard/payment-modes.js");
      await dashboardPaymentModesCommand({
        from:      opts.from,
        to:        opts.to,
        thisMonth: opts.thisMonth,
        thisFy:    opts.thisFy,
        json:      opts.json,
        format:    opts.format,
      });
    });

  // ── collection-efficiency ─────────────────────────────────────────────────
  dash
    .command("collection-efficiency")
    .description("Collection rate, DSO, and aging breakdown")
    .option("--from <date>",      "Start date (YYYY-MM-DD)")
    .option("--to <date>",        "End date (YYYY-MM-DD)")
    .option("--this-month",       "Filter to current calendar month")
    .option("--this-fy",          "Filter to current financial year")
    .option("--json",             "JSON output")
    .option("--format <format>",  "table | tsv | csv")
    .action(async (opts) => {
      const { dashboardCollectionEfficiencyCommand } = await import("../../commands/dashboard/collection-efficiency.js");
      await dashboardCollectionEfficiencyCommand({
        from:      opts.from,
        to:        opts.to,
        thisMonth: opts.thisMonth,
        thisFy:    opts.thisFy,
        json:      opts.json,
        format:    opts.format,
      });
    });

  // ── monthly-comparison ────────────────────────────────────────────────────
  dash
    .command("monthly-comparison")
    .description("Month-over-month comparison of sales, expenses, profit, and collections")
    .option("--json",             "JSON output")
    .option("--format <format>",  "table | tsv | csv")
    .action(async (opts) => {
      const { dashboardMonthlyComparisonCommand } = await import("../../commands/dashboard/monthly-comparison.js");
      await dashboardMonthlyComparisonCommand({ json: opts.json, format: opts.format });
    });
}
