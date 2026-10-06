import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import {
  outputJSON, outputTable, outputTSV, outputCSV, EXIT, fatalError, type ColumnDef,
} from "../../output.js";
import { formatAmount } from "../../format.js";
import type { OutputOf } from "../../api-types.js";

type StoreItem = OutputOf<"store.listStoreItems">["data"][number];

export async function storeItemsCommand(opts: {
  json?: boolean;
  format?: string;
}): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.store.listStoreItems({});
    const items: StoreItem[] = result.data;

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const cols: ColumnDef<StoreItem>[] = [
      { key: "id", header: "ID", width: 36 },
      { key: "name", header: "Name", width: 30 },
      { key: "salePrice", header: "Price (₹)", align: "right", width: 12, format: (v) => formatAmount(String(v ?? "0")) },
      { key: "storeEnabled", header: "Status", width: 10, format: (v) => v ? "Enabled" : "Disabled" },
      { key: "stockQuantity", header: "Stock", align: "right", width: 8, format: (v) => v == null ? "-" : String(v) },
    ];

    if (opts.format === "tsv") {
      outputTSV(items, cols);
      return;
    }
    if (opts.format === "csv") {
      outputCSV(items, cols);
      return;
    }

    console.log(`\n Store Items  (${result.total} total)\n`);
    outputTable(items, cols);
    console.log();

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}
