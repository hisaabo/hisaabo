import { Command } from "commander";
import {
  bankReconImportsCommand,
  bankReconSummaryCommand,
  bankReconRulesCommand,
} from "../../commands/bank-recon/index.js";

export function registerBankReconCommands(program: Command): void {
  const bankRecon = program.command("bank-recon").description("Bank reconciliation");

  bankRecon
    .command("imports")
    .description("List bank statement imports")
    .option("--json", "JSON output")
    .action(async (opts) => {
      await bankReconImportsCommand({ json: opts.json });
    });

  bankRecon
    .command("summary <importId>")
    .description("Summary for a bank statement import")
    .option("--json", "JSON output")
    .action(async (importId: string, opts) => {
      await bankReconSummaryCommand(importId, { json: opts.json });
    });

  bankRecon
    .command("rules")
    .description("List auto-matching rules")
    .option("--json", "JSON output")
    .action(async (opts) => {
      await bankReconRulesCommand({ json: opts.json });
    });
}
