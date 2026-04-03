import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import {
  fatalError, outputJSON, outputTable, outputTSV, outputCSV, EXIT, type ColumnDef,
} from "../../output.js";
import { formatAmount, formatDate } from "../../format.js";

interface UnpaidInvoice {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  totalAmount: string;
  paidAmount: string;
  outstandingAmount: string;
  status: string;
}

interface UnpaidOpts {
  json?: boolean;
  format?: string;
}

export async function paymentUnpaidInvoicesCommand(partyId: string, opts: UnpaidOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.payment.unpaidInvoices({ partyId });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const invoices: UnpaidInvoice[] = Array.isArray(result) ? result : (result?.data ?? []);

    if (invoices.length === 0) {
      console.log("\n  No unpaid invoices for this party.\n");
      return;
    }

    console.log(`\n  Unpaid Invoices  (${invoices.length})\n`);

    const cols: ColumnDef<UnpaidInvoice>[] = [
      { key: "invoiceNumber", header: "Invoice #", width: 14 },
      { key: "invoiceDate", header: "Date", width: 13, format: (v) => formatDate(String(v ?? "")) },
      { key: "totalAmount", header: "Total (₹)", align: "right", width: 13, format: (v) => formatAmount(String(v ?? "0")) },
      { key: "paidAmount", header: "Paid (₹)", align: "right", width: 13, format: (v) => formatAmount(String(v ?? "0")) },
      { key: "outstandingAmount", header: "Outstanding (₹)", align: "right", width: 16, format: (v) => formatAmount(String(v ?? "0")) },
      { key: "status", header: "Status", width: 10, format: (v) => String(v ?? "").toUpperCase() },
    ];

    if (opts.format === "tsv") outputTSV(invoices, cols);
    else if (opts.format === "csv") outputCSV(invoices, cols);
    else outputTable(invoices, cols);

    console.log();

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "not_found") fatalError(`Party not found: ${partyId}`, EXIT.NOT_FOUND);
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "forbidden") fatalError(err.message, EXIT.FORBIDDEN);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}
