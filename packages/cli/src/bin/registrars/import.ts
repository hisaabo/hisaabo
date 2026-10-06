import { Command } from "commander";
import {
  importPartiesCommand,
  importItemsCommand,
  importInvoicesCommand,
  importPaymentsCommand,
} from "../../commands/import/index.js";

export function registerImportCommands(program: Command): void {
  // ── import ────────────────────────────────────────────────────────────────

  const importCmd = program.command("import").description("Bulk import data");

  importCmd
    .command("parties <file>")
    .description("Import parties from JSON or CSV file")
    .option("--json", "JSON output")
    .option("--format <format>", "json or csv (auto-detected from extension)")
    .option("--source <source>", "Import source adapter (default: hisaabo; or mybillbook)")
    .action(async (file, opts) => {
      await importPartiesCommand(file, { json: opts.json, format: opts.format, source: opts.source });
    });

  importCmd
    .command("items <file>")
    .description("Import items from JSON or CSV file")
    .option("--json", "JSON output")
    .option("--format <format>", "json or csv (auto-detected from extension)")
    .option("--source <source>", "Import source adapter (default: hisaabo; or mybillbook)")
    .action(async (file, opts) => {
      await importItemsCommand(file, { json: opts.json, format: opts.format, source: opts.source });
    });

  importCmd
    .command("invoices <file>")
    .description("Import invoices from JSON or CSV file")
    .option("--json", "JSON output")
    .option("--format <format>", "json or csv (auto-detected from extension)")
    .option("--source <source>", "Import source adapter (default: hisaabo; or mybillbook)")
    .action(async (file, opts) => {
      await importInvoicesCommand(file, { json: opts.json, format: opts.format, source: opts.source });
    });

  importCmd
    .command("payments <file>")
    .description("Import payments from JSON or CSV file")
    .option("--json", "JSON output")
    .option("--format <format>", "json or csv (auto-detected from extension)")
    .option("--source <source>", "Import source adapter (default: hisaabo; or mybillbook)")
    .action(async (file, opts) => {
      await importPaymentsCommand(file, { json: opts.json, format: opts.format, source: opts.source });
    });
}
