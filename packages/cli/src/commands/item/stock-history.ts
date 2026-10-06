import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import {
  fatalError, outputJSON, outputTable, outputTSV, outputCSV,
  paginationFooter, EXIT, type ColumnDef,
} from "../../output.js";
import { formatAmount, formatDate } from "../../format.js";
import type { OutputOf } from "../../api-types.js";

interface StockHistoryOpts {
  page?: number;
  limit?: number;
  json?: boolean;
  format?: string;
}

type StockAdjustmentRow = OutputOf<"item.stockAdjustmentHistory">["data"][number];

export async function itemStockHistoryCommand(id: string, opts: StockHistoryOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  const page = opts.page ?? 1;
  const limit = opts.limit ?? 20;

  try {
    const result = await client.item.stockAdjustmentHistory({ itemId: id, page, limit });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const entries: StockAdjustmentRow[] = result.data;
    const total: number = result.total;

    console.log(`\n  Stock History: ${id}\n`);

    const cols: ColumnDef<StockAdjustmentRow>[] = [
      { key: "adjustmentDate", header: "Date", width: 13, format: (v) => formatDate(v as Date | string | null | undefined) },
      { key: "quantity", header: "Adjustment", align: "right", width: 12, format: (v) => formatAmount(String(v ?? "0")) },
      { key: "newStock", header: "Balance After", align: "right", width: 14, format: (v) => formatAmount(String(v ?? "0")) },
      { key: "reason", header: "Reason", width: 25 },
      { key: "createdByName", header: "By", width: 16 },
    ];

    if (opts.format === "tsv") outputTSV(entries, cols);
    else if (opts.format === "csv") outputCSV(entries, cols);
    else {
      outputTable(entries, cols);
      paginationFooter(page, limit, total);
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
