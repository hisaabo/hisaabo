import { Command } from "commander";
import {
  automatedInvoiceListCommand, automatedInvoiceGetCommand, automatedInvoiceCreateCommand,
  automatedInvoiceUpdateCommand,
  automatedInvoicePauseCommand, automatedInvoiceResumeCommand, automatedInvoiceRunNowCommand,
  automatedInvoiceDeleteCommand,
  automatedInvoiceHistoryCommand,
  automatedInvoiceUsageCommand,
  automatedInvoiceSuggestionsCommand,
} from "../../commands/automated-invoice/index.js";

export function registerAutomatedInvoiceCommands(program: Command): void {
  // ── automated-invoice ────────────────────────────────────────────────────

  const automatedInvoice = program.command("automated-invoice").alias("auto-inv").description("Recurring / automated invoice management");

  automatedInvoice
    .command("list")
    .description("List recurring invoice templates")
    .option("--json", "JSON output")
    .option("--format <format>", "Output format: table, tsv, csv, ids")
    .option("--status <status>", "Filter by status: active, paused, completed, expired")
    .option("--page <n>", "Page number", parseInt)
    .option("--limit <n>", "Items per page", parseInt)
    .action(async (opts) => {
      await automatedInvoiceListCommand({
        json: opts.json,
        format: opts.format,
        status: opts.status,
        page: opts.page,
        limit: opts.limit,
      });
    });

  automatedInvoice
    .command("get <id>")
    .description("Get recurring invoice template details")
    .option("--json", "JSON output")
    .action(async (id, opts) => {
      await automatedInvoiceGetCommand(id, { json: opts.json });
    });

  automatedInvoice
    .command("create")
    .description("Create a new recurring invoice template")
    .option("--json", "JSON output")
    .option("--party-id <id>", "Party UUID")
    .option("--name <name>", "Template name")
    .option("--type <type>", "sale or purchase")
    .option("--frequency <freq>", "weekly/biweekly/monthly/quarterly/half_yearly/yearly/custom")
    .option("--custom-interval-days <n>", "Custom interval in days (when frequency is custom)")
    .option("--line-item <desc>", "Line item description (repeatable)", (v: string, a: string[]) => [...a, v], [] as string[])
    .option("--qty <n>", "Quantity (per --line-item)", (v: string, a: string[]) => [...a, v], [] as string[])
    .option("--rate <n>", "Unit price (per --line-item)", (v: string, a: string[]) => [...a, v], [] as string[])
    .option("--tax <n>", "Tax percent (per --line-item)", (v: string, a: string[]) => [...a, v], [] as string[])
    .option("--discount <n>", "Discount percent (per --line-item)", (v: string, a: string[]) => [...a, v], [] as string[])
    .option("--start-date <date>", "Start date (YYYY-MM-DD)")
    .option("--end-date <date>", "End date (YYYY-MM-DD)")
    .option("--max-runs <n>", "Maximum number of runs")
    .option("--notes <text>", "Notes")
    .action(async (opts) => {
      await automatedInvoiceCreateCommand({
        json: opts.json,
        partyId: opts.partyId,
        name: opts.name,
        type: opts.type,
        frequency: opts.frequency,
        customIntervalDays: opts.customIntervalDays,
        lineItem: opts.lineItem,
        qty: opts.qty,
        rate: opts.rate,
        tax: opts.tax,
        discount: opts.discount,
        startDate: opts.startDate,
        endDate: opts.endDate,
        maxRuns: opts.maxRuns,
        notes: opts.notes,
      });
    });

  automatedInvoice
    .command("pause <id>")
    .description("Pause an active recurring invoice template")
    .option("--json", "JSON output")
    .action(async (id, opts) => {
      await automatedInvoicePauseCommand(id, { json: opts.json });
    });

  automatedInvoice
    .command("resume <id>")
    .description("Resume a paused recurring invoice template")
    .option("--json", "JSON output")
    .action(async (id, opts) => {
      await automatedInvoiceResumeCommand(id, { json: opts.json });
    });

  automatedInvoice
    .command("run-now <id>")
    .description("Manually trigger a recurring invoice template execution")
    .option("--json", "JSON output")
    .action(async (id, opts) => {
      await automatedInvoiceRunNowCommand(id, { json: opts.json });
    });

  automatedInvoice
    .command("delete <id>")
    .description("Delete a recurring invoice template")
    .option("-y, --yes", "Skip confirmation")
    .option("--json", "JSON output")
    .action(async (id, opts) => {
      await automatedInvoiceDeleteCommand(id, { yes: opts.yes, json: opts.json });
    });

  automatedInvoice
    .command("update <id>")
    .description("Update a recurring invoice template")
    .option("--name <name>", "Template name")
    .option("--frequency <freq>", "weekly/biweekly/monthly/quarterly/half_yearly/yearly/custom")
    .option("--start-date <date>", "Start date (YYYY-MM-DD)")
    .option("--end-date <date>", "End date (YYYY-MM-DD)")
    .option("--max-runs <n>", "Maximum number of runs")
    .option("--notes <text>", "Notes")
    .option("--json", "JSON output")
    .action(async (id, opts) => {
      await automatedInvoiceUpdateCommand(id, {
        json: opts.json,
        name: opts.name,
        frequency: opts.frequency,
        startDate: opts.startDate,
        endDate: opts.endDate,
        maxRuns: opts.maxRuns,
        notes: opts.notes,
      });
    });

  automatedInvoice
    .command("history <templateId>")
    .description("Show execution history for a recurring invoice template")
    .option("--json", "JSON output")
    .option("--format <format>", "Output format: table, tsv, csv")
    .option("--page <n>", "Page number", parseInt)
    .option("--limit <n>", "Items per page", parseInt)
    .action(async (templateId, opts) => {
      await automatedInvoiceHistoryCommand(templateId, {
        json: opts.json,
        format: opts.format,
        page: opts.page,
        limit: opts.limit,
      });
    });

  automatedInvoice
    .command("usage")
    .description("Show plan usage for recurring invoices")
    .option("--json", "JSON output")
    .action(async (opts) => {
      await automatedInvoiceUsageCommand({ json: opts.json });
    });

  automatedInvoice
    .command("suggestions")
    .description("Show suggested recurring invoice templates based on invoice history")
    .option("--json", "JSON output")
    .action(async (opts) => {
      await automatedInvoiceSuggestionsCommand({ json: opts.json });
    });
}
