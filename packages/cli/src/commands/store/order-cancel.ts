import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, success } from "../../output.js";
import { confirmOrExit } from "../../safety.js";

export async function storeOrderCancelCommand(
  id: string,
  opts: { json?: boolean; yes?: boolean; reason?: string },
): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  await confirmOrExit(`  Cancel order ${id}? This cannot be undone.`, opts);

  try {
    const result = await client.store.cancelOrder({ orderId: id, reason: opts.reason || undefined });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    success(`Order ${id} cancelled`);
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
