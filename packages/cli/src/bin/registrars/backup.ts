import { Command } from "commander";

export function registerBackupCommands(program: Command): void {
  // ── export ─────────────────────────────────────────────────────────────────

  program
    .command("export")
    .description("Download a full tenant backup as a .tar.gz archive")
    .requiredOption("--tenant <slug-or-id>", "Tenant slug or UUID to export")
    .requiredOption("-o, --output <file>", "Output file path (e.g. backup.tar.gz)")
    .addHelpText(
      "after",
      `
Examples:
  hisaabo export --tenant my-company -o backup.tar.gz
  hisaabo export --tenant 550e8400-e29b-41d4-a716-446655440000 -o /tmp/backup.tar.gz

Exit codes:
  0  Success
  1  Not authenticated or insufficient permissions
  2  Rate limit reached (2 exports per day)
  5  Server or network error`,
    )
    .action(async (opts) => {
      const { exportCommand } = await import("../../commands/backup/export.js");
      await exportCommand({ tenant: opts.tenant, output: opts.output });
    });

  // ── restore ────────────────────────────────────────────────────────────────

  program
    .command("restore")
    .description("Upload a .tar.gz backup archive into an empty tenant")
    .requiredOption("--tenant <slug-or-id>", "Target tenant slug or UUID (must be empty)")
    .requiredOption("-i, --input <file>", "Input backup file path (e.g. backup.tar.gz)")
    .option("-y, --yes", "Skip confirmation prompt")
    .addHelpText(
      "after",
      `
Examples:
  hisaabo restore --tenant my-company -i backup.tar.gz
  hisaabo restore --tenant my-company -i backup.tar.gz --yes
  hisaabo restore --tenant 550e8400-e29b-41d4-a716-446655440000 -i /tmp/backup.tar.gz -y

Notes:
  The target tenant must be completely empty (no businesses).
  Restore is a one-way operation — ensure the target is a fresh tenant.

Exit codes:
  0  Success
  1  Not authenticated or insufficient permissions
  3  Target tenant is not empty
  4  Input file missing, unreadable, or empty
  5  Server or network error`,
    )
    .action(async (opts) => {
      const { restoreCommand } = await import("../../commands/backup/import.js");
      await restoreCommand({ tenant: opts.tenant, input: opts.input, yes: opts.yes });
    });
}
