import { Command } from "commander";

export function registerSessionCommands(program: Command): void {
  const session = program.command("session").description("Manage active sessions");

  session
    .command("list")
    .description("List active sessions")
    .option("--expired", "Show expired sessions instead")
    .option("--json", "JSON output")
    .action(async (opts) => {
      const { listSessionsCommand } = await import("../../commands/session/list.js");
      await listSessionsCommand(opts);
    });

  session
    .command("revoke <sessionId>")
    .description("Revoke a specific session")
    .option("--json", "JSON output")
    .action(async (sessionId, opts) => {
      const { revokeSessionCommand } = await import("../../commands/session/revoke.js");
      await revokeSessionCommand(sessionId, opts);
    });

  session
    .command("revoke-all")
    .description("Sign out from all devices")
    .action(async () => {
      const { revokeAllSessionsCommand } = await import("../../commands/session/revoke-all.js");
      await revokeAllSessionsCommand();
    });
}
