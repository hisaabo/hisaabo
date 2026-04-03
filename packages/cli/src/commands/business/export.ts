import * as readline from "readline";
import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, success, outputJSON, EXIT } from "../../output.js";

interface BusinessExportOpts {
  yes?: boolean;
  json?: boolean;
}

export async function businessExportCommand(opts: BusinessExportOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  if (!opts.yes && process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((resolve) => {
      rl.question("  Export all business data? This may take a moment. (y/N): ", resolve);
    });
    rl.close();
    if (answer.trim().toLowerCase() !== "y") {
      console.log("  Cancelled.");
      process.exit(0);
    }
  }

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
