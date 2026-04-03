import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, outputTable, outputTSV, outputCSV, EXIT, hasColor } from "../../output.js";
import { formatAmount } from "../../format.js";
import chalk from "chalk";

interface TopOutstandingOpts {
  limit?: number;
  json?: boolean;
  format?: string;
}

export async function dashboardTopOutstandingCommand(opts: TopOutstandingOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const data = await client.dashboard.topOutstanding({ limit: opts.limit });

    if (opts.json) {
      outputJSON(data);
      return;
    }

    const rows: Array<{ party: string; outstanding: string; oldestAge: string }> = Array.isArray(data)
      ? data.map((r: Record<string, unknown>) => ({
          party: String(r["partyName"] ?? r["party"] ?? "-"),
          outstanding: formatAmount(String(r["outstanding"] ?? r["outstandingAmount"] ?? "0")),
          oldestAge: r["oldestInvoiceDays"] != null
            ? `${r["oldestInvoiceDays"]}d`
            : r["oldestAge"] != null
            ? `${r["oldestAge"]}d`
            : "-",
        }))
      : [];

    const columns = [
      { key: "party", header: "Party", align: "left" as const },
      { key: "outstanding", header: "Outstanding ₹", align: "right" as const },
      { key: "oldestAge", header: "Oldest Invoice", align: "right" as const },
    ];

    if (opts.format === "tsv") {
      outputTSV(rows, columns);
    } else if (opts.format === "csv") {
      outputCSV(rows, columns);
    } else {
      if (hasColor()) process.stdout.write("\n" + chalk.bold("  Top Outstanding\n") + "\n");
      else process.stdout.write("\n  Top Outstanding\n\n");
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
