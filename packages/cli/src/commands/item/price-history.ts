import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import {
  fatalError, outputJSON, outputTable, outputTSV, outputCSV,
  EXIT, type ColumnDef,
} from "../../output.js";
import { formatAmount, formatDate } from "../../format.js";

interface PriceHistoryOpts {
  json?: boolean;
  format?: string;
}

interface PriceHistoryRow {
  date: string;
  salePrice: string;
  purchasePrice: string;
  changedBy: string;
}

export async function itemPriceHistoryCommand(id: string, opts: PriceHistoryOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.item.priceHistory({ itemId: id });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const entries: PriceHistoryRow[] = Array.isArray(result?.history) ? result.history : (Array.isArray(result) ? result : []);

    console.log(`\n  Price History: ${result?.itemName ?? id}\n`);

    const cols: ColumnDef<PriceHistoryRow>[] = [
      { key: "date", header: "Date", width: 13, format: (v) => formatDate(String(v ?? "")) },
      { key: "salePrice", header: "Sale Price (₹)", align: "right", width: 16, format: (v) => v ? formatAmount(String(v)) : "-" },
      { key: "purchasePrice", header: "Purchase (₹)", align: "right", width: 14, format: (v) => v ? formatAmount(String(v)) : "-" },
      { key: "changedBy", header: "Changed By", width: 18 },
    ];

    if (opts.format === "tsv") outputTSV(entries, cols);
    else if (opts.format === "csv") outputCSV(entries, cols);
    else outputTable(entries, cols);

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
