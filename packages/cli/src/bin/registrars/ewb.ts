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
    .action(async (opts) => {
      await ewbDashboardCommand({ json: opts.json });
    });

  ewb
    .command("generate <invoiceId>")
    .description("Generate an e-way bill for an invoice")
    .option("--json", "JSON output")
    .requiredOption("--vehicle <number>", "Vehicle registration number (e.g. MH12AB1234)")
    .requiredOption("--distance <km>", "Approximate distance in km (1-4000)", (v) => parseInt(v, 10))
    .action(async (invoiceId: string, opts) => {
      await ewbGenerateCommand(invoiceId, { json: opts.json, vehicle: opts.vehicle, distance: opts.distance });
    });

  ewb
    .command("expiring")
    .description("List e-way bills expiring within the next 24 hours")
    .option("--json", "JSON output")
    .action(async (opts) => {
      await ewbExpiringCommand({ json: opts.json });
    });
}
