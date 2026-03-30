import { HisaaboClient, HisaaboApiError, type ItemSummary } from "../../client.js";
import { requireAuth } from "../../config.js";
import {
  fatalError, outputJSON, outputTable, outputTSV, outputCSV, outputIds,
  paginationFooter, EXIT, hasColor, type ColumnDef,
} from "../../output.js";
import { formatAmount } from "../../format.js";
import chalk from "chalk";

interface ListOpts {
  json?: boolean;
  format?: string;
  search?: string;
  category?: string;
  type?: string;
  lowStock?: boolean;
  page?: number;
  limit?: number;
}

export async function itemListCommand(opts: ListOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  const page = opts.page ?? 1;
  const limit = opts.limit ?? 20;

  try {
    const result = await client.item.list({
      search: opts.search ?? null,
      category: opts.category ?? null,
      itemType: opts.type as "product" | "service" | undefined ?? null,
      lowStock: opts.lowStock ?? null,
      page,
      limit,
    });

    if (opts.json) {
      outputJSON({ data: result.data, pagination: { page: result.page, limit: result.limit, total: result.total } });
      return;
    }

    console.log(`\n Items` + " ".repeat(45) + `${result.total} total\n`);

    const cols: ColumnDef<ItemSummary>[] = [
      { key: "name", header: "Name", width: 22 },
      { key: "unit", header: "Unit", width: 6 },
      { key: "salePrice", header: "Sale (₹)", align: "right", width: 12,
        format: (v) => v ? formatAmount(String(v)) : "-" },
      { key: "stockQuantity", header: "Stock", width: 8,
        format: (v, row) => {
          const qty = String(v ?? "0");
          const low = row.lowStockAlert;
          const isLow = low && parseFloat(qty) <= parseFloat(low);
          const str = row.itemType === "service" ? "-" : (isLow ? `${qty} !` : qty);
          return isLow && hasColor() ? chalk.red(str) : str;
        },
      },
      { key: "taxPercent", header: "Tax%", width: 6, format: (v) => `${v ?? 0}%` },
      { key: "category", header: "Category", width: 14, format: (v) => String(v ?? "-") },
    ];

    if (opts.format === "tsv") outputTSV(result.data, cols);
    else if (opts.format === "csv") outputCSV(result.data, cols);
    else if (opts.format === "ids") outputIds(result.data.map((r) => r.id));
    else {
      outputTable(result.data, cols);
      paginationFooter(result.page, result.limit, result.total);
      if (result.data.some((i) => i.lowStockAlert && parseFloat(i.stockQuantity) <= parseFloat(i.lowStockAlert))) {
        console.log("\n  ! = below low stock alert threshold\n");
      }
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
