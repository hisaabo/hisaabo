import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, outputTable, outputTSV, outputCSV, EXIT, hasColor, type ColumnDef } from "../../output.js";
import { formatAmount, fyStart, todayISO, monthStart, monthEnd, apiFrom, apiTo } from "../../format.js";
import chalk from "chalk";

interface PaymentModesOpts {
  from?: string;
  to?: string;
  thisMonth?: boolean;
  thisFy?: boolean;
  json?: boolean;
  format?: string;
}

const MODE_LABELS: Record<string, string> = {
  cash:          "Cash",
  upi:           "UPI",
  bank_transfer: "Bank Transfer",
  cheque:        "Cheque",
  card:          "Card",
  neft:          "NEFT",
  rtgs:          "RTGS",
  imps:          "IMPS",
  dd:            "Demand Draft",
  credit:        "Credit",
  other:         "Other",
};

function modeLabel(raw: string): string {
  return MODE_LABELS[raw.toLowerCase()] ?? raw;
}

export async function dashboardPaymentModesCommand(opts: PaymentModesOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  let fromDate = opts.from;
  let toDate = opts.to;
  if (opts.thisMonth)    { fromDate = monthStart(); toDate = monthEnd(); }
  else if (opts.thisFy)  { fromDate = fyStart();    toDate = todayISO(); }

  try {
    const data = await client.dashboard.paymentModeBreakdown({ fromDate: apiFrom(fromDate), toDate: apiTo(toDate) });

    if (opts.json) {
      outputJSON(data);
      return;
    }

    const modes = data.map((r) => ({
      mode:   r.mode as string,
      amount: parseFloat(r.total),
      count:  r.count,
    }));

    // Sort descending by amount
    modes.sort((a, b) => b.amount - a.amount);

    const total = modes.reduce((s, r) => s + r.amount, 0);

    const rows = modes.map((r) => {
      const pct = total > 0 ? ((r.amount / total) * 100).toFixed(1) + "%" : "-";
      return {
        mode:   modeLabel(r.mode),
        amount: formatAmount(r.amount),
        count:  r.count > 0 ? String(r.count) : "-",
        pct,
      };
    });

    const columns: ColumnDef<(typeof rows)[number]>[] = [
      { key: "mode",   header: "Payment Mode", align: "left" },
      { key: "amount", header: "Amount ₹",     align: "right" },
      { key: "count",  header: "Count",         align: "right" },
      { key: "pct",    header: "% of Total",    align: "right" },
    ];

    if (opts.format === "tsv") {
      outputTSV(rows, columns);
    } else if (opts.format === "csv") {
      outputCSV(rows, columns);
    } else {
      if (hasColor()) process.stdout.write("\n" + chalk.bold("  Payment Mode Breakdown\n") + "\n");
      else process.stdout.write("\n  Payment Mode Breakdown\n\n");
      outputTable(rows, columns);
      if (total > 0) {
        const totalStr = `  Total: ₹${formatAmount(total)}`;
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
