import { HisaaboClient, HisaaboApiError, type PaymentSummary } from "../../client.js";
import { requireAuth } from "../../config.js";
import {
  fatalError, outputJSON, outputTable, outputTSV, outputCSV, outputIds,
  paginationFooter, EXIT, type ColumnDef,
} from "../../output.js";
import { formatAmount, formatDate } from "../../format.js";

interface ListOpts {
  json?: boolean;
  format?: string;
  partyId?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export async function paymentListCommand(opts: ListOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  const page = opts.page ?? 1;
  const limit = opts.limit ?? 20;

  try {
    const result = await client.payment.list({
      partyId: opts.partyId ?? null,
      fromDate: opts.from ?? null,
      toDate: opts.to ?? null,
      page,
      limit,
    });

    if (opts.json) {
      outputJSON({ data: result.data, pagination: { page: result.page, limit: result.limit, total: result.total } });
      return;
    }

    console.log(`\n Payments  ${result.total} total\n`);

    const cols: ColumnDef<PaymentSummary>[] = [
      { key: "paymentNumber", header: "#", width: 10 },
      { key: "partyName", header: "Party", width: 20 },
      { key: "paymentDate", header: "Date", width: 13, format: (v) => formatDate(String(v ?? "")) },
      { key: "amount", header: "Amount (₹)", align: "right", width: 13, format: (v) => formatAmount(String(v ?? "0")) },
      { key: "mode", header: "Mode", width: 8 },
      { key: "referenceNumber", header: "Ref#", width: 14, format: (v) => String(v ?? "-") },
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
