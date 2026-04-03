import { Command } from "commander";
import { invoiceListCommand } from "../../commands/invoice/list.js";
import { invoiceGetCommand } from "../../commands/invoice/get.js";
import { invoiceCreateCommand } from "../../commands/invoice/create.js";
import { invoiceStatusCommand } from "../../commands/invoice/status.js";
import { invoicePdfCommand } from "../../commands/invoice/pdf.js";
import { invoiceDeleteCommand } from "../../commands/invoice/delete.js";

export function registerInvoiceCommands(program: Command): void {
  // ── invoice ───────────────────────────────────────────────────────────────

  const invoice = program.command("invoice").description("Invoice management");

  invoice
    .command("list")
    .description("List invoices")
    .option("--json", "JSON output")
    .option("--format <format>", "Output format: table, tsv, csv, ids")
    .option("--type <type>", "sale or purchase")
    .option("--status <status>", "Filter by status")
    .option("--party <name>", "Filter by party name")
    .option("--party-id <id>", "Filter by party ID")
    .option("--from <date>", "From date (YYYY-MM-DD)")
    .option("--to <date>", "To date (YYYY-MM-DD)")
    .option("--this-month", "Filter to current month")
    .option("--this-quarter", "Filter to current quarter")
    .option("--this-fy", "Filter to current financial year")
    .option("--page <n>", "Page number", parseInt)
    .option("--limit <n>", "Items per page", parseInt)
    .option("--search <q>", "Search invoices")
    .option("--sort-by <field>", "Sort field: date, amount, number")
    .option("--sort-dir <dir>", "Sort direction: asc, desc")
    .action(async (opts) => {
      await invoiceListCommand({
        json: opts.json,
        format: opts.format,
        type: opts.type,
        status: opts.status,
        party: opts.party,
        partyId: opts.partyId,
        from: opts.from,
        to: opts.to,
        thisMonth: opts.thisMonth,
        thisQuarter: opts.thisQuarter,
        thisFy: opts.thisFy,
        page: opts.page,
        limit: opts.limit,
        search: opts.search,
        sortBy: opts.sortBy,
        sortDir: opts.sortDir,
      });
    });

  invoice
    .command("get <id>")
    .description("Get invoice details")
    .option("--json", "JSON output")
    .action(async (id, opts) => {
      await invoiceGetCommand(id, { json: opts.json });
    });

  invoice
    .command("create")
    .description("Create a new invoice")
    .option("--json", "JSON output")
    .option("--party <name>", "Party name")
    .option("--party-id <id>", "Party UUID")
    .option("--type <type>", "sale or purchase")
    .option("--item <name>", "Item (repeatable)", (v, a: string[]) => [...a, v], [] as string[])
    .option("--qty <n>", "Quantity (per --item)", (v, a: string[]) => [...a, v], [] as string[])
    .option("--rate <n>", "Unit price (per --item)", (v, a: string[]) => [...a, v], [] as string[])
    .option("--delivery <method>", "Delivery method")
    .option("--notes <text>", "Invoice notes")
    .option("--terms <text>", "Terms and conditions")
    .option("-y, --yes", "Skip confirmation prompts")
    .action(async (opts) => {
      await invoiceCreateCommand({
        json: opts.json,
        party: opts.party,
        partyId: opts.partyId,
        type: opts.type,
        items: opts.item,
        qty: opts.qty,
        rate: opts.rate,
        delivery: opts.delivery,
        notes: opts.notes,
        terms: opts.terms,
        yes: opts.yes,
      });
    });

  invoice
    .command("status <id> <status>")
    .description("Update invoice status")
    .option("--json", "JSON output")
    .action(async (id, status, opts) => {
      await invoiceStatusCommand(id, status, { json: opts.json });
    });

  invoice
    .command("pdf <id>")
    .description("Download invoice as PDF")
    .option("--output <path>", "Output path or directory")
    .option("--open", "Open after download")
    .action(async (id, opts) => {
      await invoicePdfCommand(id, { output: opts.output, open: opts.open });
    });

  invoice
    .command("delete <id>")
    .description("Delete an invoice")
    .option("-y, --yes", "Skip confirmation")
    .option("--json", "JSON output")
    .action(async (id, opts) => {
      await invoiceDeleteCommand(id, { yes: opts.yes, json: opts.json });
    });
}
