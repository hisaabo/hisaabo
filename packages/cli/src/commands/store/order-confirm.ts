import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, success } from "../../output.js";
import { confirmOrExit } from "../../safety.js";

export async function storeOrderConfirmCommand(
  id: string,
  opts: { json?: boolean; yes?: boolean },
): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  await confirmOrExit(`  Confirm order ${id}?`, opts);

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
