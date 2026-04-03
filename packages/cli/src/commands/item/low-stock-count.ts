import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT } from "../../output.js";

interface LowStockCountOpts {
  json?: boolean;
}

export async function itemLowStockCountCommand(opts: LowStockCountOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.item.lowStockCount();

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const count = typeof result === "number" ? result : (result?.count ?? 0);
    process.stdout.write(`\n  ${count} item${count === 1 ? "" : "s"} below low-stock threshold\n\n`);

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}
