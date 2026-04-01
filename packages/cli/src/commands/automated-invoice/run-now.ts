import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, success } from "../../output.js";

export async function automatedInvoiceRunNowCommand(id: string, opts: { json?: boolean }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.recurringInvoice.runNow(id);

    if (opts.json) {
      outputJSON(result);
      return;
    }

    success(`Manually triggered recurring invoice template: ${id}`);

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "not_found") fatalError(`Template not found: ${id}`, EXIT.NOT_FOUND);
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "forbidden") fatalError(err.message, EXIT.FORBIDDEN);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}
