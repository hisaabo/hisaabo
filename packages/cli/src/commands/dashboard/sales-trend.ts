import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, outputTable, outputTSV, outputCSV, EXIT, hasColor } from "../../output.js";
import { formatAmount, fyStart, todayISO, monthStart } from "../../format.js";
import chalk from "chalk";

interface SalesTrendOpts {
  months?: number;
  from?: string;
  to?: string;
  granularity?: string;
  json?: boolean;
  format?: string;
}

export async function dashboardSalesTrendCommand(opts: SalesTrendOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  const input: Record<string, unknown> = {};
  if (opts.months) input["months"] = opts.months;
  if (opts.from) input["fromDate"] = opts.from;
  if (opts.to) input["toDate"] = opts.to;
  if (opts.granularity) input["granularity"] = opts.granularity;

  try {
    const data = await client.dashboard.salesTrend(input as Parameters<typeof client.dashboard.salesTrend>[0]);

    if (opts.json) {
      outputJSON(data);
      return;
    }

    const rows: Array<{ period: string; sales: string; collections: string; invoices: string }> = Array.isArray(data)
      ? data.map((r: Record<string, unknown>) => ({
          period: String(r["period"] ?? r["month"] ?? "-"),
          sales: formatAmount(String(r["sales"] ?? r["totalSales"] ?? "0")),
          collections: formatAmount(String(r["collections"] ?? r["totalCollections"] ?? "0")),
          invoices: String(r["invoices"] ?? r["invoiceCount"] ?? "0"),
        }))
      : [];

    const columns = [
      { key: "period", header: "Period", align: "left" as const },
      { key: "sales", header: "Sales ₹", align: "right" as const },
      { key: "collections", header: "Collection ₹", align: "right" as const },
      { key: "invoices", header: "Invoices", align: "right" as const },
    ];

    if (opts.format === "tsv") {
      outputTSV(rows, columns);
    } else if (opts.format === "csv") {
      outputCSV(rows, columns);
    } else {
      if (hasColor()) process.stdout.write("\n" + chalk.bold("  Sales Trend\n") + "\n");
      else process.stdout.write("\n  Sales Trend\n\n");
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
