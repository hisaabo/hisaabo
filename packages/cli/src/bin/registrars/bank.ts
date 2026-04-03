import { Command } from "commander";
import {
  bankListCommand, bankGetCommand, bankCreateCommand, bankTransferCommand, bankTransactionsCommand,
} from "../../commands/bank/index.js";

export function registerBankCommands(program: Command): void {
  // ── bank ─────────────────────────────────────────────────────────────────

  const bank = program.command("bank").description("Bank account management");

  bank
    .command("list")
    .description("List bank accounts with balances")
    .option("--json", "JSON output")
    .action(async (opts) => {
      await bankListCommand({ json: opts.json });
    });

  bank
    .command("get <id>")
    .description("Get bank account details")
    .option("--json", "JSON output")
    .action(async (id, opts) => {
      await bankGetCommand(id, { json: opts.json });
    });

  bank
    .command("create")
    .description("Create a new bank account")
    .option("--json", "JSON output")
    .option("--name <name>", "Account name")
    .option("--type <type>", "savings/current/cash/credit/other")
    .option("--bank <name>", "Bank name")
    .option("--account-number <num>", "Account number")
    .option("--ifsc <code>", "IFSC code")
    .option("--opening-balance <amount>", "Opening balance")
    .option("--default", "Set as default account")
    .option("-y, --yes", "Skip prompts")
    .action(async (opts) => {
      await bankCreateCommand({
        json: opts.json,
        name: opts.name,
        type: opts.type,
        bank: opts.bank,
        accountNumber: opts.accountNumber,
        ifsc: opts.ifsc,
        openingBalance: opts.openingBalance,
        default: opts.default,
        yes: opts.yes,
      });
    });

  bank
    .command("transfer")
    .description("Transfer between bank accounts")
    .option("--json", "JSON output")
    .option("--from <id>", "Source account ID")
    .option("--to <id>", "Destination account ID")
    .option("--amount <amount>", "Transfer amount")
    .option("--description <text>", "Description")
    .option("--date <date>", "Transfer date")
    .action(async (opts) => {
      await bankTransferCommand({
        json: opts.json,
        from: opts.from,
        to: opts.to,
        amount: opts.amount,
        description: opts.description,
        date: opts.date,
      });
    });

  bank
    .command("transactions <accountId>")
    .description("List transactions for a bank account")
    .option("--json", "JSON output")
    .option("--from <date>", "From date")
    .option("--to <date>", "To date")
    .option("--page <n>", "Page number", parseInt)
    .option("--limit <n>", "Items per page", parseInt)
    .action(async (accountId, opts) => {
      await bankTransactionsCommand(accountId, {
        json: opts.json,
        from: opts.from,
        to: opts.to,
        page: opts.page,
        limit: opts.limit,
      });
    });
}
