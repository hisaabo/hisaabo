import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, outputTable, outputTSV, outputCSV, EXIT, hasColor, termWidth } from "../../output.js";
import { formatAmount } from "../../format.js";
import chalk from "chalk";

interface ReceivablesAgingOpts {
  json?: boolean;
  format?: string;
}

function agingBar(amount: number, maxAmount: number, barWidth: number): string {
  if (maxAmount <= 0 || amount <= 0) return "";
  const filled = Math.round((amount / maxAmount) * barWidth);
  return "█".repeat(filled) + "░".repeat(barWidth - filled);
}

export async function dashboardReceivablesAgingCommand(opts: ReceivablesAgingOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const data = await client.dashboard.receivablesAging();

    if (opts.json) {
      outputJSON(data);
      return;
    }

    // Normalize data: could be an object with bucket keys, or an array of { bucket, amount, count }
    type AgingRow = { bucket: string; amount: number; count: number };
    const BUCKETS = [
      { key: "current",  label: "Current (not due)" },
      { key: "1_30",     label: "1–30 days" },
      { key: "31_60",    label: "31–60 days" },
      { key: "61_90",    label: "61–90 days" },
      { key: "90_plus",  label: "90+ days" },
    ];

    let bucketData: AgingRow[] = [];

    if (Array.isArray(data)) {
      bucketData = data.map((r: Record<string, unknown>) => ({
        bucket: String(r["bucket"] ?? r["range"] ?? r["label"] ?? "-"),
        amount: parseFloat(String(r["amount"] ?? r["totalAmount"] ?? "0")),
        count:  parseInt(String(r["count"] ?? r["invoiceCount"] ?? "0"), 10),
      }));
    } else if (data && typeof data === "object") {
      const obj = data as Record<string, unknown>;
      for (const { key, label } of BUCKETS) {
        const entry = (obj[key] ?? obj[label]) as Record<string, unknown> | undefined;
        if (entry != null) {
          bucketData.push({
            bucket: label,
            amount: parseFloat(String(entry["amount"] ?? entry["totalAmount"] ?? "0")),
            count:  parseInt(String(entry["count"] ?? entry["invoiceCount"] ?? "0"), 10),
          });
        }
      }
      // Fallback: top-level numeric fields keyed by bucket name
      if (bucketData.length === 0) {
        for (const { key, label } of BUCKETS) {
          const val = obj[key];
          if (val != null) {
            bucketData.push({
              bucket: label,
              amount: parseFloat(String(val)),
              count: 0,
            });
          }
        }
      }
    }

    if (opts.format === "tsv" || opts.format === "csv") {
      const rows = bucketData.map((r) => ({
        bucket: r.bucket,
        amount: formatAmount(r.amount),
        count:  String(r.count || "-"),
      }));
      const columns = [
        { key: "bucket", header: "Aging Bucket", align: "left" as const },
        { key: "amount", header: "Amount ₹",     align: "right" as const },
        { key: "count",  header: "Invoices",      align: "right" as const },
      ];
      if (opts.format === "tsv") outputTSV(rows, columns);
      else outputCSV(rows, columns);
      return;
    }

    // Pretty box display
    const total = bucketData.reduce((s, r) => s + r.amount, 0);
    const maxAmount = Math.max(...bucketData.map((r) => r.amount), 1);
    const width = Math.min(termWidth() - 4, 60);
    const innerW = width - 2;

    process.stdout.write("\n");
    if (hasColor()) {
      process.stdout.write("  " + chalk.bold("Receivables Aging Report") + "\n\n");
    } else {
      process.stdout.write("  Receivables Aging Report\n\n");
    }

    process.stdout.write("  ┌" + "─".repeat(innerW) + "┐\n");

    const labelW = 22;
    const amtW   = 16;
    const barW   = Math.max(4, innerW - labelW - amtW - 5);

    for (const row of bucketData) {
      const pct     = total > 0 ? ((row.amount / total) * 100).toFixed(1) : "0.0";
      const label   = row.bucket.padEnd(labelW).slice(0, labelW);
      const amtStr  = formatAmount(row.amount).padStart(amtW);
      const bar     = agingBar(row.amount, maxAmount, barW);

      // Color: current = green, 1-30 = yellow, 31-60 = orange, 61-90 = red, 90+ = bold red
      let coloredBar = bar;
      let coloredLabel = label;
      if (hasColor()) {
        const idx = bucketData.indexOf(row);
        const colors = [chalk.green, chalk.yellow, chalk.yellow, chalk.red, chalk.red];
        const labelColors = [chalk.green, chalk.yellow, chalk.yellow, chalk.red, (s: string) => chalk.bold(chalk.red(s))];
        const colorFn = colors[idx] ?? chalk.white;
        const labelFn = labelColors[idx] ?? chalk.white;
        coloredBar   = colorFn(bar);
        coloredLabel = labelFn(label);
      }

      const pctStr = `${pct}%`.padStart(6);
      process.stdout.write(`  │ ${coloredLabel} ${coloredBar} ${amtStr} ${pctStr} │\n`);
    }

    process.stdout.write("  ├" + "─".repeat(innerW) + "┤\n");

    const totalLabel = "Total Receivables".padEnd(labelW);
    const totalAmt   = formatAmount(total).padStart(amtW);
    const totalLine  = `  │ ${hasColor() ? chalk.bold(totalLabel) : totalLabel} ${" ".repeat(barW)} ${hasColor() ? chalk.bold(totalAmt) : totalAmt}        │`;
    process.stdout.write(totalLine + "\n");
    process.stdout.write("  └" + "─".repeat(innerW) + "┘\n\n");

    if (bucketData.length === 0) {
      process.stdout.write("  No receivables data available.\n\n");
    }

    // Also show table for invoices count if we have it
    if (bucketData.some((r) => r.count > 0)) {
      const rows = bucketData.map((r) => ({
        bucket: r.bucket,
        amount: formatAmount(r.amount),
        count:  String(r.count),
      }));
      const columns = [
        { key: "bucket", header: "Aging Bucket", align: "left" as const },
        { key: "amount", header: "Amount ₹",     align: "right" as const },
        { key: "count",  header: "Invoices",      align: "right" as const },
      ];
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
