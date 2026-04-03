import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, outputTable, outputTSV, outputCSV, EXIT, hasColor } from "../../output.js";
import { formatAmount, fyStart, todayISO, monthStart, monthEnd } from "../../format.js";
import chalk from "chalk";

interface TopItemsOpts {
  limit?: number;
  type?: string;
  from?: string;
  to?: string;
  thisMonth?: boolean;
  thisFy?: boolean;
  json?: boolean;
  format?: string;
}

export async function dashboardTopItemsCommand(opts: TopItemsOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  let fromDate = opts.from;
  let toDate = opts.to;
  if (opts.thisMonth) { fromDate = monthStart(); toDate = monthEnd(); }
  else if (opts.thisFy) { fromDate = fyStart(); toDate = todayISO(); }

  try {
    const data = await client.dashboard.topSellingItems({
      limit: opts.limit,
      itemType: opts.type,
      fromDate,
      toDate,
    });

    if (opts.json) {
      outputJSON(data);
      return;
    }

    const rows: Array<{ item: string; qty: string; revenue: string; type: string }> = Array.isArray(data)
      ? data.map((r: Record<string, unknown>) => ({
          item: String(r["itemName"] ?? r["name"] ?? "-"),
          qty: String(r["totalQuantity"] ?? r["qty"] ?? r["quantity"] ?? "-"),
          revenue: formatAmount(String(r["totalRevenue"] ?? r["revenue"] ?? "0")),
          type: String(r["itemType"] ?? r["type"] ?? "-"),
        }))
      : [];

    const columns = [
      { key: "item", header: "Item", align: "left" as const },
      { key: "type", header: "Type", align: "left" as const },
      { key: "qty", header: "Qty Sold", align: "right" as const },
      { key: "revenue", header: "Revenue ₹", align: "right" as const },
    ];

    if (opts.format === "tsv") {
      outputTSV(rows, columns);
    } else if (opts.format === "csv") {
      outputCSV(rows, columns);
    } else {
      if (hasColor()) process.stdout.write("\n" + chalk.bold("  Top Selling Items\n") + "\n");
      else process.stdout.write("\n  Top Selling Items\n\n");
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
