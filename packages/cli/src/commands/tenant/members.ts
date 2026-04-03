import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import {
  fatalError, outputJSON, outputTable, outputTSV, outputCSV, EXIT, type ColumnDef,
} from "../../output.js";
import { formatDate } from "../../format.js";

interface TenantMember {
  id: string;
  name: string;
  email: string;
  role: string;
  joinedAt: string;
}

interface MembersOpts {
  json?: boolean;
  format?: string;
}

export async function tenantMembersCommand(opts: MembersOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.tenant.members() as TenantMember[];

    if (opts.json) {
      outputJSON(result);
      return;
    }

    console.log(`\n Team Members  ${result.length} total\n`);

    const cols: ColumnDef<TenantMember>[] = [
      { key: "name", header: "Name", width: 24 },
      { key: "email", header: "Email", width: 30 },
      { key: "role", header: "Role", width: 18 },
      { key: "joinedAt", header: "Joined", width: 13, format: (v) => formatDate(String(v ?? "")) },
    ];

    if (opts.format === "tsv") outputTSV(result, cols);
    else if (opts.format === "csv") outputCSV(result, cols);
    else outputTable(result, cols);

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
