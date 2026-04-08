import { Command } from "commander";
import {
  journalListCommand,
  journalGetCommand,
  journalVoidCommand,
  journalTemplatesCommand,
} from "../../commands/journal/index.js";

export function registerJournalCommands(program: Command): void {
  const journal = program.command("journal").description("Journal entries and templates");

  journal
    .command("list")
    .description("List journal entries")
    .option("--json", "JSON output")
    .option("--page <n>", "Page number", parseInt)
    .option("--limit <n>", "Results per page", parseInt)
    .option("--from <date>", "From date")
    .option("--to <date>", "To date")
    .action(async (opts) => {
      await journalListCommand(opts);
    });

  journal
    .command("get <id>")
    .description("Get journal entry details")
    .option("--json", "JSON output")
    .action(async (id: string, opts) => {
      await journalGetCommand(id, { json: opts.json });
    });

  journal
    .command("void <id>")
    .description("Void a journal entry")
    .option("--json", "JSON output")
    .action(async (id: string, opts) => {
      await journalVoidCommand(id, { json: opts.json });
    });

  journal
    .command("templates")
    .description("List journal entry templates")
    .option("--json", "JSON output")
    .action(async (opts) => {
      await journalTemplatesCommand({ json: opts.json });
    });
}
