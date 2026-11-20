import { Command } from "commander";
import { tdsSectionListCommand } from "../../commands/tds-section/list.js";

export function registerTdsSectionCommands(program: Command): void {
  const tdsSection = program
    .command("tds-section")
    .description("TDS sections available when recording customer receipts");

  tdsSection
    .command("list")
    .description("List TDS section codes (use with: payment create --tds-section <code>)")
    .option("--json", "JSON output")
    .option("--format <format>", "Output format: table, tsv, csv")
    .option("--include-inactive", "Include inactive sections")
    .action(async (opts) => {
      await tdsSectionListCommand({
        json: opts.json,
        format: opts.format,
        includeInactive: opts.includeInactive,
      });
    });
}
