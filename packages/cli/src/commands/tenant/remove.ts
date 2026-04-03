import * as readline from "readline";
import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, success } from "../../output.js";

interface RemoveOpts {
  yes?: boolean;
  json?: boolean;
}

export async function tenantRemoveCommand(userId: string, opts: RemoveOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    if (!opts.yes && process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>((resolve) => {
        rl.question(`  Remove member ${userId} from the organization? (y/N): `, resolve);
      });
      rl.close();
      if (answer.trim().toLowerCase() !== "y") {
        console.log("  Cancelled.");
        process.exit(0);
      }
    }

    const result = await client.tenant.removeMember({ userId });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    success(`Removed member: ${userId}`);

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "not_found") fatalError(`Member not found: ${userId}`, EXIT.NOT_FOUND);
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "forbidden") fatalError(err.message, EXIT.FORBIDDEN);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}
