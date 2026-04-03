import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import {
  fatalError, outputJSON, outputTable, outputTSV, outputCSV,
  EXIT, type ColumnDef,
} from "../../output.js";
import { formatAmount } from "../../format.js";

interface TopItemsOpts {
  json?: boolean;
  format?: string;
}

interface TopItem {
  itemName: string;
  quantity: string;
  revenue: string;
}

export async function partyTopItemsCommand(id: string, opts: TopItemsOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.party.topItems({ partyId: id });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const items: TopItem[] = Array.isArray(result?.items) ? result.items : (Array.isArray(result) ? result : []);

    console.log(`\n  Top Items for Party: ${result?.partyName ?? id}\n`);

    const cols: ColumnDef<TopItem>[] = [
      { key: "itemName", header: "Item", width: 30 },
      { key: "quantity", header: "Quantity", align: "right", width: 12, format: (v) => formatAmount(String(v ?? "0")) },
      { key: "revenue", header: "Revenue (₹)", align: "right", width: 14, format: (v) => formatAmount(String(v ?? "0")) },
    ];

    if (opts.format === "tsv") outputTSV(items, cols);
    else if (opts.format === "csv") outputCSV(items, cols);
    else outputTable(items, cols);

    console.log();

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "not_found") fatalError(`Party not found: ${id}`, EXIT.NOT_FOUND);
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}
