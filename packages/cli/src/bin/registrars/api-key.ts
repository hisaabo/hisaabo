import { Command } from "commander";

export function registerApiKeyCommands(program: Command): void {
  const apiKey = program
    .command("api-key")
    .alias("key")
    .description("API key management");

  // ── list ──────────────────────────────────────────────────────────────────

  apiKey
    .command("list")
    .description("List all API keys")
    .option("--json", "JSON output")
    .option("--format <fmt>", "Output format: table, tsv, csv")
    .action(async (opts) => {
      const { apiKeyListCommand } = await import("../../commands/api-key/list.js");
      await apiKeyListCommand(opts);
    });

  // ── create ────────────────────────────────────────────────────────────────

  apiKey
    .command("create")
    .description("Create a new API key")
    .requiredOption("--name <name>", "Name / label for this key")
    .option("--json", "JSON output")
    .action(async (opts) => {
      const { apiKeyCreateCommand } = await import("../../commands/api-key/create.js");
      await apiKeyCreateCommand(opts);
    });

  // ── revoke ────────────────────────────────────────────────────────────────

  apiKey
    .command("revoke <id>")
    .description("Revoke an API key by ID")
    .option("--yes", "Skip confirmation prompt")
    .option("--json", "JSON output")
    .action(async (id: string, opts) => {
      const { apiKeyRevokeCommand } = await import("../../commands/api-key/revoke.js");
      await apiKeyRevokeCommand(id, opts);
    });
}
