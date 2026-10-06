import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, success, outputJSON, EXIT } from "../../output.js";
import { confirmOrExit } from "../../safety.js";

interface BusinessExportOpts {
  yes?: boolean;
  json?: boolean;
}

export async function businessExportCommand(opts: BusinessExportOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  await confirmOrExit("  Export all business data? This may take a moment.", opts);

  try {
    const result = await client.business.exportData();

    if (opts.json) {
      outputJSON(result);
      return;
    }

    // The server returns the CSV contents inline, one string per dataset.
    success(`Export complete: ${Object.keys(result).join(", ")}.`);
    process.stdout.write("  Use --json to output the CSV contents.\n");
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
