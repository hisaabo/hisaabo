import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, outputTable, outputTSV, outputCSV, EXIT, hasColor } from "../../output.js";
import { formatAmount, fyStart, todayISO, monthStart, monthEnd } from "../../format.js";
import chalk from "chalk";

interface ExpensesOpts {
  from?: string;
  to?: string;
  thisMonth?: boolean;
  thisFy?: boolean;
  json?: boolean;
  format?: string;
}

export async function dashboardExpensesCommand(opts: ExpensesOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  let fromDate = opts.from;
  let toDate = opts.to;
  if (opts.thisMonth) { fromDate = monthStart(); toDate = monthEnd(); }
  else if (opts.thisFy) { fromDate = fyStart(); toDate = todayISO(); }

  try {
    const data = await client.dashboard.expensesByCategory({ fromDate, toDate });

    if (opts.json) {
      outputJSON(data);
      return;
    }

    const items: Array<Record<string, unknown>> = Array.isArray(data) ? data : [];
    const total = items.reduce((sum, r) => sum + parseFloat(String(r["totalAmount"] ?? r["amount"] ?? "0")), 0);

    const rows = items.map((r: Record<string, unknown>) => {
      const amt = parseFloat(String(r["totalAmount"] ?? r["amount"] ?? "0"));
      const pct = total > 0 ? ((amt / total) * 100).toFixed(1) + "%" : "-";
      return {
        category: String(r["category"] ?? "-"),
        amount: formatAmount(String(amt)),
        count: String(r["count"] ?? r["expenseCount"] ?? "-"),
        pct,
      };
    });

    const columns = [
      { key: "category", header: "Category", align: "left" as const },
      { key: "amount", header: "Amount ₹", align: "right" as const },
      { key: "count", header: "Count", align: "right" as const },
      { key: "pct", header: "% of Total", align: "right" as const },
    ];

    if (opts.format === "tsv") {
      outputTSV(rows, columns);
    } else if (opts.format === "csv") {
      outputCSV(rows, columns);
    } else {
      if (hasColor()) process.stdout.write("\n" + chalk.bold("  Expenses by Category\n") + "\n");
      else process.stdout.write("\n  Expenses by Category\n\n");
      outputTable(rows, columns);
      if (total > 0) {
        const totalStr = `  Total: ₹${formatAmount(String(total))}`;
        process.stdout.write("\n" + (hasColor() ? chalk.bold(totalStr) : totalStr) + "\n");
      }
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
