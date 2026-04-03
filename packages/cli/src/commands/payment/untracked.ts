import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import {
  fatalError, outputJSON, outputTable, outputTSV, outputCSV, paginationFooter, EXIT, type ColumnDef,
} from "../../output.js";
import { formatAmount, formatDate } from "../../format.js";

interface UntrackedPayment {
  id: string;
  paymentNumber: string;
  partyName: string;
  paymentDate: string;
  amount: string;
  mode: string;
  referenceNumber: string | null;
}

interface UntrackedOpts {
  json?: boolean;
  format?: string;
  page?: number;
  limit?: number;
}

export async function paymentUntrackedCommand(opts: UntrackedOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  const page = opts.page ?? 1;
  const limit = opts.limit ?? 20;

  try {
    const result = await client.payment.untrackedPayments({ page, limit });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const payments: UntrackedPayment[] = Array.isArray(result) ? result : (result?.data ?? []);
    const total: number = result?.total ?? payments.length;
    const resultPage: number = result?.page ?? page;
    const resultLimit: number = result?.limit ?? limit;

    console.log(`\n  Untracked Payments  ${total} total\n`);

    const cols: ColumnDef<UntrackedPayment>[] = [
      { key: "paymentNumber", header: "#", width: 12 },
      { key: "partyName", header: "Party", width: 22 },
      { key: "paymentDate", header: "Date", width: 13, format: (v) => formatDate(String(v ?? "")) },
      { key: "amount", header: "Amount (₹)", align: "right", width: 13, format: (v) => formatAmount(String(v ?? "0")) },
      { key: "mode", header: "Mode", width: 8 },
      { key: "referenceNumber", header: "Ref#", width: 14, format: (v) => String(v ?? "-") },
    ];

    if (opts.format === "tsv") outputTSV(payments, cols);
    else if (opts.format === "csv") outputCSV(payments, cols);
    else {
      outputTable(payments, cols);
      paginationFooter(resultPage, resultLimit, total);
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
