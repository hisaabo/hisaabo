import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, outputTable, outputTSV, outputCSV, EXIT, hasColor } from "../../output.js";
import { formatAmount, fyStart, todayISO, monthStart, monthEnd } from "../../format.js";
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
      fromDate,
      toDate,
    });

    if (opts.json) {
      outputJSON(data);
      return;
    }

    const rows: Array<{ party: string; revenue: string; invoices: string }> = Array.isArray(data)
      ? data.map((r: Record<string, unknown>) => ({
          party: String(r["partyName"] ?? r["party"] ?? "-"),
          revenue: formatAmount(String(r["revenue"] ?? r["totalRevenue"] ?? r["totalSales"] ?? "0")),
          invoices: String(r["invoiceCount"] ?? r["invoices"] ?? "-"),
        }))
      : [];

    const columns = [
      { key: "party", header: "Customer", align: "left" as const },
      { key: "revenue", header: "Revenue ₹", align: "right" as const },
      { key: "invoices", header: "Invoices", align: "right" as const },
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
