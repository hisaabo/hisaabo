import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, outputTable, outputTSV, outputCSV, EXIT, hasColor, type ColumnDef } from "../../output.js";
import { formatDate, formatRelativeDate } from "../../format.js";
import chalk from "chalk";

interface ApiKeyListOpts {
  json?: boolean;
  format?: string;
}

export async function apiKeyListCommand(opts: ApiKeyListOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const keys = await client.apiKey.list();

    if (opts.json) {
      outputJSON(keys);
      return;
    }

    const items = keys;

    if (items.length === 0) {
      process.stdout.write("\n  No API keys found.\n  Use: hisaabo api-key create --name <name>\n\n");
      return;
    }

    const rows = items.map((k) => {
      const rawKey = k.keyPrefix;
      // Show key prefix safely: hisaabo_key_abc... (first 20 chars)
      const displayKey = rawKey.length > 20 ? rawKey.slice(0, 20) + "..." : rawKey || "-";
      return {
        name: k.name,
        prefix: displayKey,
        created: formatDate(k.createdAt),
        lastUsed: k.lastUsedAt ? formatRelativeDate(k.lastUsedAt) : "Never",
        id: k.id,
      };
    });

    const columns: ColumnDef<(typeof rows)[number]>[] = [
      { key: "name", header: "Name", align: "left" },
      { key: "prefix", header: "Key Prefix", align: "left" },
      { key: "created", header: "Created", align: "left" },
      { key: "lastUsed", header: "Last Used", align: "left" },
      { key: "id", header: "ID", align: "left", width: 36 },
    ];

    if (opts.format === "tsv") {
      outputTSV(rows, columns);
    } else if (opts.format === "csv") {
      outputCSV(rows, columns);
    } else {
      if (hasColor()) process.stdout.write("\n" + chalk.bold("  API Keys\n") + "\n");
      else process.stdout.write("\n  API Keys\n\n");
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
