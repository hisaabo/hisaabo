import { HisaaboClient, HisaaboApiError, type PartySummary } from "../../client.js";
import { requireAuth } from "../../config.js";
import {
  fatalError, outputJSON, outputTable, outputTSV, outputCSV, outputIds,
  paginationFooter, EXIT, type ColumnDef,
} from "../../output.js";
import { formatAmount } from "../../format.js";

interface ListOpts {
  json?: boolean;
  format?: string;
  type?: string;
  search?: string;
  category?: string;
  page?: number;
  limit?: number;
}

export async function partyListCommand(opts: ListOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  const page = opts.page ?? 1;
  const limit = opts.limit ?? 20;

  try {
    const result = await client.party.list({
      type: opts.type as "customer" | "supplier" | undefined ?? null,
      search: opts.search ?? null,
      category: opts.category ?? null,
      page,
      limit,
    });

    if (opts.json) {
      outputJSON({
        data: result.data,
        pagination: { page: result.page, limit: result.limit, total: result.total },
      });
      return;
    }

    const typeLabel = opts.type === "supplier" ? "Suppliers" : opts.type === "customer" ? "Customers" : "Parties";
    console.log(`\n ${typeLabel}` + " ".repeat(40) + `${result.total} total\n`);

    const cols: ColumnDef<PartySummary>[] = [
      { key: "name", header: "Name", width: 22 },
      { key: "phone", header: "Phone", width: 16, format: (v) => String(v ?? "-") },
      { key: "balance", header: "Balance (₹)", align: "right", width: 13, format: (v) => formatAmount(String(v ?? "0")) },
      { key: "gstin", header: "GSTIN", width: 16, format: (v) => String(v ?? "-") },
      { key: "category", header: "Category", width: 14, format: (v) => String(v ?? "-") },
    ];

    if (opts.format === "tsv") outputTSV(result.data, cols);
    else if (opts.format === "csv") outputCSV(result.data, cols);
    else if (opts.format === "ids") outputIds(result.data.map((r) => r.id));
    else {
      outputTable(result.data, cols);
      paginationFooter(result.page, result.limit, result.total);
    }

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}
