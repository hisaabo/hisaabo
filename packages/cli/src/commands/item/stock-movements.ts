import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import {
  fatalError, outputJSON, outputTable, outputTSV, outputCSV,
  EXIT, type ColumnDef,
} from "../../output.js";
import { formatAmount, formatDate } from "../../format.js";
import type { OutputOf } from "../../api-types.js";
import { parsePeriod } from "./history-options.js";

interface StockMovementsOpts {
  json?: boolean;
  format?: string;
  period?: string;
  limit?: number;
}

type StockMovementRow = OutputOf<"item.stockMovements">[number];

export async function itemStockMovementsCommand(id: string, opts: StockMovementsOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.item.stockMovements({ id, period: parsePeriod(opts.period), limit: opts.limit });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const entries: StockMovementRow[] = result;

    console.log(`\n  Stock Movements: ${id}\n`);

    const cols: ColumnDef<StockMovementRow>[] = [
      { key: "invoiceDate", header: "Date", width: 13, format: (v) => formatDate(v as Date | string | null | undefined) },
      { key: "invoiceNumber", header: "Invoice", width: 16 },
      { key: "direction", header: "Dir", width: 5 },
      { key: "quantity", header: "Qty", align: "right", width: 12, format: (v) => formatAmount(String(v ?? "0")) },
      { key: "partyName", header: "Party", width: 18 },
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
