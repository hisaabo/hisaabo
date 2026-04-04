import { Command } from "commander";
import {
  bankListCommand, bankGetCommand, bankCreateCommand, bankTransferCommand, bankTransactionsCommand,
} from "../../commands/bank/index.js";
import { bankGatewayConfigCommand } from "../../commands/bank/gateway-config.js";
import { bankUpdateGatewayCommand } from "../../commands/bank/update-gateway.js";

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

  bank
    .command("gateway-config <accountId>")
    .description("Display gateway configuration (charge rates, settlement account)")
    .option("--json", "JSON output")
    .action(async (accountId, opts) => {
      await bankGatewayConfigCommand(accountId, { json: opts.json });
    });

  bank
    .command("update-gateway <accountId>")
    .description("Update gateway charge configuration")
    .option("--json", "JSON output")
    .option("--charge-credit-card <rate>", "Credit card charge rate (e.g. 2 for 2%, flat:20 for flat)")
    .option("--charge-debit-card <rate>", "Debit card charge rate")
    .option("--charge-upi <rate>", "UPI charge rate")
    .option("--charge-net-banking <rate>", "Net banking charge rate")
    .option("--charge-wallet <rate>", "Wallet charge rate")
    .option("--charge-default <rate>", "Default charge rate for unlisted modes")
    .option("--settlement-account <id>", "Settlement bank account ID")
    .action(async (accountId, opts) => {
      await bankUpdateGatewayCommand(accountId, {
        json: opts.json,
        chargeCreditCard: opts.chargeCreditCard,
        chargeDebitCard: opts.chargeDebitCard,
        chargeUpi: opts.chargeUpi,
        chargeNetBanking: opts.chargeNetBanking,
        chargeWallet: opts.chargeWallet,
        chargeDefault: opts.chargeDefault,
        settlementAccount: opts.settlementAccount,
      });
    });
}
