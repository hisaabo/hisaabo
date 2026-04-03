import { Command } from "commander";

export function registerTenantCommands(program: Command): void {
  // ── tenant ────────────────────────────────────────────────────────────────

  const tenant = program.command("tenant").description("Tenant / workspace management");

  tenant
    .command("list")
    .description("List tenants / organizations you belong to")
    .option("--json", "JSON output")
    .action(async (opts) => {
      const { tenantListCommand } = await import("../../commands/tenant/list.js");
      await tenantListCommand({ json: opts.json });
    });

  tenant
    .command("members")
    .description("List members of the current tenant")
    .option("--json", "JSON output")
    .option("--format <format>", "Output format: table, tsv, csv")
    .action(async (opts) => {
      const { tenantMembersCommand } = await import("../../commands/tenant/members.js");
      await tenantMembersCommand({ json: opts.json, format: opts.format });
    });

  tenant
    .command("invite <email>")
    .description("Invite a user to the tenant")
    .option("--role <role>", "Role: admin, seller_manager, seller, accountant (default: seller)")
    .option("--json", "JSON output")
    .action(async (email, opts) => {
      const { tenantInviteCommand } = await import("../../commands/tenant/invite.js");
      await tenantInviteCommand(email, { role: opts.role, json: opts.json });
    });

  tenant
    .command("remove <userId>")
    .description("Remove a member from the tenant")
    .option("-y, --yes", "Skip confirmation")
    .option("--json", "JSON output")
    .action(async (userId, opts) => {
      const { tenantRemoveCommand } = await import("../../commands/tenant/remove.js");
      await tenantRemoveCommand(userId, { yes: opts.yes, json: opts.json });
    });

  tenant
    .command("update-role <userId> <role>")
    .description("Update a member's role (admin, seller_manager, seller, accountant)")
    .option("--json", "JSON output")
    .action(async (userId, role, opts) => {
      const { tenantUpdateRoleCommand } = await import("../../commands/tenant/update-role.js");
      await tenantUpdateRoleCommand(userId, role, { json: opts.json });
    });
}
