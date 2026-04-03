import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT } from "../../output.js";
import { formatINR, formatAmount } from "../../format.js";

interface SalesStatsOpts {
  json?: boolean;
}

export async function itemSalesStatsCommand(id: string, opts: SalesStatsOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.item.salesStats({ itemId: id });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    console.log(`\n  Sales Stats: ${result?.itemName ?? id}`);
    console.log("  " + "─".repeat(40));
    console.log(`  Total Sold:    ${formatAmount(String(result?.totalQuantitySold ?? "0"))} units`);
    console.log(`  Total Revenue: ${formatINR(String(result?.totalRevenue ?? "0"))}`);
    console.log(`  Avg Price:     ${formatINR(String(result?.avgSalePrice ?? "0"))}`);
    if (result?.invoiceCount !== undefined) {
      console.log(`  Invoices:      ${result.invoiceCount}`);
    }
    if (result?.lastSoldDate) {
      console.log(`  Last Sold:     ${result.lastSoldDate}`);
    }
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
