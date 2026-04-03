import * as readline from "readline";
import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, success } from "../../output.js";

export async function storeOrderConfirmCommand(
  id: string,
  opts: { json?: boolean; yes?: boolean },
): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  if (!opts.yes && process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((resolve) => {
      rl.question(`  Confirm order ${id}? (y/n): `, resolve);
    });
    rl.close();
    if (answer.trim().toLowerCase() !== "y") {
      console.log("  Cancelled.");
      process.exit(0);
    }
  }

  try {
    const result = await client.store.confirmOrder({ orderId: id });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    success(`Order ${id} confirmed`);
    console.log();
  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "not_found") fatalError(`Order not found: ${id}`, EXIT.NOT_FOUND);
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "validation_failed") fatalError(e.message, EXIT.VALIDATION);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}
