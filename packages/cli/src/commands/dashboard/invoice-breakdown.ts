import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, outputTable, EXIT, hasColor, type ColumnDef } from "../../output.js";
import { formatAmount, formatStatus, fyStart, todayISO, monthStart, monthEnd, apiFrom, apiTo } from "../../format.js";
import chalk from "chalk";

interface InvoiceBreakdownOpts {
  from?: string;
  to?: string;
  thisMonth?: boolean;
  thisFy?: boolean;
  json?: boolean;
}

export async function dashboardInvoiceBreakdownCommand(opts: InvoiceBreakdownOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  let fromDate = opts.from;
  let toDate = opts.to;
  if (opts.thisMonth) { fromDate = monthStart(); toDate = monthEnd(); }
  else if (opts.thisFy) { fromDate = fyStart(); toDate = todayISO(); }

  try {
    const data = await client.dashboard.invoiceStatusBreakdown({ fromDate: apiFrom(fromDate), toDate: apiTo(toDate) });

    if (opts.json) {
      outputJSON(data);
      return;
    }

    const rows = data.map((r) => ({
      status: formatStatus(r.status),
      count: String(r.count),
      amount: formatAmount(r.total),
    }));

    const columns: ColumnDef<(typeof rows)[number]>[] = [
      { key: "status", header: "Status", align: "left" },
      { key: "count", header: "Count", align: "right" },
      { key: "amount", header: "Amount ₹", align: "right" },
    ];

    if (hasColor()) process.stdout.write("\n" + chalk.bold("  Invoice Status Breakdown\n") + "\n");
    else process.stdout.write("\n  Invoice Status Breakdown\n\n");
    outputTable(rows, columns);
    process.stdout.write("\n");

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}
