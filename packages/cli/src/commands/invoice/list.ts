import { HisaaboClient, HisaaboApiError, type InvoiceSummary } from "../../client.js";
import { requireAuth } from "../../config.js";
import {
  fatalError, outputJSON, outputTable, outputTSV, outputCSV, outputIds,
  paginationFooter, EXIT, getWidthTier, type ColumnDef,
} from "../../output.js";
import { formatAmount, formatDate, formatStatus, currentFY, fyStart, todayISO, monthStart, monthEnd } from "../../format.js";

interface ListOpts {
  json?: boolean;
  format?: string;
  type?: string;
  status?: string;
  party?: string;
  partyId?: string;
  from?: string;
  to?: string;
  thisMonth?: boolean;
  thisQuarter?: boolean;
  thisFy?: boolean;
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortDir?: string;
}

export async function invoiceListCommand(opts: ListOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  // Resolve date range
  let from = opts.from;
  let to = opts.to;
  if (opts.thisFy) { from = fyStart(); to = todayISO(); }
  else if (opts.thisMonth) { from = monthStart(); to = monthEnd(); }
  else if (opts.thisQuarter) {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    if (month >= 4 && month <= 6) { from = `${year}-04-01`; to = `${year}-06-30`; }
    else if (month >= 7 && month <= 9) { from = `${year}-07-01`; to = `${year}-09-30`; }
    else if (month >= 10 && month <= 12) { from = `${year}-10-01`; to = `${year}-12-31`; }
    else { from = `${year}-01-01`; to = `${year}-03-31`; }
  }

  const page = opts.page ?? 1;
  const limit = opts.limit ?? 20;

  try {
    const result = await client.invoice.list({
      type: opts.type as "sale" | "purchase" | undefined ?? null,
      status: opts.status as InvoiceSummary["status"] | undefined ?? null,
      partyId: opts.partyId ?? null,
      fromDate: from ?? null,
      toDate: to ?? null,
      search: opts.search ?? null,
      sortBy: opts.sortBy as "date" | "amount" | "number" | undefined ?? null,
      sortDir: opts.sortDir as "asc" | "desc" | undefined ?? null,
      page,
      limit,
    });

    if (opts.json) {
      outputJSON({
        data: result.data,
        pagination: { page: result.page, limit: result.limit, total: result.total, hasMore: result.page * result.limit < result.total },
      });
      return;
    }

    const tier = getWidthTier();

    // Title
    const typeLabel = opts.type === "purchase" ? "Purchase Bills" : "Sale Invoices";
    console.log(`\n ${typeLabel}` + " ".repeat(40) + `FY ${currentFY()}`);
    console.log(` ${"═".repeat(68)}\n`);

    const narrowCols: ColumnDef<InvoiceSummary>[] = [
      { key: "invoiceNumber", header: "#", width: 10 },
      { key: "partyName", header: "Party", width: 18 },
      { key: "totalAmount", header: "Amount (₹)", align: "right", width: 12, format: (v) => formatAmount(String(v ?? "0")) },
      { key: "status", header: "Status", width: 10, format: (v) => formatStatus(String(v ?? "")) },
    ];

    const standardCols: ColumnDef<InvoiceSummary>[] = [
      { key: "invoiceNumber", header: "#", width: 10 },
      { key: "partyName", header: "Party", width: 18 },
      { key: "invoiceDate", header: "Date", width: 12, format: (v) => formatDate(String(v ?? "")) },
      { key: "totalAmount", header: "Amount (₹)", align: "right", width: 13, format: (v) => formatAmount(String(v ?? "0")) },
      { key: "status", header: "Status", width: 10, format: (v) => formatStatus(String(v ?? "")) },
    ];

    const wideCols: ColumnDef<InvoiceSummary>[] = [
      { key: "invoiceNumber", header: "#", width: 10 },
      { key: "partyName", header: "Party", width: 18 },
      { key: "invoiceDate", header: "Date", width: 12, format: (v) => formatDate(String(v ?? "")) },
      { key: "dueDate", header: "Due", width: 12, format: (v) => formatDate(v ? String(v) : null) },
      { key: "totalAmount", header: "Amount (₹)", align: "right", width: 13, format: (v) => formatAmount(String(v ?? "0")) },
      { key: "amountPaid", header: "Paid (₹)", align: "right", width: 12, format: (v) => formatAmount(String(v ?? "0")) },
      { key: "balanceDue", header: "Balance (₹)", align: "right", width: 12, format: (v) => formatAmount(String(v ?? "0")) },
      { key: "status", header: "Status", width: 10, format: (v) => formatStatus(String(v ?? "")) },
    ];

    const cols = tier === "narrow" ? narrowCols : tier === "wide" ? wideCols : standardCols;

    if (opts.format === "tsv") {
      outputTSV(result.data, cols);
    } else if (opts.format === "csv") {
      outputCSV(result.data, cols);
    } else if (opts.format === "ids") {
      outputIds(result.data.map((r) => r.id));
    } else {
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
