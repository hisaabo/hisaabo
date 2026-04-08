import { Command } from "commander";
import {
  itcDashboardCommand,
  itcLedgerCommand,
  itcAgingCommand,
  itcBlockCommand,
  itcUnblockCommand,
} from "../../commands/itc/index.js";

export function registerItcCommands(program: Command): void {
  const itc = program.command("itc").description("Input Tax Credit tracking");

  itc
    .command("dashboard")
    .description("ITC summary dashboard")
    .option("--json", "JSON output")
    .option("--from <date>", "From date")
    .option("--to <date>", "To date")
    .action(async (opts) => {
      await itcDashboardCommand(opts);
    });

  itc
    .command("ledger")
    .description("ITC ledger — all eligible purchase credits")
    .option("--json", "JSON output")
    .option("--from <date>", "From date")
    .option("--to <date>", "To date")
    .action(async (opts) => {
      await itcLedgerCommand(opts);
    });

  itc
    .command("aging")
    .description("ITC aging alerts — credits at risk of reversal")
    .option("--json", "JSON output")
    .action(async (opts) => {
      await itcAgingCommand({ json: opts.json });
    });

  itc
    .command("block <invoiceId>")
    .description("Mark ITC for an invoice as blocked")
    .option("--json", "JSON output")
    .action(async (invoiceId: string, opts) => {
      await itcBlockCommand(invoiceId, { json: opts.json });
    });

  itc
    .command("unblock <invoiceId>")
    .description("Mark ITC for an invoice as eligible")
    .option("--json", "JSON output")
    .action(async (invoiceId: string, opts) => {
      await itcUnblockCommand(invoiceId, { json: opts.json });
    });
}
