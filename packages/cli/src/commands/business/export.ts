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

    if (result?.url) {
      success("Export complete.");
      process.stdout.write(`  Download URL: ${result.url}\n`);
    } else if (result?.status === "processing" || result?.queued) {
      success("Export queued. You will be notified when the export is ready.");
    } else {
      success("Export initiated successfully.");
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
