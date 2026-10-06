import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, outputTable, outputTSV, outputCSV, EXIT, hasColor, type ColumnDef } from "../../output.js";
import { formatAmount, fyStart, todayISO, monthStart, monthEnd, apiFrom, apiTo } from "../../format.js";
import chalk from "chalk";

interface TopCustomersOpts {
  limit?: number;
  from?: string;
  to?: string;
  thisMonth?: boolean;
  thisFy?: boolean;
  json?: boolean;
  format?: string;
}

export async function dashboardTopCustomersCommand(opts: TopCustomersOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  let fromDate = opts.from;
  let toDate = opts.to;
  if (opts.thisMonth) { fromDate = monthStart(); toDate = monthEnd(); }
  else if (opts.thisFy) { fromDate = fyStart(); toDate = todayISO(); }

  try {
    const data = await client.dashboard.topCustomers({
      limit: opts.limit,
      fromDate: apiFrom(fromDate),
      toDate: apiTo(toDate),
    });

    if (opts.json) {
      outputJSON(data);
      return;
    }

    const rows = data.map((r) => ({
      party: r.partyName,
      revenue: formatAmount(r.totalAmount),
      invoices: String(r.invoiceCount),
    }));

    const columns: ColumnDef<(typeof rows)[number]>[] = [
      { key: "party", header: "Customer", align: "left" },
      { key: "revenue", header: "Revenue ₹", align: "right" },
      { key: "invoices", header: "Invoices", align: "right" },
    ];

    if (opts.format === "tsv") {
      outputTSV(rows, columns);
    } else if (opts.format === "csv") {
      outputCSV(rows, columns);
    } else {
      if (hasColor()) process.stdout.write("\n" + chalk.bold("  Top Customers by Revenue\n") + "\n");
      else process.stdout.write("\n  Top Customers by Revenue\n\n");
      outputTable(rows, columns);
      process.stdout.write("\n");
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
