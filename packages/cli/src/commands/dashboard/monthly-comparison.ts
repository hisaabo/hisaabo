import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, outputTable, outputTSV, outputCSV, EXIT, hasColor, type ColumnDef } from "../../output.js";
import { formatAmount } from "../../format.js";
import chalk from "chalk";

interface MonthlyComparisonOpts {
  json?: boolean;
  format?: string;
}

function changeArrow(pct: number): string {
  if (!hasColor()) return pct >= 0 ? `+${pct.toFixed(1)}%` : `${pct.toFixed(1)}%`;
  if (pct > 0)  return chalk.green(`▲ +${pct.toFixed(1)}%`);
  if (pct < 0)  return chalk.red(`▼ ${pct.toFixed(1)}%`);
  return chalk.dim("─   0.0%");
}

export async function dashboardMonthlyComparisonCommand(opts: MonthlyComparisonOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const data = await client.dashboard.monthlyComparison();

    if (opts.json) {
      outputJSON(data);
      return;
    }

    const metric = (label: string, m: { curr: string; prev: string; pctChange: number | null }) => ({
      metric: label,
      previous: formatAmount(m.prev),
      current: formatAmount(m.curr),
      change: m.pctChange === null ? "-" : changeArrow(m.pctChange),
    });
    const rows = [
      metric("Sales", data.sales),
      metric("Purchases", data.purchases),
      metric("Expenses", data.expenses),
    ];

    const columns: ColumnDef<(typeof rows)[number]>[] = [
      { key: "metric",   header: "Metric",                        align: "left" },
      { key: "previous", header: `${data.prevMonth} ₹`,           align: "right" },
      { key: "current",  header: `${data.currMonth} ₹`,           align: "right" },
      { key: "change",   header: "Change",                        align: "right" },
    ];

    if (opts.format === "tsv") {
      outputTSV(rows, columns);
      return;
    }
    if (opts.format === "csv") {
      outputCSV(rows, columns);
      return;
    }

    if (hasColor()) process.stdout.write("\n" + chalk.bold("  Monthly Comparison\n") + "\n");
    else            process.stdout.write("\n  Monthly Comparison\n\n");
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
