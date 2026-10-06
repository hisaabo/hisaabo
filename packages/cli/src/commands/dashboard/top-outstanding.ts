import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, outputTable, outputTSV, outputCSV, EXIT, hasColor, type ColumnDef } from "../../output.js";
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

    const rows = data.map((r) => ({
      party: r.partyName,
      outstanding: formatAmount(r.outstanding),
    }));

    const columns: ColumnDef<(typeof rows)[number]>[] = [
      { key: "party", header: "Party", align: "left" },
      { key: "outstanding", header: "Outstanding ₹", align: "right" },
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
