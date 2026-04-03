import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, outputTable, outputTSV, outputCSV, EXIT, hasColor } from "../../output.js";
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

function pctChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / Math.abs(previous)) * 100;
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

    // data can be:
    // 1. An array of monthly records: [{ month, year, sales, expenses, profit, collections, ... }]
    // 2. An object: { current: {...}, previous: {...}, ... }
    // 3. An object with month keys: { "2025-03": {...}, "2025-04": {...}, ... }

    type MonthRecord = {
      period: string;
      sales: number;
      expenses: number;
      profit: number;
      collections: number;
    };

    let months: MonthRecord[] = [];

    if (Array.isArray(data)) {
      months = data.map((r: Record<string, unknown>) => {
        const month  = String(r["month"] ?? r["period"] ?? r["label"] ?? "-");
        const year   = r["year"] ? String(r["year"]) : "";
        const period = year ? `${month} ${year}` : month;
        return {
          period,
          sales:       parseFloat(String(r["sales"]       ?? r["totalSales"]       ?? "0")),
          expenses:    parseFloat(String(r["expenses"]     ?? r["totalExpenses"]    ?? "0")),
          profit:      parseFloat(String(r["profit"]       ?? r["netProfit"]        ?? "0")),
          collections: parseFloat(String(r["collections"]  ?? r["totalCollections"] ?? "0")),
        };
      });
    } else if (data && typeof data === "object") {
      const obj = data as Record<string, unknown>;
      // Try current/previous shape
      if ("current" in obj || "previous" in obj) {
        const cur  = (obj["current"]  ?? {}) as Record<string, unknown>;
        const prev = (obj["previous"] ?? {}) as Record<string, unknown>;
        months = [
          {
            period:      "Previous Month",
            sales:       parseFloat(String(prev["sales"]       ?? prev["totalSales"]       ?? "0")),
            expenses:    parseFloat(String(prev["expenses"]     ?? prev["totalExpenses"]    ?? "0")),
            profit:      parseFloat(String(prev["profit"]       ?? prev["netProfit"]        ?? "0")),
            collections: parseFloat(String(prev["collections"]  ?? prev["totalCollections"] ?? "0")),
          },
          {
            period:      "Current Month",
            sales:       parseFloat(String(cur["sales"]       ?? cur["totalSales"]       ?? "0")),
            expenses:    parseFloat(String(cur["expenses"]     ?? cur["totalExpenses"]    ?? "0")),
            profit:      parseFloat(String(cur["profit"]       ?? cur["netProfit"]        ?? "0")),
            collections: parseFloat(String(cur["collections"]  ?? cur["totalCollections"] ?? "0")),
          },
        ];
      } else {
        // Month-keyed object: sort chronologically
        const entries = Object.entries(obj).sort(([a], [b]) => a.localeCompare(b));
        months = entries.map(([period, val]) => {
          const r = (val ?? {}) as Record<string, unknown>;
          return {
            period,
            sales:       parseFloat(String(r["sales"]       ?? r["totalSales"]       ?? "0")),
            expenses:    parseFloat(String(r["expenses"]     ?? r["totalExpenses"]    ?? "0")),
            profit:      parseFloat(String(r["profit"]       ?? r["netProfit"]        ?? "0")),
            collections: parseFloat(String(r["collections"]  ?? r["totalCollections"] ?? "0")),
          };
        });
      }
    }

    if (opts.format === "tsv" || opts.format === "csv") {
      const rows = months.map((m, i) => {
        const prev = months[i - 1];
        return {
          period:      m.period,
          sales:       formatAmount(m.sales),
          salesChg:    prev ? `${pctChange(m.sales, prev.sales).toFixed(1)}%` : "-",
          expenses:    formatAmount(m.expenses),
          profit:      formatAmount(m.profit),
          collections: formatAmount(m.collections),
        };
      });
      const columns = [
        { key: "period",      header: "Month",         align: "left" as const },
        { key: "sales",       header: "Sales ₹",       align: "right" as const },
        { key: "salesChg",    header: "Sales Δ%",      align: "right" as const },
        { key: "expenses",    header: "Expenses ₹",    align: "right" as const },
        { key: "profit",      header: "Profit ₹",      align: "right" as const },
        { key: "collections", header: "Collections ₹", align: "right" as const },
      ];
      if (opts.format === "tsv") outputTSV(rows, columns);
      else outputCSV(rows, columns);
      return;
    }

    // Pretty table display
    if (hasColor()) process.stdout.write("\n" + chalk.bold("  Monthly Comparison\n") + "\n");
    else            process.stdout.write("\n  Monthly Comparison\n\n");

    // Show month-over-month change for last two months if we have >= 2
    if (months.length >= 2) {
      const last = months[months.length - 1]!;
      const prev = months[months.length - 2]!;
      const salesPct   = pctChange(last.sales,       prev.sales);
      const expPct     = pctChange(last.expenses,    prev.expenses);
      const profitPct  = pctChange(last.profit,      prev.profit);
      const collPct    = pctChange(last.collections, prev.collections);

      process.stdout.write(`  ${hasColor() ? chalk.dim("Month-over-month (latest vs previous)") : "Month-over-month (latest vs previous)"}\n\n`);
      const summaryRows = [
        { metric: "Sales",       current: formatAmount(last.sales),       change: changeArrow(salesPct) },
        { metric: "Collections", current: formatAmount(last.collections), change: changeArrow(collPct) },
        { metric: "Expenses",    current: formatAmount(last.expenses),    change: changeArrow(-expPct) },
        { metric: "Profit",      current: formatAmount(last.profit),      change: changeArrow(profitPct) },
      ];
      const summaryColumns = [
        { key: "metric",  header: "Metric",     align: "left" as const },
        { key: "current", header: "Latest ₹",   align: "right" as const },
        { key: "change",  header: "vs Prev",     align: "right" as const },
      ];
      outputTable(summaryRows, summaryColumns);
      process.stdout.write("\n");
    }

    // Full trend table
    const rows = months.map((m, i) => {
      const prev       = months[i - 1];
      const salesChg   = prev ? changeArrow(pctChange(m.sales, prev.sales)) : "-";
      const profitColor = m.profit >= 0
        ? (hasColor() ? chalk.green(formatAmount(m.profit))  : formatAmount(m.profit))
        : (hasColor() ? chalk.red(formatAmount(m.profit))    : formatAmount(m.profit));
      return {
        period:      m.period,
        sales:       formatAmount(m.sales),
        salesChg,
        expenses:    formatAmount(m.expenses),
        profit:      profitColor,
        collections: formatAmount(m.collections),
      };
    });

    const columns = [
      { key: "period",      header: "Month",         align: "left" as const },
      { key: "sales",       header: "Sales ₹",       align: "right" as const },
      { key: "salesChg",    header: "Δ%",            align: "right" as const },
      { key: "expenses",    header: "Expenses ₹",    align: "right" as const },
      { key: "profit",      header: "Profit ₹",      align: "right" as const },
      { key: "collections", header: "Collections ₹", align: "right" as const },
    ];

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
