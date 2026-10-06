import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, outputTable, outputTSV, outputCSV, EXIT, hasColor, type ColumnDef } from "../../output.js";
import { formatAmount, fyStart, todayISO, monthStart, monthEnd, apiFrom, apiTo } from "../../format.js";
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
    const data = await client.dashboard.expensesByCategory({ fromDate: apiFrom(fromDate), toDate: apiTo(toDate) });

    if (opts.json) {
      outputJSON(data);
      return;
    }

    const total = data.reduce((sum, r) => sum + parseFloat(r.total), 0);

    const rows = data.map((r) => {
      const amt = parseFloat(r.total);
      const pct = total > 0 ? ((amt / total) * 100).toFixed(1) + "%" : "-";
      return {
        category: r.category,
        amount: formatAmount(String(amt)),
        count: String(r.count),
        pct,
      };
    });

    const columns: ColumnDef<(typeof rows)[number]>[] = [
      { key: "category", header: "Category", align: "left" },
      { key: "amount", header: "Amount ₹", align: "right" },
      { key: "count", header: "Count", align: "right" },
      { key: "pct", header: "% of Total", align: "right" },
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
