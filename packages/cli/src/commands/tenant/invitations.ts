import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, outputTable, EXIT, hasColor } from "../../output.js";
import type { ColumnDef } from "../../output.js";
import chalk from "chalk";

interface ListInvitationsOpts {
  json?: boolean;
}

export async function listInvitationsCommand(opts: ListInvitationsOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const invitations = await client.tenant.pendingInvitations();

    if (opts.json) {
      outputJSON(invitations);
      return;
    }

    const items = invitations;

    if (items.length === 0) {
      console.log("No pending invitations.");
      return;
    }

    const rows = items.map((inv) => ({
      id: inv.id.slice(0, 8) + "...",
      email: inv.email,
      role: inv.role as string,
      invitedBy: inv.invitedByName ?? "\u2014",
      expires: inv.expiresAt.toLocaleDateString(),
    }));

    const columns: ColumnDef<typeof rows[number]>[] = [
      { key: "id", header: "ID", align: "left" },
      { key: "email", header: "Email", align: "left" },
      { key: "role", header: "Role", align: "left" },
      { key: "invitedBy", header: "Invited By", align: "left" },
      { key: "expires", header: "Expires", align: "left" },
    ];

    if (hasColor()) process.stdout.write("\n" + chalk.bold("  Pending Invitations\n") + "\n");
    else process.stdout.write("\n  Pending Invitations\n\n");
    outputTable(rows, columns);
    process.stdout.write("\n");
  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "forbidden") fatalError(err.message, EXIT.FORBIDDEN);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}
