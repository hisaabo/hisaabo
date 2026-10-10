import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import {
  fatalError, outputJSON, outputTable, outputTSV, outputCSV,
  EXIT, type ColumnDef,
} from "../../output.js";
import { formatAmount, formatDate } from "../../format.js";
import type { OutputOf } from "../../api-types.js";
import { parsePeriod } from "./history-options.js";

interface PriceHistoryOpts {
  json?: boolean;
  format?: string;
  period?: string;
  limit?: number;
}

type PriceHistoryRow = OutputOf<"item.priceHistory">[number];

export async function itemPriceHistoryCommand(id: string, opts: PriceHistoryOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.item.priceHistory({ id, period: parsePeriod(opts.period), limit: opts.limit });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const entries: PriceHistoryRow[] = result;

    console.log(`\n  Price History: ${id}\n`);

    const cols: ColumnDef<PriceHistoryRow>[] = [
      { key: "invoiceDate", header: "Date", width: 13, format: (v) => formatDate(v as Date | string | null | undefined) },
      { key: "invoiceNumber", header: "Invoice", width: 16 },
      { key: "invoiceType", header: "Type", width: 10 },
      { key: "unitPrice", header: "Unit Price (₹)", align: "right", width: 16, format: (v) => v ? formatAmount(String(v)) : "-" },
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
