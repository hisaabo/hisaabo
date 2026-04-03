import { HisaaboClient, HisaaboApiError, type RecurringInvoiceExecution } from "../../client.js";
import { requireAuth } from "../../config.js";
import {
  fatalError, outputJSON, outputTable, outputTSV, outputCSV,
  paginationFooter, EXIT, type ColumnDef,
} from "../../output.js";
import { formatDate } from "../../format.js";
import chalk from "chalk";

function executionStatusBadge(status: string): string {
  const map: Record<string, string> = {
    success: chalk.green("success"),
    failed: chalk.red("failed"),
    skipped: chalk.yellow("skipped"),
  };
  return map[status] ?? status;
}

interface HistoryOpts {
  json?: boolean;
  format?: string;
  page?: number;
  limit?: number;
}

export async function automatedInvoiceHistoryCommand(templateId: string, opts: HistoryOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  const page = opts.page ?? 1;
  const limit = opts.limit ?? 20;

  try {
    const result = await client.recurringInvoice.executionHistory(templateId, page, limit);

    if (opts.json) {
      outputJSON({ data: result.data, pagination: { page: result.page, limit: result.limit, total: result.total } });
      return;
    }

    console.log(`\n Execution History  ${result.total} total\n`);

    const cols: ColumnDef<RecurringInvoiceExecution>[] = [
      { key: "executedAt", header: "Date", width: 13, format: (v) => formatDate(String(v ?? "")) },
      { key: "invoiceNumber", header: "Invoice #", width: 20 },
      { key: "status", header: "Status", width: 10, format: (v) => executionStatusBadge(String(v ?? "")) },
      { key: "errorMessage", header: "Error", width: 30, format: (v) => (v ? String(v) : "—") },
    ];

    if (opts.format === "tsv") outputTSV(result.data, cols);
    else if (opts.format === "csv") outputCSV(result.data, cols);
    else {
      outputTable(result.data, cols);
      paginationFooter(result.page, result.limit, result.total);
    }

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "not_found") fatalError(`Recurring invoice template not found: ${templateId}`, EXIT.NOT_FOUND);
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}
