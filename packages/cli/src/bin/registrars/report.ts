import { Command } from "commander";
import {
  reportDaybookCommand, reportOutstandingCommand, reportTaxSummaryCommand,
  reportItemSalesCommand, reportStockSummaryCommand,
  reportSalesRegisterCommand, reportPurchaseRegisterCommand,
  reportPartyStatementCommand, reportPaymentSummaryCommand,
  reportCashFlowCommand, reportCollectionEfficiencyCommand,
  reportTrialBalanceCommand, reportBalanceSheetCommand,
  reportCashFlowStatementCommand, reportGeneralLedgerCommand,
} from "../../commands/report/index.js";

export function registerReportCommands(program: Command): void {
  // ── report ────────────────────────────────────────────────────────────────

  const report = program.command("report").description("Business reports");

  report
    .command("daybook")
    .description("Day book report (all transactions)")
    .option("--json", "JSON output")
    .option("--format <format>", "tsv or csv")
    .option("--from <date>", "From date")
    .option("--to <date>", "To date")
    .option("--this-month", "Current month")
    .option("--this-fy", "Current financial year")
    .action(async (opts) => {
      await reportDaybookCommand(opts);
    });

  report
    .command("outstanding")
    .description("Outstanding receivables and payables")
    .option("--json", "JSON output")
    .option("--type <type>", "receivable, payable, or both")
    .action(async (opts) => {
      await reportOutstandingCommand({ json: opts.json, type: opts.type });
    });

  report
    .command("tax-summary")
    .description("Tax summary by rate")
    .option("--json", "JSON output")
    .option("--from <date>", "From date")
    .option("--to <date>", "To date")
    .option("--this-fy", "Current financial year")
    .action(async (opts) => {
      await reportTaxSummaryCommand(opts);
    });

  report
    .command("item-sales")
    .description("Item sales report")
    .option("--json", "JSON output")
    .option("--from <date>", "From date")
    .option("--to <date>", "To date")
    .option("--this-fy", "Current financial year")
    .action(async (opts) => {
      await reportItemSalesCommand(opts);
    });

  report
    .command("stock")
    .description("Stock summary report")
    .option("--json", "JSON output")
    .option("--category <cat>", "Filter by category")
    .action(async (opts) => {
      await reportStockSummaryCommand({ json: opts.json, category: opts.category });
    });

  report
    .command("sales-register")
    .description("Sales invoice listing")
    .option("--json", "JSON output")
    .option("--format <format>", "table, tsv or csv")
    .option("--from <date>", "From date")
    .option("--to <date>", "To date")
    .option("--this-month", "Current month")
    .option("--this-fy", "Current financial year")
    .option("--party-id <id>", "Filter by party ID")
    .action(async (opts) => {
      await reportSalesRegisterCommand(opts);
    });

  report
    .command("purchase-register")
    .description("Purchase invoice listing")
    .option("--json", "JSON output")
    .option("--format <format>", "table, tsv or csv")
    .option("--from <date>", "From date")
    .option("--to <date>", "To date")
    .option("--this-month", "Current month")
    .option("--this-fy", "Current financial year")
    .option("--party-id <id>", "Filter by party ID")
    .action(async (opts) => {
      await reportPurchaseRegisterCommand(opts);
    });

  report
    .command("party-statement <partyId>")
    .description("Party transaction statement")
    .option("--json", "JSON output")
    .option("--format <format>", "table, tsv or csv")
    .option("--from <date>", "From date")
    .option("--to <date>", "To date")
    .option("--this-month", "Current month")
    .option("--this-fy", "Current financial year")
    .action(async (partyId: string, opts) => {
      await reportPartyStatementCommand(partyId, opts);
    });

  report
    .command("payment-summary")
    .description("Payment summary by mode")
    .option("--json", "JSON output")
    .option("--format <format>", "table, tsv or csv")
    .option("--from <date>", "From date")
    .option("--to <date>", "To date")
    .option("--this-month", "Current month")
    .option("--this-fy", "Current financial year")
    .option("--type <type>", "received, made, or both")
    .action(async (opts) => {
      await reportPaymentSummaryCommand(opts);
    });

  report
    .command("cash-flow")
    .description("Cash flow forecast")
    .option("--json", "JSON output")
    .action(async (opts) => {
      await reportCashFlowCommand({ json: opts.json });
    });

  report
    .command("collection-efficiency")
    .description("Collection efficiency metrics")
    .option("--json", "JSON output")
    .option("--from <date>", "From date")
    .option("--to <date>", "To date")
    .option("--this-month", "Current month")
    .option("--this-fy", "Current financial year")
    .action(async (opts) => {
      await reportCollectionEfficiencyCommand(opts);
    });

  report
    .command("trial-balance")
    .description("Trial balance report")
    .option("--json", "JSON output")
    .option("--to <date>", "As of date")
    .option("--this-fy", "Current financial year")
    .action(async (opts) => {
      await reportTrialBalanceCommand(opts);
    });

  report
    .command("balance-sheet")
    .description("Balance sheet")
    .option("--json", "JSON output")
    .option("--to <date>", "As of date")
    .option("--this-fy", "Current financial year")
    .action(async (opts) => {
      await reportBalanceSheetCommand(opts);
    });

  report
    .command("cash-flow-statement")
    .description("Cash flow statement (operating/investing/financing)")
    .option("--json", "JSON output")
    .option("--from <date>", "From date")
    .option("--to <date>", "To date")
    .option("--this-fy", "Current financial year")
    .action(async (opts) => {
      await reportCashFlowStatementCommand(opts);
    });

  report
    .command("general-ledger <accountId>")
    .description("General ledger for a specific account")
    .option("--json", "JSON output")
    .option("--from <date>", "From date")
    .option("--to <date>", "To date")
    .option("--this-fy", "Current financial year")
    .action(async (accountId: string, opts) => {
      await reportGeneralLedgerCommand(accountId, opts);
    });
}
