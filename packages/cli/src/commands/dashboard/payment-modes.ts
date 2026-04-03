import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, outputTable, outputTSV, outputCSV, EXIT, hasColor } from "../../output.js";
import { formatAmount, fyStart, todayISO, monthStart, monthEnd } from "../../format.js";
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
    const data = await client.dashboard.paymentModeBreakdown({ fromDate, toDate });

    if (opts.json) {
      outputJSON(data);
      return;
    }

    // data can be an array of { mode, amount, count } or an object keyed by mode
    type ModeRow = { mode: string; amount: number; count: number };
    let modes: ModeRow[] = [];

    if (Array.isArray(data)) {
      modes = data.map((r: Record<string, unknown>) => ({
        mode:   String(r["mode"] ?? r["paymentMode"] ?? r["method"] ?? "-"),
        amount: parseFloat(String(r["amount"] ?? r["totalAmount"] ?? "0")),
        count:  parseInt(String(r["count"] ?? r["paymentCount"] ?? "0"), 10),
      }));
    } else if (data && typeof data === "object") {
      const obj = data as Record<string, unknown>;
      for (const [key, val] of Object.entries(obj)) {
        if (typeof val === "object" && val !== null) {
          const entry = val as Record<string, unknown>;
          modes.push({
            mode:   key,
            amount: parseFloat(String(entry["amount"] ?? entry["totalAmount"] ?? "0")),
            count:  parseInt(String(entry["count"] ?? "0"), 10),
          });
        } else if (typeof val === "string" || typeof val === "number") {
          modes.push({ mode: key, amount: parseFloat(String(val)), count: 0 });
        }
      }
    }

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

    const columns = [
      { key: "mode",   header: "Payment Mode", align: "left" as const },
      { key: "amount", header: "Amount ₹",     align: "right" as const },
      { key: "count",  header: "Count",         align: "right" as const },
      { key: "pct",    header: "% of Total",    align: "right" as const },
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
