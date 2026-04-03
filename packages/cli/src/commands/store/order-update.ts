import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, success } from "../../output.js";
import { formatStatus } from "../../format.js";

const VALID_STATUSES = ["preparing", "ready", "delivered"];

export async function storeOrderUpdateCommand(
  id: string,
  opts: { json?: boolean; status?: string },
): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  if (!opts.status) {
    fatalError(
      `--status is required. Valid values: ${VALID_STATUSES.join(", ")}`,
      EXIT.USAGE,
    );
  }

  if (!VALID_STATUSES.includes(opts.status)) {
    fatalError(
      `Invalid status "${opts.status}". Valid values: ${VALID_STATUSES.join(", ")}`,
      EXIT.VALIDATION,
    );
  }

  try {
    const result = await client.store.updateOrder({
      orderId: id,
      status: opts.status as "preparing" | "ready" | "delivered",
    });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    success(`Order ${id} status updated to ${formatStatus(result.status ?? opts.status)}`);
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
