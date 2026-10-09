import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT } from "../../output.js";
import { formatAmount } from "../../format.js";
import { parsePeriod } from "./history-options.js";

interface StockSummaryOpts {
  json?: boolean;
  period?: string;
  unit?: string;
}

export async function itemStockSummaryCommand(id: string, opts: StockSummaryOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.item.stockSummary({
      id,
      period: parsePeriod(opts.period),
      unit: opts.unit,
    });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const { stats } = result;

    console.log(`\n  Stock Summary: ${id}`);
    console.log("  " + "─".repeat(40));
    console.log(`  Unit:       ${result.unit}, period ${result.period}`);
    console.log(`  Movements:  ${stats.count}`);
    console.log(`  Total In:   ${formatAmount(stats.totalIn)}`);
    console.log(`  Total Out:  ${formatAmount(stats.totalOut)}`);
    console.log(`  Net:        ${formatAmount(stats.net)}`);
    console.log();

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "not_found") fatalError(`Item not found: ${id}`, EXIT.NOT_FOUND);
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}
