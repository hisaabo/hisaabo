import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, outputTable, outputTSV, outputCSV, EXIT, hasColor, paginationFooter } from "../../output.js";
import { formatDate } from "../../format.js";
import chalk from "chalk";

interface AuditTrailOpts {
  page?: string;
  limit?: string;
  json?: boolean;
  format?: string;
}

export async function businessAuditTrailCommand(opts: AuditTrailOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  const page = opts.page ? parseInt(opts.page, 10) : 1;
  const limit = opts.limit ? parseInt(opts.limit, 10) : 25;

  if (isNaN(page) || page < 1) fatalError("--page must be a positive integer.", EXIT.USAGE);
  if (isNaN(limit) || limit < 1 || limit > 100) fatalError("--limit must be between 1 and 100.", EXIT.USAGE);

  try {
    const data = await client.business.auditTrail({ page, limit });

    if (opts.json) {
      outputJSON(data);
      return;
    }

    const items: unknown[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data?.data)
          ? data.data
          : [];

    const total: number = typeof data?.total === "number" ? data.total : items.length;

    const rows = items.map((item: unknown) => {
      const r = item as Record<string, unknown>;
      return {
        timestamp: formatDate(String(r["createdAt"] ?? r["timestamp"] ?? "")),
        user: String(r["userName"] ?? r["user"] ?? r["userEmail"] ?? "-"),
        action: String(r["action"] ?? r["event"] ?? "-"),
        details: String(r["details"] ?? r["description"] ?? r["meta"] ?? "-"),
      };
    });

    const columns = [
      { key: "timestamp", header: "Date", align: "left" as const },
      { key: "user", header: "User", align: "left" as const, width: 28 },
      { key: "action", header: "Action", align: "left" as const, width: 24 },
      { key: "details", header: "Details", align: "left" as const, width: 40 },
    ];

    if (opts.format === "tsv") {
      outputTSV(rows, columns);
    } else if (opts.format === "csv") {
      outputCSV(rows, columns);
    } else {
      if (hasColor()) process.stdout.write("\n" + chalk.bold("  Audit Trail\n") + "\n");
      else process.stdout.write("\n  Audit Trail\n\n");
      outputTable(rows, columns);
      if (total > limit) paginationFooter(page, limit, total);
      process.stdout.write("\n");
    }
  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "forbidden") fatalError(err.message, EXIT.FORBIDDEN);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}
