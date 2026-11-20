import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT } from "../../output.js";
import { formatINR } from "../../format.js";
import { parsePeriod } from "./history-options.js";

interface PriceSummaryOpts {
  json?: boolean;
  period?: string;
  unit?: string;
  type?: string;
}

export async function itemPriceSummaryCommand(id: string, opts: PriceSummaryOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  if (opts.type !== undefined && opts.type !== "sale" && opts.type !== "purchase") {
    fatalError(`Invalid --type "${opts.type}". Use: sale, purchase`, EXIT.USAGE);
  }

  try {
    const result = await client.item.priceSummary({
      id,
      period: parsePeriod(opts.period),
      unit: opts.unit,
      invoiceType: opts.type as "sale" | "purchase" | undefined,
    });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const { stats } = result;
    const money = (v: string | null) => (v === null ? "-" : formatINR(v));

    console.log(`\n  Price Summary: ${id}`);
    console.log("  " + "─".repeat(40));
    console.log(`  Series:   ${result.invoiceType} prices per ${result.unit}, period ${result.period}`);
    console.log(`  Lines:    ${stats.count}`);
    console.log(`  Latest:   ${money(stats.latest)}`);
    console.log(`  Min:      ${money(stats.min)}`);
    console.log(`  Max:      ${money(stats.max)}`);
    console.log(`  Average:  ${money(stats.avg)}`);
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
