import { Command } from "commander";
import { partyListCommand } from "../../commands/party/list.js";
import { partyGetCommand } from "../../commands/party/get.js";
import { partyCreateCommand } from "../../commands/party/create.js";
import { partyDeleteCommand } from "../../commands/party/delete.js";
import { partyLedgerCommand } from "../../commands/party/ledger.js";
import { partyUpdateCommand } from "../../commands/party/update.js";
import { partyStatsCommand } from "../../commands/party/stats.js";
import { partyTopItemsCommand } from "../../commands/party/top-items.js";
import { partyMergeCommand } from "../../commands/party/merge.js";
import { partyLedgerReportCommand } from "../../commands/party/ledger-report.js";

export function registerPartyCommands(program: Command): void {
  // ── party ─────────────────────────────────────────────────────────────────

  const party = program.command("party").description("Party (customer/supplier) management");


  party
    .command("list")
    .description("List parties")
    .option("--json", "JSON output")
    .option("--format <format>", "Output format: table, tsv, csv, ids")
    .option("--type <type>", "customer or supplier")
    .option("--search <q>", "Search")
    .option("--category <cat>", "Filter by category")
    .option("--page <n>", "Page number", parseInt)
    .option("--limit <n>", "Items per page", parseInt)
    .action(async (opts) => {
      await partyListCommand({
        json: opts.json,
        format: opts.format,
        type: opts.type,
        search: opts.search,
        category: opts.category,
        page: opts.page,
        limit: opts.limit,
      });
    });

  party
    .command("get <id>")
    .description("Get party details")
    .option("--json", "JSON output")
    .action(async (id, opts) => {
      await partyGetCommand(id, { json: opts.json });
    });

  party
    .command("create")
    .description("Create a new party")
    .option("--json", "JSON output")
    .option("--type <type>", "customer or supplier")
    .option("--name <name>", "Party name")
    .option("--phone <phone>", "Phone number")
    .option("--email <email>", "Email address")
    .option("--gstin <gstin>", "GSTIN")
    .option("--city <city>", "City")
    .option("--category <cat>", "Category")
    .option("-y, --yes", "Skip confirmation")
    .action(async (opts) => {
      await partyCreateCommand(opts);
    });

  party
    .command("delete <id>")
    .description("Delete a party")
    .option("-y, --yes", "Skip confirmation")
    .option("--json", "JSON output")
    .action(async (id, opts) => {
      await partyDeleteCommand(id, { yes: opts.yes, json: opts.json });
    });

  party
    .command("ledger <partyId>")
    .description("Show party ledger (debit/credit history)")
    .option("--json", "JSON output")
    .option("--format <format>", "Output format: table, tsv, csv")
    .option("--from <date>", "From date")
    .option("--to <date>", "To date")
    .option("--page <n>", "Page number", parseInt)
    .option("--limit <n>", "Items per page", parseInt)
    .action(async (partyId, opts) => {
      await partyLedgerCommand(partyId, opts);
    });

  party
    .command("update <id>")
    .description("Update a party (only the options you pass are changed)")
    .option("--json", "JSON output")
    .option("--name <name>", "Party name")
    .option("--phone <phone>", "Phone number")
    .option("--email <email>", "Email address")
    .option("--gstin <gstin>", "GSTIN")
    .option("--billing-address <address>", "Billing address")
    .option("--city <city>", "City")
    .option("--state <state>", "State")
    .option("--pincode <pincode>", "Pincode")
    .option("--category <cat>", "Category")
    .option("--credit-period <days>", "Credit period in days")
    .option("--credit-limit <amount>", "Credit limit")
    .action(async (id, opts) => {
      await partyUpdateCommand(id, opts);
    });

  party
    .command("stats <id>")
    .description("Show invoice and payment counts for a party")
    .option("--json", "JSON output")
    .action(async (id, opts) => {
      await partyStatsCommand(id, { json: opts.json });
    });

  party
    .command("top-items <id>")
    .description("Show the items a party buys most")
    .option("--json", "JSON output")
    .option("--format <format>", "Output format: table, tsv, csv")
    .action(async (id, opts) => {
      await partyTopItemsCommand(id, { json: opts.json, format: opts.format });
    });

  party
    .command("merge <sourceId> <targetId>")
    .description("Merge one party into another (moves all invoices and payments)")
    .option("--json", "JSON output")
    .option("-y, --yes", "Skip confirmation")
    .action(async (sourceId, targetId, opts) => {
      await partyMergeCommand(sourceId, targetId, { yes: opts.yes, json: opts.json });
    });

  party
    .command("ledger-report <partyId>")
    .description("Detailed party ledger report with running balance and totals")
    .option("--json", "JSON output")
    .option("--format <format>", "Output format: table, tsv, csv")
    .option("--from <date>", "From date (YYYY-MM-DD)")
    .option("--to <date>", "To date (YYYY-MM-DD)")
    .option("--this-month", "Current month")
    .option("--this-fy", "Current financial year to date")
    .action(async (partyId, opts) => {
      await partyLedgerReportCommand(partyId, opts);
    });
}
