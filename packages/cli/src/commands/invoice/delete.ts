import * as readline from "readline";
import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, success } from "../../output.js";

export async function invoiceDeleteCommand(id: string, opts: { yes?: boolean; json?: boolean }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const inv = await client.invoice.get(id);

    if (!opts.yes && process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>((resolve) => {
        rl.question(`  Delete ${inv.invoiceNumber} (${inv.partyName}, ${inv.totalAmount})? (y/N): `, resolve);
      });
      rl.close();
      if (answer.trim().toLowerCase() !== "y") {
        console.log("  Cancelled.");
        process.exit(0);
      }
    }

    const result = await client.invoice.delete(id);

    if (opts.json) {
      outputJSON(result);
      return;
    }

    success(`Deleted: ${inv.invoiceNumber}`);

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "not_found") fatalError(`Invoice not found: ${id}`, EXIT.NOT_FOUND);
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "forbidden") fatalError(err.message, EXIT.FORBIDDEN);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}
