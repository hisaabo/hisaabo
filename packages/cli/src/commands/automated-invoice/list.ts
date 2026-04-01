import { HisaaboClient, HisaaboApiError, type RecurringInvoiceSummary } from "../../client.js";
import { requireAuth } from "../../config.js";
import {
  fatalError, outputJSON, outputTable, outputTSV, outputCSV, outputIds,
  paginationFooter, EXIT, type ColumnDef,
} from "../../output.js";
import { formatDate } from "../../format.js";

const FREQUENCY_LABELS: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 Weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
  half_yearly: "Every 6 Months",
  yearly: "Yearly",
  custom: "Custom",
};

function formatFrequency(freq: string): string {
  return FREQUENCY_LABELS[freq] ?? freq;
}

function formatTemplateStatus(status: string): string {
  const map: Record<string, string> = {
    active: "Active",
    paused: "Paused",
    completed: "Completed",
    expired: "Expired",
  };
  return map[status] ?? status;
}

function formatRuns(totalRuns: number, maxRuns: number | null): string {
  if (maxRuns) return `${totalRuns}/${maxRuns}`;
  return String(totalRuns);
}

interface ListOpts {
  json?: boolean;
  format?: string;
  status?: string;
  page?: number;
  limit?: number;
}

export async function automatedInvoiceListCommand(opts: ListOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  const page = opts.page ?? 1;
  const limit = opts.limit ?? 20;

  try {
    const result = await client.recurringInvoice.list({
      status: opts.status as "active" | "paused" | "completed" | "expired" | undefined,
      page,
      limit,
    });

    if (opts.json) {
      outputJSON({ data: result.data, pagination: { page: result.page, limit: result.limit, total: result.total } });
      return;
    }

    console.log(`\n Recurring Invoices  ${result.total} total\n`);

    const cols: ColumnDef<RecurringInvoiceSummary>[] = [
      { key: "name", header: "Name", width: 20 },
      { key: "partyName", header: "Party", width: 18 },
      { key: "frequency", header: "Frequency", width: 14, format: (v) => formatFrequency(String(v ?? "")) },
      { key: "status", header: "Status", width: 10, format: (v) => formatTemplateStatus(String(v ?? "")) },
      { key: "nextRunDate", header: "Next Run", width: 13, format: (v) => formatDate(String(v ?? "")) },
      { key: "totalRuns", header: "Runs", width: 8, align: "right", format: (v, row) => formatRuns(Number(v ?? 0), row.maxRuns) },
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
