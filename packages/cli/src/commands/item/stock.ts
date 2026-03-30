import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, success } from "../../output.js";
import { formatAmount } from "../../format.js";

interface StockOpts {
  json?: boolean;
  reason?: string;
}

export async function itemStockCommand(id: string, adjustment: string, opts: StockOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  // Validate adjustment format
  if (!/^[+-]?\d+(\.\d+)?$/.test(adjustment)) {
    fatalError(`Invalid adjustment: ${adjustment}. Use a number like +10, -5, or 100`, EXIT.USAGE);
  }

  try {
    const updated = await client.item.adjustStock({
      itemId: id,
      adjustment,
      reason: opts.reason,
    });

    if (opts.json) {
      outputJSON(updated);
      return;
    }

    const adj = parseFloat(adjustment);
    const dir = adj >= 0 ? "+" : "";
    success(`Stock adjusted: ${updated.name}  ${dir}${formatAmount(adjustment)} → ${formatAmount(updated.stockQuantity)}`);

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "not_found") fatalError(`Item not found: ${id}`, EXIT.NOT_FOUND);
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "validation_failed") fatalError(e.message, EXIT.VALIDATION);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}
