import { Command } from "commander";
import { partyListCommand } from "../../commands/party/list.js";
import { partyGetCommand } from "../../commands/party/get.js";
import { partyCreateCommand } from "../../commands/party/create.js";
import { partyDeleteCommand } from "../../commands/party/delete.js";
import { partyLedgerCommand } from "../../commands/party/ledger.js";

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
}
