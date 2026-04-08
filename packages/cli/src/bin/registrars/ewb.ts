import { Command } from "commander";
import {
  ewbDashboardCommand,
  ewbGenerateCommand,
  ewbExpiringCommand,
} from "../../commands/ewb/index.js";

export function registerEwbCommands(program: Command): void {
  const ewb = program.command("ewb").description("E-Way Bill management");

  ewb
    .command("dashboard")
    .description("E-way bill summary dashboard")
    .option("--json", "JSON output")
    .option("--from <date>", "From date")
    .option("--to <date>", "To date")
    .action(async (opts) => {
      await ewbDashboardCommand(opts);
    });

  ewb
    .command("generate <invoiceId>")
    .description("Generate an e-way bill for an invoice")
    .option("--json", "JSON output")
    .action(async (invoiceId: string, opts) => {
      await ewbGenerateCommand(invoiceId, { json: opts.json });
    });

  ewb
    .command("expiring")
    .description("List e-way bills expiring soon")
    .option("--json", "JSON output")
    .option("--days <n>", "Within N days (default: 3)", parseInt)
    .action(async (opts) => {
      await ewbExpiringCommand({ json: opts.json, days: opts.days });
    });
}
