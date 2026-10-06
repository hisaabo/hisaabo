import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, outputTSV, outputCSV, EXIT, hasColor, termWidth, type ColumnDef } from "../../output.js";
import { formatAmount, fyStart, todayISO, monthStart, monthEnd, apiFrom, apiTo } from "../../format.js";
import chalk from "chalk";

interface CollectionEfficiencyOpts {
  from?: string;
  to?: string;
  thisMonth?: boolean;
  thisFy?: boolean;
  json?: boolean;
  format?: string;
}

function rateBar(rate: number, width: number): string {
  const clamped = Math.min(100, Math.max(0, rate));
  const filled  = Math.round((clamped / 100) * width);
  const bar     = "█".repeat(filled) + "░".repeat(width - filled);
  if (!hasColor()) return bar;
  if (clamped >= 80) return chalk.green(bar);
  if (clamped >= 50) return chalk.yellow(bar);
  return chalk.red(bar);
}

export async function dashboardCollectionEfficiencyCommand(opts: CollectionEfficiencyOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  let fromDate = opts.from;
  let toDate = opts.to;
  if (opts.thisMonth)   { fromDate = monthStart(); toDate = monthEnd(); }
  else if (opts.thisFy) { fromDate = fyStart();    toDate = todayISO(); }

  try {
    const data = await client.dashboard.collectionEfficiency({ fromDate: apiFrom(fromDate), toDate: apiTo(toDate) });

    if (opts.json) {
      outputJSON(data);
      return;
    }

    // Top-level metrics
    const totalInvoiced  = parseFloat(data.totalInvoiced);
    const totalCollected = parseFloat(data.totalCollected);
    const outstanding    = totalInvoiced - totalCollected;
    const collectionRate = data.efficiencyPct;

    if (opts.format === "tsv" || opts.format === "csv") {
      const rows: Array<Record<string, string>> = [
        { metric: "Total Invoiced",  value: formatAmount(totalInvoiced) },
        { metric: "Total Collected", value: formatAmount(totalCollected) },
        { metric: "Outstanding",     value: formatAmount(outstanding) },
        { metric: "Collection Rate", value: `${collectionRate.toFixed(1)}%` },
      ];
      const columns: ColumnDef<(typeof rows)[number]>[] = [
        { key: "metric", header: "Metric", align: "left" },
        { key: "value",  header: "Value",  align: "right" },
      ];
      if (opts.format === "tsv") outputTSV(rows, columns);
      else outputCSV(rows, columns);
      return;
    }

    // Pretty display
    const width  = Math.min(termWidth() - 4, 56);
    const innerW = width - 2;
    const barW   = Math.max(8, innerW - 22);

    const line = (label: string, value: string, opts2: { bold?: boolean; color?: (s: string) => string } = {}): void => {
      const lbl = label.padEnd(20).slice(0, 20);
      const val = value.padStart(innerW - 22).slice(0, innerW - 22);
      let out = `  │ ${lbl}  ${val} │`;
      if (hasColor()) {
        if (opts2.bold)  out = `  │ ${chalk.bold(lbl)}  ${val} │`;
        if (opts2.color) out = `  │ ${opts2.bold ? chalk.bold(lbl) : lbl}  ${opts2.color(val)} │`;
      }
      process.stdout.write(out + "\n");
    };

    const sep = (): void => { process.stdout.write("  ├" + "─".repeat(innerW) + "┤\n"); };

    process.stdout.write("\n");
    if (hasColor()) process.stdout.write("  " + chalk.bold("Collection Efficiency") + "\n\n");
    else            process.stdout.write("  Collection Efficiency\n\n");

    process.stdout.write("  ┌" + "─".repeat(innerW) + "┐\n");

    line("Total Invoiced",  `₹${formatAmount(totalInvoiced)}`,  { bold: true });
    line("Total Collected", `₹${formatAmount(totalCollected)}`, {
      color: totalCollected >= totalInvoiced * 0.8 ? chalk.green : chalk.yellow,
    });
    line("Outstanding",     `₹${formatAmount(outstanding)}`,    {
      color: outstanding > 0 ? chalk.red : chalk.green,
    });
    sep();

    // Collection rate with bar
    const rateStr  = `${collectionRate.toFixed(1)}%`;
    const bar      = rateBar(collectionRate, barW);
    const rateLabel = "Collection Rate".padEnd(20).slice(0, 20);
    process.stdout.write(`  │ ${hasColor() ? chalk.bold(rateLabel) : rateLabel}  ${bar} ${rateStr.padStart(6)} │\n`);


    process.stdout.write("  └" + "─".repeat(innerW) + "┘\n\n");

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}
