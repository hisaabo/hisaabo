import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, outputTable, EXIT, hasColor } from "../../output.js";
import { formatAmount, formatStatus, fyStart, todayISO, monthStart, monthEnd } from "../../format.js";
import chalk from "chalk";

interface InvoiceBreakdownOpts {
  from?: string;
  to?: string;
  thisMonth?: boolean;
  thisFy?: boolean;
  json?: boolean;
}

export async function dashboardInvoiceBreakdownCommand(opts: InvoiceBreakdownOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  let fromDate = opts.from;
  let toDate = opts.to;
  if (opts.thisMonth) { fromDate = monthStart(); toDate = monthEnd(); }
  else if (opts.thisFy) { fromDate = fyStart(); toDate = todayISO(); }

  try {
    const data = await client.dashboard.invoiceStatusBreakdown({ fromDate, toDate });

    if (opts.json) {
      outputJSON(data);
      return;
    }

    // data may be an object like { draft: { count, amount }, sent: { count, amount }, ... }
    // or an array of { status, count, amount }
    const ORDER = ["draft", "sent", "partial", "paid", "overdue", "cancelled"];

    let rows: Array<{ status: string; count: string; amount: string }>;

    if (Array.isArray(data)) {
      rows = data.map((r: Record<string, unknown>) => ({
        status: formatStatus(String(r["status"] ?? "-")),
        count: String(r["count"] ?? "-"),
        amount: formatAmount(String(r["totalAmount"] ?? r["amount"] ?? "0")),
      }));
    } else if (data && typeof data === "object") {
      const obj = data as Record<string, unknown>;
      rows = ORDER.flatMap((status) => {
        const entry = obj[status] as Record<string, unknown> | undefined;
        if (!entry) return [];
        return [{
          status: formatStatus(status),
          count: String(entry["count"] ?? "-"),
          amount: formatAmount(String(entry["totalAmount"] ?? entry["amount"] ?? "0")),
        }];
      });
      // Also include any statuses not in ORDER
      for (const key of Object.keys(obj)) {
        if (!ORDER.includes(key)) {
          const entry = obj[key] as Record<string, unknown>;
          rows.push({
            status: formatStatus(key),
            count: String(entry["count"] ?? "-"),
            amount: formatAmount(String(entry["totalAmount"] ?? entry["amount"] ?? "0")),
          });
        }
      }
    } else {
      rows = [];
    }

    const columns = [
      { key: "status", header: "Status", align: "left" as const },
      { key: "count", header: "Count", align: "right" as const },
      { key: "amount", header: "Amount ₹", align: "right" as const },
    ];

    if (hasColor()) process.stdout.write("\n" + chalk.bold("  Invoice Status Breakdown\n") + "\n");
    else process.stdout.write("\n  Invoice Status Breakdown\n\n");
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
