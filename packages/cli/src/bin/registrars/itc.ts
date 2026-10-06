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
    .option("--period <YYYY-MM>", "Return period (default: current month)")
    .action(async (opts) => {
      await itcDashboardCommand({ json: opts.json, period: opts.period });
    });

  itc
    .command("ledger")
    .description("ITC ledger — all eligible purchase credits")
    .option("--json", "JSON output")
    .option("--period <YYYY-MM>", "Return period (default: all periods)")
    .action(async (opts) => {
      await itcLedgerCommand({ json: opts.json, period: opts.period });
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
    .option("--reason <reason>", "Block reason (motor_vehicle, food_beverage, personal, membership, travel_benefits, works_contract, construction, telecom, other)")
    .option("--notes <text>", "Free-text notes")
    .action(async (invoiceId: string, opts) => {
      await itcBlockCommand(invoiceId, { json: opts.json, reason: opts.reason, notes: opts.notes });
    });

  itc
    .command("unblock <invoiceId>")
    .description("Mark ITC for an invoice as eligible")
    .option("--json", "JSON output")
    .action(async (invoiceId: string, opts) => {
      await itcUnblockCommand(invoiceId, { json: opts.json });
    });
}
