import { HisaaboClient, HisaaboApiError, type ExpenseSummary } from "../../client.js";
import { requireAuth } from "../../config.js";
import {
  fatalError, outputJSON, outputTable, outputTSV, outputCSV, outputIds,
  paginationFooter, EXIT, type ColumnDef,
} from "../../output.js";
import { formatAmount, formatDate } from "../../format.js";

interface ListOpts {
  json?: boolean;
  format?: string;
  category?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export async function expenseListCommand(opts: ListOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  const page = opts.page ?? 1;
  const limit = opts.limit ?? 20;

  try {
    const result = await client.expense.list({
      category: opts.category ?? null,
      fromDate: opts.from ?? null,
      toDate: opts.to ?? null,
      page,
      limit,
    });

    if (opts.json) {
      outputJSON({ data: result.data, pagination: { page: result.page, limit: result.limit, total: result.total } });
      return;
    }

    console.log(`\n Expenses  ${result.total} total\n`);

    const cols: ColumnDef<ExpenseSummary>[] = [
      { key: "expenseDate", header: "Date", width: 13, format: (v) => formatDate(String(v ?? "")) },
      { key: "category", header: "Category", width: 18 },
      { key: "description", header: "Description", width: 22, format: (v) => String(v ?? "-") },
      { key: "amount", header: "Amount (₹)", align: "right", width: 13, format: (v) => formatAmount(String(v ?? "0")) },
      { key: "mode", header: "Mode", width: 8 },
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
