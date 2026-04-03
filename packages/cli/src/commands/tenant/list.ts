import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, outputTable, EXIT, type ColumnDef } from "../../output.js";

interface TenantEntry {
  id: string;
  name: string;
  slug: string;
  role: string;
}

interface ListOpts {
  json?: boolean;
}

export async function tenantListCommand(opts: ListOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.tenant.list() as TenantEntry[];

    if (opts.json) {
      outputJSON(result);
      return;
    }

    console.log(`\n Organizations  ${result.length} total\n`);

    const cols: ColumnDef<TenantEntry>[] = [
      { key: "name", header: "Name", width: 30 },
      { key: "slug", header: "Slug", width: 24 },
      { key: "role", header: "Role", width: 16 },
    ];

    outputTable(result, cols);

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}
