import { HisaaboClient, HisaaboApiError } from "../../client.js";
import type { InputOf } from "../../api-types.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, outputTable, outputTSV, outputCSV, EXIT, hasColor, type ColumnDef } from "../../output.js";
import { formatAmount, apiFrom, apiTo } from "../../format.js";
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

  const input: InputOf<"dashboard.salesTrend"> = {};
  if (opts.months) input.months = opts.months;
  if (opts.from) input.fromDate = apiFrom(opts.from);
  if (opts.to) input.toDate = apiTo(opts.to);
  if (opts.granularity === "week" || opts.granularity === "month" || opts.granularity === "fy") input.granularity = opts.granularity;

  try {
    const data = await client.dashboard.salesTrend(input);

    if (opts.json) {
      outputJSON(data);
      return;
    }

    const rows = data.map((r) => ({
      period: r.period,
      sales: formatAmount(r.invoiced),
      collections: formatAmount(r.collected),
    }));

    const columns: ColumnDef<(typeof rows)[number]>[] = [
      { key: "period", header: "Period", align: "left" },
      { key: "sales", header: "Sales ₹", align: "right" },
      { key: "collections", header: "Collection ₹", align: "right" },
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
